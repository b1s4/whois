import { json } from "@sveltejs/kit";
const DNS_GROUPS = {
  core: {
    types: ["A", "AAAA", "CNAME", "MX", "NS", "SOA", "TXT"]
  },
  security: {
    types: ["CAA", "DNSKEY", "DS", "RRSIG", "NSEC", "NSEC3", "NSEC3PARAM", "SSHFP", "TLSA", "CDS", "CDNSKEY"]
  },
  services: {
    types: ["SRV", "NAPTR", "URI"]
  },
  advanced: {
    types: ["AFSDB", "APL", "CERT", "DHCID", "DLV", "DNAME", "IPSECKEY", "KEY", "KX", "LOC", "PTR", "RP", "SIG", "TKEY", "TSIG", "TA"]
  }
};
const ALL_DNS_TYPES = [
  ...DNS_GROUPS.core.types,
  ...DNS_GROUPS.security.types,
  ...DNS_GROUPS.services.types,
  ...DNS_GROUPS.advanced.types
];
const DOH = "https://cloudflare-dns.com/dns-query";
async function queryType(domain, type) {
  try {
    const res = await fetch(`${DOH}?name=${encodeURIComponent(domain)}&type=${type}`, {
      headers: { Accept: "application/dns-json" },
      signal: AbortSignal.timeout(5e3)
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.Status !== 0) return null;
    const answers = data.Answer ?? [];
    const authority = data.Authority ?? [];
    if (answers.length === 0 && authority.length === 0) return null;
    return { type, answers, authority };
  } catch {
    return null;
  }
}
function cleanDomain(raw) {
  return raw.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/@.*$/, "");
}
function isValidDomain(s) {
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/.test(s);
}
const GET = async ({ url }) => {
  const raw = url.searchParams.get("domain");
  const typesParam = url.searchParams.get("types");
  if (!raw) {
    return json({ error: "Missing domain parameter" }, { status: 400 });
  }
  const domain = cleanDomain(raw);
  if (!isValidDomain(domain)) {
    return json({ error: "Invalid domain name" }, { status: 400 });
  }
  const validTypes = new Set(ALL_DNS_TYPES);
  const types = typesParam ? typesParam.split(",").filter((t) => validTypes.has(t)) : ["A", "AAAA", "MX", "NS", "TXT", "CNAME", "SOA", "CAA", "SRV", "DNSKEY", "DS"];
  if (types.length === 0) {
    return json({ error: "No valid record types specified" }, { status: 400 });
  }
  const results = await Promise.all(types.map((t) => queryType(domain, t)));
  const records = {};
  for (const r of results) {
    if (r && (r.answers.length > 0 || r.authority.length > 0)) {
      records[r.type] = { answers: r.answers, authority: r.authority };
    }
  }
  return json({ domain, records });
};
export {
  GET
};
