import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import dnsPacket from 'dns-packet';

interface Resolver {
	id: string; name: string; url: string;
	lat: number; lon: number; city: string; flag: string; iso: string;
	format: 'json' | 'binary';
}

// Only providers confirmed to accept queries from data-center IPs (cloud-safe).
// format='json'   → GET ?name=…&type=TYPE  Accept: application/dns-json
// format='binary' → POST body=wire-format  Content-Type: application/dns-message  (RFC 8484)
// Google uses New York coords so it doesn't overlap Cloudflare (SF) on the world map.
const RESOLVERS: Resolver[] = [
	{ id: 'cloudflare', name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query', lat: 37.8, lon: -122.4, city: 'San Francisco', flag: '🇺🇸', iso: 'us', format: 'json' },
	{ id: 'google',     name: 'Google',     url: 'https://dns.google/resolve',            lat: 40.7, lon:  -74.0, city: 'New York',      flag: '🇺🇸', iso: 'us', format: 'json' },
	{ id: 'nextdns',    name: 'NextDNS',    url: 'https://dns.nextdns.io/dns-query',       lat: 48.9, lon:    2.4, city: 'Paris',         flag: '🇫🇷', iso: 'fr', format: 'json' },
	{ id: 'ffmuc',      name: 'FFMUC',      url: 'https://doh.ffmuc.net/dns-query',        lat: 48.1, lon:   11.6, city: 'Munich',        flag: '🇩🇪', iso: 'de', format: 'binary' },
	{ id: 'dnssb',      name: 'DNS.SB',     url: 'https://doh.dns.sb/dns-query',           lat:  1.3, lon:  103.8, city: 'Singapore',     flag: '🇸🇬', iso: 'sg', format: 'json' },
	{ id: 'adguard',    name: 'AdGuard',    url: 'https://dns.adguard.com/resolve',        lat: 35.1, lon:   33.4, city: 'Nicosia',       flag: '🇨🇾', iso: 'cy', format: 'json' },
];

const VALID_TYPES = new Set([
	'A','AAAA','CNAME','MX','NS','PTR','SRV','SOA','TXT','CAA','DS','DNSKEY',
	'RRSIG','NSEC','NSEC3','SSHFP','TLSA','NAPTR','URI',
]);

// Numeric type codes — used to filter out DNSSEC extras (RRSIG etc.) that some resolvers append.
const TYPE_CODES: Record<string, number> = {
	A:1, AAAA:28, CNAME:5, MX:15, NS:2, PTR:12, SRV:33, SOA:6, TXT:16,
	CAA:257, DS:43, DNSKEY:48, RRSIG:46, NSEC:47, NSEC3:50, SSHFP:44, TLSA:52, NAPTR:35, URI:256,
};

type DnsJsonResponse = { Status: number; Answer?: { type: number; data: string; TTL: number }[] };

async function queryJson(resolverUrl: string, domain: string, qtype: string, signal: AbortSignal): Promise<DnsJsonResponse | null> {
	const res = await fetch(
		`${resolverUrl}?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(qtype)}`,
		{ headers: { Accept: 'application/dns-json' }, signal }
	);
	if (!res.ok) return null;
	return res.json();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeBinaryData(type: string, data: any): string {
	switch (type) {
		case 'A': case 'AAAA': case 'CNAME': case 'NS': case 'PTR': case 'DNAME':
			return String(data);
		case 'MX':
			return `${data.preference} ${data.exchange}`;
		case 'TXT': {
			const parts: Buffer[] = Array.isArray(data) ? data : [data];
			return parts.map((b: Buffer) => Buffer.isBuffer(b) ? b.toString() : String(b)).join('');
		}
		case 'SOA':
			return `${data.mname} ${data.rname} ${data.serial} ${data.refresh} ${data.retry} ${data.expire} ${data.minimum}`;
		case 'SRV':
			return `${data.priority} ${data.weight} ${data.port} ${data.target}`;
		case 'CAA':
			return `${data.flags} ${data.tag} "${data.value}"`;
		case 'DS':
			return `${data.keyTag} ${data.algorithm} ${data.digestType} ${Buffer.isBuffer(data.digest) ? data.digest.toString('hex') : ''}`;
		case 'DNSKEY':
			return `${data.flags} ${data.algorithm} ${Buffer.isBuffer(data.key) ? data.key.toString('base64').slice(0, 20) + '…' : ''}`;
		default:
			return JSON.stringify(data);
	}
}

async function queryBinary(resolverUrl: string, domain: string, qtype: string, signal: AbortSignal): Promise<DnsJsonResponse | null> {
	const buf = dnsPacket.encode({
		type: 'query',
		id: 0,
		flags: dnsPacket.RECURSION_DESIRED,
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		questions: [{ type: qtype as any, name: domain }],
	});

	const res = await fetch(resolverUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/dns-message', 'Accept': 'application/dns-message' },
		body: new Uint8Array(buf),
		signal,
	});
	if (!res.ok) return null;

	const raw = await res.arrayBuffer();
	const decoded = dnsPacket.decode(Buffer.from(raw));

	const rcode = (decoded.flags ?? 0) & 0xf;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const answers = (decoded.answers ?? []).map((a: any) => ({
		type: TYPE_CODES[a.type] ?? 0,
		data: serializeBinaryData(a.type, a.data),
		TTL: (a.ttl ?? 0) as number,
	}));

	return { Status: rcode === 3 ? 3 : 0, Answer: answers };
}

export const GET: RequestHandler = async ({ url }) => {
	const domain = url.searchParams.get('domain')?.trim().toLowerCase();
	if (!domain || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(domain)) {
		throw error(400, 'Invalid domain');
	}

	const qtype = (url.searchParams.get('type') ?? 'A').toUpperCase();
	if (!VALID_TYPES.has(qtype)) throw error(400, 'Invalid type');

	const results = await Promise.all(
		RESOLVERS.map(async ({ url: resolverUrl, format, ...resolver }) => {
			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 5000);
			const start = Date.now();
			try {
				const data = format === 'binary'
					? await queryBinary(resolverUrl, domain, qtype, ac.signal)
					: await queryJson(resolverUrl, domain, qtype, ac.signal);
				const ms = Date.now() - start;

				if (!data) return { ...resolver, records: [], ttl: null, status: 'error' as const, ms };
				if (data.Status === 3) return { ...resolver, records: [], ttl: null, status: 'nxdomain' as const, ms };

				const typeCode = TYPE_CODES[qtype];
				const answers = (data.Answer ?? []).filter(a => a.type === typeCode);
				if (!answers.length) return { ...resolver, records: [], ttl: null, status: 'nxdomain' as const, ms };

				return { ...resolver, records: answers.map(a => a.data), ttl: answers[0].TTL, status: 'ok' as const, ms };
			} catch (e: unknown) {
				const ms = Date.now() - start;
				const isAbort = (e as { name?: string })?.name === 'AbortError';
				return { ...resolver, records: [], ttl: null, status: (isAbort ? 'timeout' : 'error') as 'timeout' | 'error', ms };
			} finally {
				clearTimeout(timer);
			}
		})
	);

	return json({ domain, type: qtype, results });
};
