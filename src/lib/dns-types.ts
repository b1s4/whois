export const DNS_GROUPS = {
	core: {
		label: 'Core',
		types: ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'SOA', 'TXT']
	},
	security: {
		label: 'Security',
		types: ['CAA', 'DNSKEY', 'DS', 'RRSIG', 'NSEC', 'NSEC3', 'NSEC3PARAM', 'SSHFP', 'TLSA', 'CDS', 'CDNSKEY']
	},
	services: {
		label: 'Services',
		types: ['SRV', 'NAPTR', 'URI']
	},
	advanced: {
		label: 'Advanced',
		types: ['AFSDB', 'APL', 'CERT', 'DHCID', 'DLV', 'DNAME', 'IPSECKEY', 'KEY', 'KX', 'LOC', 'PTR', 'RP', 'SIG', 'TKEY', 'TSIG', 'TA']
	}
} as const;

export type DnsGroupKey = keyof typeof DNS_GROUPS;

export const ALL_DNS_TYPES = [
	...DNS_GROUPS.core.types,
	...DNS_GROUPS.security.types,
	...DNS_GROUPS.services.types,
	...DNS_GROUPS.advanced.types
] as const;

export type DnsTypeName = (typeof ALL_DNS_TYPES)[number];

export const DNS_TYPE_INFO: Record<string, { code: number; description: string }> = {
	A:          { code: 1,     description: 'IPv4 address' },
	AAAA:       { code: 28,    description: 'IPv6 address' },
	AFSDB:      { code: 18,    description: 'AFS database location' },
	APL:        { code: 42,    description: 'Address prefix list' },
	CAA:        { code: 257,   description: 'Certification authority authorization' },
	CDNSKEY:    { code: 60,    description: 'Child DNSKEY copy' },
	CDS:        { code: 59,    description: 'Child DS copy' },
	CERT:       { code: 37,    description: 'Certificate record' },
	CNAME:      { code: 5,     description: 'Canonical name alias' },
	DHCID:      { code: 49,    description: 'DHCP identifier' },
	DLV:        { code: 32769, description: 'DNSSEC lookaside validation' },
	DNAME:      { code: 39,    description: 'Delegation name' },
	DNSKEY:     { code: 48,    description: 'DNS key record' },
	DS:         { code: 43,    description: 'Delegation signer' },
	IPSECKEY:   { code: 45,    description: 'IPsec key' },
	KEY:        { code: 25,    description: 'Key record' },
	KX:         { code: 36,    description: 'Key exchanger' },
	LOC:        { code: 29,    description: 'Location record' },
	MX:         { code: 15,    description: 'Mail exchange' },
	NAPTR:      { code: 35,    description: 'Naming authority pointer' },
	NS:         { code: 2,     description: 'Name server' },
	NSEC:       { code: 47,    description: 'Next secure record' },
	NSEC3:      { code: 50,    description: 'Next secure record v3' },
	NSEC3PARAM: { code: 51,    description: 'NSEC3 parameters' },
	PTR:        { code: 12,    description: 'Pointer record' },
	RRSIG:      { code: 46,    description: 'DNSSEC resource record signature' },
	RP:         { code: 17,    description: 'Responsible person' },
	SIG:        { code: 24,    description: 'Signature record' },
	SOA:        { code: 6,     description: 'Start of authority' },
	SRV:        { code: 33,    description: 'Service locator' },
	SSHFP:      { code: 44,    description: 'SSH public key fingerprint' },
	TA:         { code: 32768, description: 'DNSSEC trust authorities' },
	TKEY:       { code: 249,   description: 'Transaction key' },
	TLSA:       { code: 52,    description: 'TLS authentication' },
	TSIG:       { code: 250,   description: 'Transaction signature' },
	TXT:        { code: 16,    description: 'Text record' },
	URI:        { code: 256,   description: 'Uniform resource identifier' }
};

export interface DnsAnswer {
	name: string;
	type: number;
	TTL: number;
	data: string;
}

export interface DnsTypeResult {
	answers: DnsAnswer[];
	authority: DnsAnswer[];
}

export function formatTTL(seconds: number): string {
	if (seconds < 60) return `${seconds}s`;
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
	return `${Math.floor(seconds / 86400)}d`;
}
