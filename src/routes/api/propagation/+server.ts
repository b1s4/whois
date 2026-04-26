import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';
import dnsPacket from 'dns-packet';

interface Resolver {
	id: string; name: string; url: string;
	lat: number; lon: number; city: string; flag: string; iso: string;
	format: 'json' | 'binary';
}

// Only providers confirmed to accept queries from data-center IPs (cloud-safe).
// format='json'   → GET ?name=…&type=A  Accept: application/dns-json
// format='binary' → POST body=wire-format  Content-Type: application/dns-message  (RFC 8484)
// Google uses New York coords so it doesn't overlap Cloudflare (SF) on the world map.
const RESOLVERS: Resolver[] = [
	{ id: 'cloudflare', name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query', lat: 37.8, lon: -122.4, city: 'San Francisco', flag: '🇺🇸', iso: 'us', format: 'json' },
	{ id: 'google',     name: 'Google',     url: 'https://dns.google/resolve',            lat: 40.7, lon:  -74.0, city: 'New York',      flag: '🇺🇸', iso: 'us', format: 'json' },
	{ id: 'nextdns',    name: 'NextDNS',    url: 'https://dns.nextdns.io/dns-query',       lat: 48.9, lon:    2.4, city: 'Paris',         flag: '🇫🇷', iso: 'fr', format: 'json' },
	{ id: 'ffmuc',      name: 'FFMUC',      url: 'https://doh.ffmuc.net/dns-query',        lat: 48.1, lon:   11.6, city: 'Munich',        flag: '🇩🇪', iso: 'de', format: 'binary' },
	{ id: 'dnssb',      name: 'DNS.SB',     url: 'https://doh.dns.sb/dns-query',           lat:  1.3, lon:  103.8, city: 'Singapore',     flag: '🇸🇬', iso: 'sg', format: 'json' },
	{ id: 'adguard',    name: 'AdGuard',    url: 'https://dns.adguard.com/resolve',        lat: 55.8, lon:   37.6, city: 'Moscow',        flag: '🇷🇺', iso: 'ru', format: 'json' },
];

type DnsJsonResponse = { Status: number; Answer?: { type: number; data: string; TTL: number }[] };

async function queryJson(resolverUrl: string, domain: string, signal: AbortSignal): Promise<DnsJsonResponse | null> {
	const res = await fetch(
		`${resolverUrl}?name=${encodeURIComponent(domain)}&type=A`,
		{ headers: { Accept: 'application/dns-json' }, signal }
	);
	if (!res.ok) return null;
	return res.json();
}

async function queryBinary(resolverUrl: string, domain: string, signal: AbortSignal): Promise<DnsJsonResponse | null> {
	const buf = dnsPacket.encode({
		type: 'query',
		id: 0,
		flags: dnsPacket.RECURSION_DESIRED,
		questions: [{ type: 'A', name: domain }],
	});

	const res = await fetch(resolverUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/dns-message',
			'Accept': 'application/dns-message',
		},
		body: new Uint8Array(buf),
		signal,
	});
	if (!res.ok) return null;

	const raw = await res.arrayBuffer();
	const decoded = dnsPacket.decode(Buffer.from(raw));

	const rcode = (decoded.flags ?? 0) & 0xf;
	const answers = (decoded.answers ?? [])
		.filter((a): a is dnsPacket.StringAnswer => a.type === 'A')
		.map(a => ({ type: 1, data: a.data, TTL: a.ttl ?? 0 }));

	return { Status: rcode === 3 ? 3 : 0, Answer: answers };
}

export const GET: RequestHandler = async ({ url }) => {
	const domain = url.searchParams.get('domain')?.trim().toLowerCase();
	if (!domain || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(domain)) {
		throw error(400, 'Invalid domain');
	}

	const results = await Promise.all(
		RESOLVERS.map(async ({ url: resolverUrl, format, ...resolver }) => {
			const ac = new AbortController();
			const timer = setTimeout(() => ac.abort(), 5000);
			const start = Date.now();
			try {
				const data = format === 'binary'
					? await queryBinary(resolverUrl, domain, ac.signal)
					: await queryJson(resolverUrl, domain, ac.signal);
				const ms = Date.now() - start;

				if (!data) return { ...resolver, ips: [], ttl: null, status: 'error' as const, ms };
				if (data.Status === 3) return { ...resolver, ips: [], ttl: null, status: 'nxdomain' as const, ms };

				const answers = (data.Answer ?? []).filter(a => a.type === 1);
				if (!answers.length) return { ...resolver, ips: [], ttl: null, status: 'nxdomain' as const, ms };

				return { ...resolver, ips: answers.map(a => a.data), ttl: answers[0].TTL, status: 'ok' as const, ms };
			} catch (e: unknown) {
				const ms = Date.now() - start;
				const isAbort = (e as { name?: string })?.name === 'AbortError';
				return { ...resolver, ips: [], ttl: null, status: (isAbort ? 'timeout' : 'error') as 'timeout' | 'error', ms };
			} finally {
				clearTimeout(timer);
			}
		})
	);

	return json({ domain, results });
};
