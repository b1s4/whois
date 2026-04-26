import type { RequestHandler } from './$types';
import { json, error } from '@sveltejs/kit';

interface Resolver {
	id: string; name: string; url: string;
	lat: number; lon: number; city: string; flag: string;
}

// All anycast/globally-accessible JSON DoH providers.
// Google uses /resolve (JSON API); all others use /dns-query with Accept header.
const RESOLVERS: Resolver[] = [
	{ id: 'cloudflare', name: 'Cloudflare', url: 'https://cloudflare-dns.com/dns-query', lat: 37.8, lon: -122.4, city: 'San Francisco', flag: '🇺🇸' },
	{ id: 'google',     name: 'Google',     url: 'https://dns.google/resolve',             lat: 37.4, lon: -122.1, city: 'Mountain View',  flag: '🇺🇸' },
	{ id: 'opendns',    name: 'OpenDNS',    url: 'https://doh.opendns.com/dns-query',      lat: 37.3, lon: -121.9, city: 'San Jose',        flag: '🇺🇸' },
	{ id: 'quad9',      name: 'Quad9',      url: 'https://dns.quad9.net/dns-query',         lat: 47.4, lon:    8.5, city: 'Zürich',          flag: '🇨🇭' },
	{ id: 'mullvad',    name: 'Mullvad',    url: 'https://doh.mullvad.net/dns-query',       lat: 59.3, lon:   18.1, city: 'Stockholm',       flag: '🇸🇪' },
	{ id: 'dnssb',      name: 'DNS.SB',     url: 'https://doh.dns.sb/dns-query',            lat:  1.3, lon:  103.8, city: 'Singapore',       flag: '🇸🇬' },
	{ id: 'dnspod',     name: 'DNSPod',     url: 'https://doh.pub/dns-query',               lat: 22.5, lon:  114.1, city: 'Shenzhen',        flag: '🇨🇳' },
	{ id: 'nextdns',    name: 'NextDNS',    url: 'https://dns.nextdns.io/dns-query',        lat: 48.9, lon:    2.4, city: 'Paris',           flag: '🇫🇷' },
];

async function queryResolver(
	resolverUrl: string,
	domain: string,
	timeoutMs = 5000
): Promise<{ Status: number; Answer?: { type: number; data: string; TTL: number }[] } | null> {
	const ac = new AbortController();
	const timer = setTimeout(() => ac.abort(), timeoutMs);
	try {
		const res = await fetch(
			`${resolverUrl}?name=${encodeURIComponent(domain)}&type=A`,
			{ headers: { Accept: 'application/dns-json' }, signal: ac.signal }
		);
		if (!res.ok) return null;
		return await res.json();
	} finally {
		clearTimeout(timer);
	}
}

export const GET: RequestHandler = async ({ url }) => {
	const domain = url.searchParams.get('domain')?.trim().toLowerCase();
	if (!domain || !/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/.test(domain)) {
		throw error(400, 'Invalid domain');
	}

	const results = await Promise.all(
		RESOLVERS.map(async ({ url: resolverUrl, ...resolver }) => {
			const start = Date.now();
			try {
				const data = await queryResolver(resolverUrl, domain);
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
			}
		})
	);

	return json({ domain, results });
};
