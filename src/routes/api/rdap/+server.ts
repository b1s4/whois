import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface RdapBootstrap {
	services: [string[], string[]][];
}

async function resolveRdapUrl(domain: string): Promise<string | null> {
	const tld = domain.split('.').pop();
	if (!tld) return null;

	try {
		const res = await fetch('https://data.iana.org/rdap/dns.json', {
			signal: AbortSignal.timeout(4000)
		});
		if (!res.ok) return null;

		const bootstrap = await res.json() as RdapBootstrap;
		for (const [tlds, urls] of bootstrap.services) {
			if (tlds.includes(tld) && urls.length > 0) {
				return urls[0];
			}
		}
	} catch {
		// fall through to gateway
	}

	return null;
}

function cleanDomain(raw: string): string {
	return raw
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/.*$/, '');
}

export const GET: RequestHandler = async ({ url }) => {
	const raw = url.searchParams.get('domain');

	if (!raw) {
		return json({ error: 'Missing domain parameter' }, { status: 400 });
	}

	const domain = cleanDomain(raw);

	// Try IANA bootstrap first, fall back to rdap.org gateway
	let baseUrl = await resolveRdapUrl(domain);
	const urls = baseUrl
		? [`${baseUrl.replace(/\/$/, '')}/domain/${domain}`]
		: [
				`https://rdap.org/domain/${domain}`,
				`https://rdap.arin.net/registry/domain/${domain}`
		  ];

	for (const endpoint of urls) {
		try {
			const res = await fetch(endpoint, {
				headers: { Accept: 'application/rdap+json' },
				signal: AbortSignal.timeout(8000)
			});

			if (res.status === 404) {
				return json({ error: 'Domain not found in RDAP registry' }, { status: 404 });
			}

			if (!res.ok) continue;

			const data = await res.json();
			return json(data);
		} catch {
			continue;
		}
	}

	return json({ error: 'RDAP data unavailable for this domain' }, { status: 503 });
};
