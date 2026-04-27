# Whois

A fast, minimal DNS & RDAP lookup tool. Query any domain for its full DNS record set, registrar and ownership data via RDAP, and check DNS propagation across global resolvers — all from a single search.

Built with SvelteKit, deployed on Vercel.

---

## Features

### DNS Lookup

Queries 35+ record types in parallel through Cloudflare's DNS-over-HTTPS API and returns every record found for the domain.

Record types are grouped into four tabs:

| Group | Types |
|---|---|
| **Core** | A, AAAA, CNAME, MX, NS, SOA, TXT |
| **Security** | CAA, DNSKEY, DS, RRSIG, NSEC, NSEC3, NSEC3PARAM, SSHFP, TLSA, CDS, CDNSKEY |
| **Services** | SRV, NAPTR, URI |
| **Advanced** | AFSDB, APL, CERT, DHCID, DLV, DNAME, IPSECKEY, KEY, KX, LOC, PTR, RP, SIG, TKEY, TSIG, TA |

Each record block shows the raw data, TTL formatted as seconds/minutes/hours/days, and a count of answers returned.

---

### RDAP Lookup

Fetches registration and ownership data from the authoritative RDAP registry for the queried domain.

- Resolves the correct RDAP server via the **IANA bootstrap registry** — queries always go to the authoritative source.
- Falls back to `rdap.org` and `rdap.arin.net` if the IANA lookup fails
- Displays: registrar, registrant, admin and tech contacts, domain status codes, nameservers with glue IPs, DNSSEC DS records, key data, important dates (created, updated, expiry), and registry notices

---

### DNS Propagation

Checks how a domain resolves across geographically distributed resolvers simultaneously.

**Supported record types:** A · AAAA · CNAME · MX · NS · PTR · SRV · SOA · TXT · CAA · DS · DNSKEY

All propagation queries run server-side to avoid CORS restrictions. Resolvers that block cloud/datacenter IPs have been excluded.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [SvelteKit 2](https://svelte.dev) + Svelte 5 (runes) |
| Deployment | [Vercel](https://vercel.com) — serverless functions, Node.js 22 |
| Map | [d3-geo](https://github.com/d3/d3-geo) + [world-atlas](https://github.com/topojson/world-atlas) + [topojson-client](https://github.com/topojson/topojson-client) |
| Binary DoH | [dns-packet](https://github.com/mafintosh/dns-packet) (RFC 8484) |
| Flag icons | [flag-icons](https://github.com/lipis/flag-icons) |
| Language | TypeScript |

---

## API Routes

All routes are protected at the server level — requests must originate from the same origin (browser `Sec-Fetch-Site: same-origin`). Direct access from curl, Postman, or external sites returns `403 Forbidden`.

### `GET /api/dns`

Queries DNS records for a domain.

| Parameter | Required | Description |
|---|---|---|
| `domain` | Yes | Domain name (also accepts URLs — strips protocol and path) |
| `types` | No | Comma-separated list of record types. Defaults to A, AAAA, MX, NS, TXT, CNAME, SOA, CAA, SRV, DNSKEY, DS |

### `GET /api/rdap`

Fetches RDAP registration data for a domain.

| Parameter | Required | Description |
|---|---|---|
| `domain` | Yes | Domain name |

### `GET /api/propagation`

Queries a specific DNS record type across all global resolvers.

| Parameter | Required | Description |
|---|---|---|
| `domain` | Yes | Domain name |
| `type` | No | Record type (default: `A`). Supports A, AAAA, CNAME, MX, NS, PTR, SRV, SOA, TXT, CAA, DS, DNSKEY and more |

---

## Running Locally

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Type check
npm run check

# Build for production
npm run build
```

Requires Node.js 18+. No environment variables needed for local development.
