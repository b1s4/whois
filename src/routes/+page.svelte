<script lang="ts">
	import { fade, slide } from 'svelte/transition';
	import { DNS_GROUPS, DNS_TYPE_INFO, ALL_DNS_TYPES, formatTTL } from '$lib/dns-types';
	import type { DnsTypeResult } from '$lib/dns-types';
	import { geoNaturalEarth1, geoPath, geoGraticule10 } from 'd3-geo';
	import { feature } from 'topojson-client';
	import worldJson from 'world-atlas/countries-110m.json';
	import 'flag-icons/css/flag-icons.min.css';

	// ─── World map (computed once, module-level) ─────────────────────────────────
	const MAP_W = 960, MAP_H = 500;
	const _proj  = geoNaturalEarth1().fitSize([MAP_W, MAP_H], { type: 'Sphere' });
	const _path  = geoPath(_proj);
	const _land  = feature(worldJson as any, (worldJson as any).objects.land);
	const _grat  = geoGraticule10();
	const landPath   = _path(_land as any) ?? '';
	const gratPath   = _path(_grat as any) ?? '';
	const spherePath = _path({ type: 'Sphere' }) ?? '';
	function project(lon: number, lat: number): [number, number] | null {
		return _proj([lon, lat]) as [number, number] | null;
	}


	type GroupKey = keyof typeof DNS_GROUPS | 'all';

	// ─── State ───────────────────────────────────────────────────────────────────

	let query       = $state('');
	let activeGroup = $state<GroupKey>('core');
	let submitted   = $state('');

	let dnsRecords  = $state<Record<string, DnsTypeResult>>({});
	let rdapData    = $state<Record<string, unknown> | null>(null);
	let dnsLoading  = $state(false);
	let rdapLoading = $state(false);
	let dnsError    = $state('');
	let rdapError   = $state('');

	interface PropResult {
		id: string; name: string; city: string; flag: string; iso: string;
		lat: number; lon: number;
		ips: string[]; ttl: number | null;
		status: 'ok' | 'nxdomain' | 'error' | 'timeout'; ms: number;
	}
	let propResults  = $state<PropResult[]>([]);
	let propLoading  = $state(false);
	let mapTooltip   = $state<{ r: PropResult; x: number; y: number } | null>(null);

	const majorityIp = $derived.by((): string => {
		const counts = new Map<string, number>();
		for (const r of propResults) for (const ip of r.ips) counts.set(ip, (counts.get(ip) ?? 0) + 1);
		let max = 0, best = '';
		for (const [ip, n] of counts) if (n > max) { max = n; best = ip; }
		return best;
	});

	function propColor(r: PropResult): string {
		if (r.status === 'ok') return r.ips.includes(majorityIp) ? 'var(--accent)' : '#f97316';
		if (r.status === 'nxdomain') return '#ef4444';
		return '#3a3a3a';
	}

	// ─── DNS helpers ─────────────────────────────────────────────────────────────

	const groups: { key: GroupKey; label: string }[] = [
		{ key: 'core',     label: 'Core'     },
		{ key: 'security', label: 'Security' },
		{ key: 'services', label: 'Services' },
		{ key: 'advanced', label: 'Advanced' },
		{ key: 'all',      label: 'All'      }
	];

	function getTypesForGroup(g: GroupKey): string[] {
		if (g === 'all') return [...ALL_DNS_TYPES];
		return [...DNS_GROUPS[g].types];
	}

	const filteredRecords = $derived(() => {
		const types = getTypesForGroup(activeGroup);
		return Object.fromEntries(Object.entries(dnsRecords).filter(([t]) => types.includes(t)));
	});

	const totalDnsFound = $derived(() =>
		Object.values(dnsRecords).reduce((s, r) => s + (r as DnsTypeResult).answers.length, 0)
	);

	function countForGroup(key: GroupKey): number {
		return Object.keys(dnsRecords).filter((t) => getTypesForGroup(key).includes(t)).length;
	}

	// ─── Actions ─────────────────────────────────────────────────────────────────

	async function submit() {
		const raw = query.trim();
		if (!raw || dnsLoading || rdapLoading) return;
		const domain = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
		submitted   = domain;
		dnsRecords  = {};
		rdapData    = null;
		propResults = [];
		dnsError    = '';
		rdapError   = '';
		searchDNS(domain);
		searchRDAP(domain);
		searchPropagation(domain);
	}

	async function searchDNS(domain: string) {
		dnsLoading = true;
		try {
			const res  = await fetch(`/api/dns?domain=${encodeURIComponent(domain)}&types=${[...ALL_DNS_TYPES].join(',')}`);
			const data = await res.json();
			if (data.error) dnsError = data.error;
			else dnsRecords = data.records ?? {};
		} catch { dnsError = 'DNS query failed'; }
		finally { dnsLoading = false; }
	}

	async function searchRDAP(domain: string) {
		rdapLoading = true;
		try {
			const res  = await fetch(`/api/rdap?domain=${encodeURIComponent(domain)}`);
			const data = await res.json();
			if (data.error) rdapError = data.error;
			else rdapData = data;
		} catch { rdapError = 'RDAP query failed'; }
		finally { rdapLoading = false; }
	}

	async function searchPropagation(domain: string) {
		propLoading = true;
		try {
			const res  = await fetch(`/api/propagation?domain=${encodeURIComponent(domain)}`);
			const data = await res.json();
			if (!data.error) propResults = data.results;
		} catch {}
		finally { propLoading = false; }
	}

	let openNotices = $state(new Set<number>());

	function toggleNotice(i: number) {
		const next = new Set(openNotices);
		next.has(i) ? next.delete(i) : next.add(i);
		openNotices = next;
	}

	function reset() {
		submitted = ''; query = ''; dnsRecords = {}; rdapData = null; propResults = []; dnsError = ''; rdapError = '';
		openNotices = new Set();
	}

	function handleKeydown(e: KeyboardEvent) { if (e.key === 'Enter') submit(); }

	// ─── RDAP types ──────────────────────────────────────────────────────────────

	interface VcardParsed {
		name?:    string;
		org?:     string;
		emails?:  string[];
		phones?:  string[];
		fax?:     string[];
		url?:     string;
		address?: { street?: string; city?: string; state?: string; postal?: string; country?: string };
	}

	interface RdapEntity {
		handle?:     string;
		roles:       string[];
		vcard:       VcardParsed;
		publicIds?:  { type: string; identifier: string }[];
		status?:     string[];
		links?:      { rel?: string; href?: string; type?: string }[];
		nested:      RdapEntity[];
	}

	interface DsRecord   { keyTag: number; algorithm: number; digestType: number; digest: string }
	interface KeyRecord  { flags: number; protocol: number; algorithm: number; publicKey: string }

	// ─── RDAP lookup tables ───────────────────────────────────────────────────────

	const EVENT_LABELS: Record<string, string> = {
		'registration':               'Registered',
		'expiration':                 'Expires',
		'last changed':               'Updated',
		'last update of RDAP database': 'RDAP sync',
		'transfer':                   'Transferred',
		'deletion':                   'Deleted',
		'reinstantiation':            'Reinstated',
		'locked':                     'Locked',
		'unlocked':                   'Unlocked',
	};

	const ROLE_ORDER = [
		'registrar', 'registrant', 'administrative', 'technical',
		'billing', 'abuse', 'noc', 'reseller', 'proxy', 'notifications', 'sponsor'
	];

	const ROLE_LABELS: Record<string, string> = {
		registrar:      'Registrar',
		registrant:     'Registrant',
		administrative: 'Admin Contact',
		technical:      'Technical Contact',
		billing:        'Billing Contact',
		abuse:          'Abuse Contact',
		noc:            'NOC',
		reseller:       'Reseller',
		proxy:          'Privacy Proxy',
		notifications:  'Notifications',
		sponsor:        'Sponsor',
	};

	const ALGO_NAMES: Record<number, string> = {
		1: 'RSA/MD5', 3: 'DSA/SHA-1', 5: 'RSA/SHA-1', 7: 'RSASHA1-NSEC3-SHA1',
		8: 'RSA/SHA-256', 10: 'RSA/SHA-512', 13: 'ECDSA P-256/SHA-256',
		14: 'ECDSA P-384/SHA-384', 15: 'Ed25519', 16: 'Ed448',
	};

	const DIGEST_NAMES: Record<number, string> = {
		1: 'SHA-1', 2: 'SHA-256', 3: 'GOST R 34.11-94', 4: 'SHA-384',
	};

	// ─── RDAP parsers ─────────────────────────────────────────────────────────────

	function fmtDate(iso?: string): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
	}

	function fmtDateTime(iso?: string): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleString('en-US', {
			year: 'numeric', month: 'short', day: 'numeric',
			hour: '2-digit', minute: '2-digit', timeZoneName: 'short'
		});
	}

	function parseVcard(vcardArray: unknown[]): VcardParsed {
		const out: VcardParsed = {};
		if (!Array.isArray(vcardArray?.[1])) return out;
		for (const field of vcardArray[1] as unknown[]) {
			if (!Array.isArray(field) || field.length < 4) continue;
			const [name, params, , value] = field as [string, Record<string, unknown>, string, unknown];
			switch (name) {
				case 'fn':
					out.name = String(value ?? '').trim(); break;
				case 'org':
					out.org = (Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '')).trim(); break;
				case 'email':
					(out.emails ??= []).push(String(value ?? '').trim()); break;
				case 'tel': {
					const num = String(value ?? '').replace(/^tel:/, '').trim();
					if (!num) break;
					const t = (params?.type as string | undefined)?.toLowerCase();
					if (t === 'fax') (out.fax ??= []).push(num);
					else             (out.phones ??= []).push(num);
					break;
				}
				case 'adr':
					if (Array.isArray(value)) {
						const [, , street, city, state, postal, country] = value as string[];
						out.address = {
							street:  String(street  ?? '').trim() || undefined,
							city:    String(city    ?? '').trim() || undefined,
							state:   String(state   ?? '').trim() || undefined,
							postal:  String(postal  ?? '').trim() || undefined,
							country: String(country ?? '').trim() || undefined,
						};
					}
					break;
				case 'url':
					out.url = String(value ?? '').trim(); break;
			}
		}
		return out;
	}

	function parseEntity(raw: unknown): RdapEntity {
		const e = raw as Record<string, unknown>;
		return {
			handle:    e.handle ? String(e.handle) : undefined,
			roles:     Array.isArray(e.roles) ? (e.roles as string[]) : [],
			vcard:     parseVcard(e.vcardArray as unknown[] ?? []),
			publicIds: Array.isArray(e.publicIds) ? (e.publicIds as { type: string; identifier: string }[]) : undefined,
			status:    Array.isArray(e.status) ? (e.status as string[]) : undefined,
			links:     Array.isArray(e.links) ? (e.links as { rel?: string; href?: string; type?: string }[]) : undefined,
			nested:    Array.isArray(e.entities) ? (e.entities as unknown[]).map(parseEntity) : [],
		};
	}

	function flattenEntities(data: Record<string, unknown>): RdapEntity[] {
		if (!Array.isArray(data.entities)) return [];
		return (data.entities as unknown[]).map(parseEntity);
	}

	function sortEntities(entities: RdapEntity[]): RdapEntity[] {
		return [...entities].sort((a, b) => {
			const ai = ROLE_ORDER.indexOf(a.roles[0] ?? '');
			const bi = ROLE_ORDER.indexOf(b.roles[0] ?? '');
			return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
		});
	}

	function vcardIsEmpty(v: VcardParsed): boolean {
		return !v.name && !v.org && !v.emails?.length && !v.phones?.length
			&& !v.fax?.length && !v.url && !v.address;
	}

	function getNameserverIPs(ns: unknown): { v4: string[]; v6: string[] } {
		const n = ns as Record<string, unknown>;
		const ips = n.ipAddresses as { v4?: string[]; v6?: string[] } | undefined;
		return { v4: ips?.v4 ?? [], v6: ips?.v6 ?? [] };
	}

	function getDsData(data: Record<string, unknown>): DsRecord[] {
		return (data.secureDNS as { dsData?: DsRecord[] } | undefined)?.dsData ?? [];
	}

	function getKeyData(data: Record<string, unknown>): KeyRecord[] {
		return (data.secureDNS as { keyData?: KeyRecord[] } | undefined)?.keyData ?? [];
	}

	function truncate(s: string, n = 48): string {
		return s.length > n ? s.slice(0, n) + '…' : s;
	}
</script>

<svelte:head>
	<title>whois — DNS & RDAP lookup</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════════════
     PRE-SEARCH
════════════════════════════════════════════════════════════════════════════ -->
{#if !submitted}
	<main class="hero-layout" transition:fade={{ duration: 150 }}>
		<div class="hero-inner">
			<header>
				<div class="brand">
					<span class="brand-name">whois</span><span class="brand-cursor">_</span>
				</div>
				<p class="brand-sub">DNS records &amp; RDAP domain lookup</p>
			</header>
			<div class="hero-search">
				<div class="search-wrap">
					<span class="search-prefix">$</span>
					<input
						class="search-input"
						type="text"
						placeholder="example.com"
						bind:value={query}
						onkeydown={handleKeydown}
						spellcheck="false"
						autocomplete="off"
						autocorrect="off"
						autocapitalize="none"
					/>
					<button class="search-btn" onclick={submit} disabled={!query.trim()}>
						<span>Query</span>
					</button>
				</div>
				<p class="hero-hint">Queries A, AAAA, MX, NS, TXT, CNAME, SOA, CAA and 30+ more record types</p>
			</div>
		</div>
	</main>

<!-- ═══════════════════════════════════════════════════════════════════════════
     POST-SEARCH
════════════════════════════════════════════════════════════════════════════ -->
{:else}
	<div class="results-layout">

		<!-- Sticky top bar -->
		<div class="top-bar">
			<div class="top-bar-inner">
				<button class="top-brand" onclick={reset} title="New search">
					<span class="top-brand-text">w_</span>
				</button>
				<div class="top-search-wrap">
					<span class="search-prefix">$</span>
					<input
						class="search-input"
						type="text"
						placeholder="example.com"
						bind:value={query}
						onkeydown={handleKeydown}
						spellcheck="false"
						autocomplete="off"
						autocorrect="off"
						autocapitalize="none"
					/>
					<button class="search-btn" onclick={submit} disabled={dnsLoading || rdapLoading || !query.trim()}>
						{#if dnsLoading || rdapLoading}
							<span class="spinner"></span>
						{:else}
							<span>Query</span>
						{/if}
					</button>
				</div>
			</div>
		</div>

		<!-- Globe loading state -->
		{#if dnsLoading}
			<div class="globe-screen" transition:fade={{ duration: 200 }}>
				<svg class="spinner-svg" viewBox="0 0 66 66" width="62" height="62">
					<circle cx="33" cy="33" r="28" fill="none" stroke="rgba(0,0,0,0.44)" stroke-width="10"/>
					<circle cx="33" cy="33" r="28" fill="none" stroke="rgba(254,229,0,1)" stroke-width="10"
						stroke-dasharray="44 132" stroke-linecap="round" class="spinner-arc"/>
				</svg>

				<div class="globe-info">
					<span class="globe-domain">{submitted}</span>
					<span class="globe-status">Scanning DNS records</span>
				</div>
			</div>

		<!-- Results -->
		{:else}
		<div class="results-container" transition:fade={{ duration: 200 }}>
			<div class="domain-label">
				<span class="domain-text">{submitted}</span>
				{#if dnsLoading || rdapLoading}
					<span class="badge scanning">scanning</span>
				{/if}
			</div>

			<div class="results-grid">

				<!-- ════════════════ DNS COLUMN ════════════════ -->
				<section class="col dns-col">
					<div class="col-header">
						<span class="col-title">DNS</span>
						{#if !dnsLoading && !dnsError}
							<span class="col-meta">{totalDnsFound()} records · {Object.keys(dnsRecords).length} types</span>
						{/if}
					</div>

					<div class="group-filter">
						{#each groups as g}
							<button
								class="group-btn"
								class:active={activeGroup === g.key}
								onclick={() => (activeGroup = g.key)}
							>
								{g.label}
								{#if g.key !== 'all'}
									{@const n = countForGroup(g.key)}
									{#if n > 0}<span class="group-count">{n}</span>{/if}
								{/if}
							</button>
						{/each}
					</div>

					{#if dnsLoading}
						<div class="skeletons">{#each { length: 5 } as _}<div class="skeleton"></div>{/each}</div>
					{:else if dnsError}
						<div class="col-error">{dnsError}</div>
					{:else if Object.keys(filteredRecords()).length === 0}
						<div class="col-empty"><span class="empty-glyph">◌</span>No records in this group</div>
					{:else}
						<div class="records-list">
							{#each Object.entries(filteredRecords()) as [type, result]}
								{@const info = DNS_TYPE_INFO[type]}
								{@const res  = result as DnsTypeResult}
								<div class="record-block">
									<div class="record-head">
										<div class="record-type-row">
											<span class="type-badge">{type}</span>
											{#if info}<span class="type-desc">{info.description}</span>{/if}
										</div>
										<span class="record-count-badge">{res.answers.length}</span>
									</div>
									<div class="record-entries">
										{#each res.answers as answer}
											<div class="record-entry">
												<span class="record-data">{answer.data}</span>
												<span class="record-ttl">TTL {formatTTL(answer.TTL)}</span>
											</div>
										{/each}
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</section>

				<!-- ════════════════ RDAP COLUMN ════════════════ -->
				<section class="col rdap-col">
					<div class="col-header">
						<span class="col-title">RDAP</span>
						{#if rdapData && !rdapLoading}
							<span class="col-meta">Registration data</span>
						{/if}
					</div>

					{#if rdapLoading}
						<div class="skeletons">{#each { length: 7 } as _}<div class="skeleton"></div>{/each}</div>

					{:else if rdapError}
						<div class="col-error">{rdapError}</div>

					{:else if !rdapData}
						<div class="col-empty"><span class="empty-glyph">◌</span>No RDAP data available</div>

					{:else}
						{@const d        = rdapData}
						{@const events   = d.events   as {eventAction:string;eventDate:string}[] ?? []}
						{@const nsArr    = d.nameservers as Record<string,unknown>[] ?? []}
						{@const statuses = d.status   as string[] ?? []}
						{@const secureDNS= d.secureDNS as Record<string,unknown> ?? {}}
						{@const dsData   = getDsData(d)}
						{@const keyData  = getKeyData(d)}
						{@const entities = sortEntities(flattenEntities(d))}
						{@const notices  = d.notices  as {title?:string;description?:string[];links?:{href?:string;rel?:string}[]}[] ?? []}
						{@const links    = d.links    as {rel?:string;href?:string;type?:string}[] ?? []}

						<div class="rdap-cards">

							<!-- Domain identity -->
							<div class="rdap-card">
								<div class="rdap-card-title">Domain</div>
								{#if d.ldhName}
									<div class="rdap-row">
										<span class="rdap-label">Name</span>
										<span class="rdap-val mono">{String(d.ldhName)}</span>
									</div>
								{/if}
								{#if d.unicodeName && d.unicodeName !== d.ldhName}
									<div class="rdap-row">
										<span class="rdap-label">Unicode</span>
										<span class="rdap-val mono">{String(d.unicodeName)}</span>
									</div>
								{/if}
								{#if d.handle}
									<div class="rdap-row">
										<span class="rdap-label">Handle</span>
										<span class="rdap-val mono dim">{String(d.handle)}</span>
									</div>
								{/if}
								{#if d.port43}
									<div class="rdap-row">
										<span class="rdap-label">WHOIS</span>
										<span class="rdap-val mono dim">{String(d.port43)}</span>
									</div>
								{/if}
								{#if statuses.length}
									<div class="rdap-row rdap-row-wrap">
										<span class="rdap-label">Status</span>
										<div class="status-tags">
											{#each statuses as s}<span class="status-tag">{s}</span>{/each}
										</div>
									</div>
								{/if}
							</div>

							<!-- Timeline — all events -->
							{#if events.length}
								<div class="rdap-card">
									<div class="rdap-card-title">Timeline</div>
									{#each events as ev}
										<div class="rdap-row">
											<span class="rdap-label">{EVENT_LABELS[ev.eventAction] ?? ev.eventAction}</span>
											<span class="rdap-val mono">
												{ev.eventAction === 'last update of RDAP database'
													? fmtDateTime(ev.eventDate)
													: fmtDate(ev.eventDate)}
											</span>
										</div>
									{/each}
								</div>
							{/if}

							<!-- DNSSEC -->
							<div class="rdap-card">
								<div class="rdap-card-title">DNSSEC</div>
								<div class="rdap-row">
									<span class="rdap-label">Delegation</span>
									<span class="rdap-val" class:accent-text={secureDNS.delegationSigned === true}>
										{secureDNS.delegationSigned === true ? 'Signed ✓' : secureDNS.delegationSigned === false ? 'Unsigned' : '—'}
									</span>
								</div>
								{#if secureDNS.zoneSigned !== undefined}
									<div class="rdap-row">
										<span class="rdap-label">Zone</span>
										<span class="rdap-val" class:accent-text={secureDNS.zoneSigned === true}>
											{secureDNS.zoneSigned ? 'Signed ✓' : 'Unsigned'}
										</span>
									</div>
								{/if}
								{#each dsData as ds, i}
									<div class="rdap-separator">{i === 0 ? 'DS Record' : `DS Record ${i + 1}`}</div>
									<div class="rdap-row">
										<span class="rdap-label">Key Tag</span>
										<span class="rdap-val mono">{ds.keyTag}</span>
									</div>
									<div class="rdap-row">
										<span class="rdap-label">Algorithm</span>
										<span class="rdap-val mono">{ds.algorithm}{ALGO_NAMES[ds.algorithm] ? ` — ${ALGO_NAMES[ds.algorithm]}` : ''}</span>
									</div>
									<div class="rdap-row">
										<span class="rdap-label">Digest</span>
										<span class="rdap-val mono">{DIGEST_NAMES[ds.digestType] ?? ds.digestType}</span>
									</div>
									<div class="rdap-row rdap-row-wrap">
										<span class="rdap-label">Hash</span>
										<span class="rdap-val mono small break">{ds.digest}</span>
									</div>
								{/each}
								{#each keyData as kd, i}
									<div class="rdap-separator">{i === 0 ? 'Key Record' : `Key Record ${i + 1}`}</div>
									<div class="rdap-row">
										<span class="rdap-label">Flags</span>
										<span class="rdap-val mono">{kd.flags}</span>
									</div>
									<div class="rdap-row">
										<span class="rdap-label">Protocol</span>
										<span class="rdap-val mono">{kd.protocol}</span>
									</div>
									<div class="rdap-row">
										<span class="rdap-label">Algorithm</span>
										<span class="rdap-val mono">{kd.algorithm}{ALGO_NAMES[kd.algorithm] ? ` — ${ALGO_NAMES[kd.algorithm]}` : ''}</span>
									</div>
									<div class="rdap-row rdap-row-wrap">
										<span class="rdap-label">Public Key</span>
										<span class="rdap-val mono small break">{kd.publicKey}</span>
									</div>
								{/each}
							</div>

							<!-- Nameservers -->
							{#if nsArr.length}
								<div class="rdap-card">
									<div class="rdap-card-title">Nameservers</div>
									{#each nsArr as ns}
										{@const ips = getNameserverIPs(ns)}
										<div class="ns-entry">
											<div class="ns-name">
												<span class="ns-arrow">›</span>
												<span class="rdap-val mono">{String((ns as Record<string,unknown>).ldhName ?? '')}</span>
											</div>
											{#if ips.v4.length || ips.v6.length}
												<div class="ns-ips">
													{#each ips.v4 as ip}<span class="ip-tag v4">{ip}</span>{/each}
													{#each ips.v6 as ip}<span class="ip-tag v6">{ip}</span>{/each}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}

							<!-- Entities (registrar, contacts…) -->
							{#each entities as entity}
								{@const vcard = entity.vcard}
								{@const primaryRole = entity.roles[0] ?? 'other'}
								{@const roleLabel = ROLE_LABELS[primaryRole] ?? primaryRole}
								{@const hasData = !vcardIsEmpty(vcard) || entity.handle || entity.publicIds?.length}

								{#if hasData}
									<div class="rdap-card">
										<div class="rdap-card-title">
											{roleLabel}
											{#if entity.roles.length > 1}
												<span class="role-extra">+{entity.roles.slice(1).map(r => ROLE_LABELS[r] ?? r).join(', ')}</span>
											{/if}
										</div>

										{#if entity.handle}
											<div class="rdap-row">
												<span class="rdap-label">Handle</span>
												<span class="rdap-val mono dim">{entity.handle}</span>
											</div>
										{/if}

										{#if entity.publicIds?.length}
											{#each entity.publicIds as pid}
												<div class="rdap-row">
													<span class="rdap-label">{pid.type.replace('IANA ', '')}</span>
													<span class="rdap-val mono">{pid.identifier}</span>
												</div>
											{/each}
										{/if}

										{#if vcard.name}
											<div class="rdap-row">
												<span class="rdap-label">Name</span>
												<span class="rdap-val">{vcard.name}</span>
											</div>
										{/if}

										{#if vcard.org && vcard.org !== vcard.name}
											<div class="rdap-row">
												<span class="rdap-label">Org</span>
												<span class="rdap-val">{vcard.org}</span>
											</div>
										{/if}

										{#if vcard.emails?.length}
											{#each vcard.emails as email}
												<div class="rdap-row">
													<span class="rdap-label">Email</span>
													<span class="rdap-val mono">{email}</span>
												</div>
											{/each}
										{/if}

										{#if vcard.phones?.length}
											{#each vcard.phones as phone}
												<div class="rdap-row">
													<span class="rdap-label">Phone</span>
													<span class="rdap-val mono">{phone}</span>
												</div>
											{/each}
										{/if}

										{#if vcard.fax?.length}
											{#each vcard.fax as fax}
												<div class="rdap-row">
													<span class="rdap-label">Fax</span>
													<span class="rdap-val mono">{fax}</span>
												</div>
											{/each}
										{/if}

										{#if vcard.url}
											<div class="rdap-row">
												<span class="rdap-label">URL</span>
												<span class="rdap-val mono small">{vcard.url}</span>
											</div>
										{/if}

										{#if vcard.address}
											{@const a = vcard.address}
											<div class="rdap-row rdap-row-wrap">
												<span class="rdap-label">Address</span>
												<div class="address-block">
													{#if a.street}  <span>{a.street}</span>   {/if}
													{#if a.city || a.state || a.postal}
														<span>
															{[a.city, a.state, a.postal].filter(Boolean).join(', ')}
														</span>
													{/if}
													{#if a.country}<span>{a.country}</span>{/if}
												</div>
											</div>
										{/if}

										{#if entity.status?.length}
											<div class="rdap-row rdap-row-wrap">
												<span class="rdap-label">Status</span>
												<div class="status-tags">
													{#each entity.status as s}<span class="status-tag">{s}</span>{/each}
												</div>
											</div>
										{/if}

										<!-- Nested entities (e.g. abuse contact inside registrar) -->
										{#each entity.nested as nested}
											{@const nvc = nested.vcard}
											{@const nRole = nested.roles[0] ?? 'other'}
											{#if !vcardIsEmpty(nvc)}
												<div class="rdap-separator">{ROLE_LABELS[nRole] ?? nRole}</div>
												{#if nvc.name}<div class="rdap-row"><span class="rdap-label">Name</span><span class="rdap-val">{nvc.name}</span></div>{/if}
												{#if nvc.emails?.length}{#each nvc.emails as e}<div class="rdap-row"><span class="rdap-label">Email</span><span class="rdap-val mono">{e}</span></div>{/each}{/if}
												{#if nvc.phones?.length}{#each nvc.phones as p}<div class="rdap-row"><span class="rdap-label">Phone</span><span class="rdap-val mono">{p}</span></div>{/each}{/if}
												{#if nvc.fax?.length}{#each nvc.fax as f}<div class="rdap-row"><span class="rdap-label">Fax</span><span class="rdap-val mono">{f}</span></div>{/each}{/if}
											{/if}
										{/each}

									</div>
								{/if}
							{/each}

							<!-- Links -->
							{#if links.filter(l => l.rel !== 'self').length}
								<div class="rdap-card">
									<div class="rdap-card-title">Links</div>
									{#each links as link}
										{#if link.href && link.rel !== 'self'}
											<div class="rdap-row">
												<span class="rdap-label">{link.rel ?? 'link'}</span>
												<span class="rdap-val mono small break">{link.href}</span>
											</div>
										{/if}
									{/each}
								</div>
							{/if}

							<!-- Notices -->
							{#if notices.length}
								<div class="rdap-card">
									<div class="rdap-card-title">Notices</div>
									{#each notices as notice, i}
										<div class="notice-item" class:open={openNotices.has(i)}>
											<button class="notice-toggle" onclick={() => toggleNotice(i)}>
												<span class="notice-toggle-title">{notice.title ?? 'Notice'}</span>
												<span class="notice-chevron" class:rotated={openNotices.has(i)}>›</span>
											</button>
											{#if openNotices.has(i)}
												<div class="notice-body" transition:slide={{ duration: 150 }}>
													{#each notice.description ?? [] as line}
														<p class="notice-desc">{line}</p>
													{/each}
													{#if notice.links?.length}
														<div class="notice-links">
															{#each notice.links as link}
																{#if link.href}
																	<a
																		class="notice-link"
																		href={link.href}
																		target="_blank"
																		rel="noopener noreferrer"
																	>{link.href}</a>
																{/if}
															{/each}
														</div>
													{/if}
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}

						</div><!-- /rdap-cards -->
					{/if}
				</section>

			</div><!-- /results-grid -->

			<!-- ════════════════ PROPAGATION ════════════════ -->
			{#if propLoading || propResults.length > 0}
				<div class="prop-section" transition:fade={{ duration: 200 }}>
					<div class="prop-header">
						<span class="prop-title">PROPAGATION</span>
						{#if !propLoading}
							<span class="prop-meta">
								A record · {propResults.filter(r => r.status === 'ok').length}/{propResults.length} resolvers responded
							</span>
						{/if}
					</div>

					{#if propLoading}
						<div class="prop-loading">
							<svg class="spinner-svg" viewBox="0 0 66 66" width="28" height="28">
								<circle cx="33" cy="33" r="28" fill="none" stroke="rgba(0,0,0,0.44)" stroke-width="10"/>
								<circle cx="33" cy="33" r="28" fill="none" stroke="rgba(254,229,0,1)" stroke-width="10"
									stroke-dasharray="44 132" stroke-linecap="round" class="spinner-arc"/>
							</svg>
							<span class="prop-loading-text">Querying resolvers&hellip;</span>
						</div>
					{:else}
						<!-- World map (d3-geo Natural Earth projection) -->
						<div class="map-wrap">
							<svg class="world-map" viewBox="0 0 {MAP_W} {MAP_H}" preserveAspectRatio="xMidYMid meet">
								<path d={spherePath} class="sphere-bg"/>
								<path d={gratPath}   class="graticule"/>
								<path d={landPath}   class="land"/>
								<path d={spherePath} class="sphere-border"/>
								{#each propResults as r}
									{@const pos = project(r.lon, r.lat)}
									{#if pos}
										<circle
											class="resolver-dot"
											cx={pos[0]} cy={pos[1]} r="5"
											fill={propColor(r)}
											stroke="var(--bg)" stroke-width="1.5"
											onmouseenter={(e) => { mapTooltip = { r, x: e.clientX, y: e.clientY }; }}
											onmousemove={(e) => { mapTooltip = { r, x: e.clientX, y: e.clientY }; }}
											onmouseleave={() => { mapTooltip = null; }}
										/>
									{/if}
								{/each}
							</svg>
						</div>

						{#if mapTooltip}
							{@const tt = mapTooltip}
							<div class="map-tooltip" style="left:{tt.x}px;top:{tt.y}px">
								<span class="tt-header">
									<span class="fi fi-{tt.r.iso}"></span>
									{tt.r.name} · {tt.r.city}
								</span>
								{#if tt.r.ips.length}
									{#each tt.r.ips as ip}<span class="tt-ip">{ip}</span>{/each}
									<span class="tt-meta">TTL {tt.r.ttl}s · {tt.r.ms}ms</span>
								{:else}
									<span class="tt-status">{tt.r.status} · {tt.r.ms}ms</span>
								{/if}
							</div>
						{/if}

						<!-- Resolver rows -->
						<div class="resolver-list">
							{#each propResults as r}
								{@const col = propColor(r)}
								<div class="resolver-row">
									<span class="r-flag">{r.flag}</span>
									<span class="r-city">{r.city}</span>
									<span class="r-name">{r.name}</span>
									<span class="r-ips">
										{#if r.ips.length}
											{#each r.ips as ip}<span class="r-ip">{ip}</span>{/each}
										{:else}
											<span class="r-noip">{r.status}</span>
										{/if}
									</span>
									{#if r.ttl !== null}
										<span class="r-ttl">TTL {r.ttl}s</span>
									{:else}
										<span class="r-ttl dim">—</span>
									{/if}
									<span class="r-ms dim">{r.ms}ms</span>
									<span class="r-dot" style="color:{col}">●</span>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			{/if}

		</div><!-- /results-container -->
		{/if}<!-- /dnsLoading -->
	</div><!-- /results-layout -->
{/if}

<style>
	/* ─── Shared search tokens ──────────────────────────────────────────────── */

	.search-prefix {
		font-family: var(--mono);
		color: var(--accent);
		font-size: 1rem;
		font-weight: 600;
		flex-shrink: 0;
		user-select: none;
		padding: 0 0.5rem 0 0;
	}

	.search-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: var(--text);
		font-family: var(--mono);
		font-size: 1rem;
		padding: 0.875rem 0;
		min-width: 0;
	}

	.search-input::placeholder { color: var(--text-dim); }

	.search-btn {
		flex-shrink: 0;
		background: var(--accent);
		color: var(--accent-text);
		border: none;
		border-radius: 0 5px 5px 0;
		padding: 0 1.5rem;
		min-height: 3.125rem;
		font-family: var(--mono);
		font-size: 0.78rem;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		cursor: pointer;
		transition: opacity 0.15s;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.search-btn:disabled { opacity: 0.35; cursor: not-allowed; }
	.search-btn:not(:disabled):hover { opacity: 0.82; }

	.spinner {
		width: 13px; height: 13px;
		border: 2px solid rgba(0,0,0,0.25);
		border-top-color: #000;
		border-radius: 50%;
		animation: spin 0.55s linear infinite;
	}

	@keyframes spin { to { transform: rotate(360deg); } }

	/* ─── Hero layout ───────────────────────────────────────────────────────── */

	.hero-layout {
		min-height: 100dvh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 3rem 1.5rem;
	}

	.hero-inner {
		width: 100%;
		max-width: 680px;
		display: flex;
		flex-direction: column;
		gap: 2.5rem;
	}

	header { display: flex; flex-direction: column; gap: 0.4rem; }

	.brand { display: flex; align-items: baseline; }

	.brand-name {
		font-family: var(--mono);
		font-size: 2.25rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}

	.brand-cursor {
		font-family: var(--mono);
		font-size: 2.25rem;
		font-weight: 600;
		color: var(--accent);
		animation: blink 1.1s step-end infinite;
	}

	@keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

	.brand-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.hero-search { display: flex; flex-direction: column; gap: 0.75rem; }

	.search-wrap {
		display: flex;
		align-items: center;
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 6px;
		padding-left: 1rem;
		transition: border-color 0.15s;
	}

	.search-wrap:focus-within { border-color: var(--accent); }

	.hero-hint { font-size: 0.72rem; color: var(--text-muted); padding-left: 0.25rem; }

	/* ─── Results layout ────────────────────────────────────────────────────── */

	.results-layout {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	.top-bar {
		position: sticky;
		top: 0;
		z-index: 50;
		background: rgba(0,0,0,0.92);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid var(--border);
	}

	.top-bar-inner {
		display: flex;
		align-items: center;
		gap: 1rem;
		max-width: 1280px;
		margin: 0 auto;
		padding: 0.625rem 1.5rem;
	}

	.top-brand {
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.25rem 0;
		flex-shrink: 0;
	}

	.top-brand-text {
		font-family: var(--mono);
		font-size: 1rem;
		font-weight: 600;
		color: var(--accent);
	}

	.top-search-wrap {
		flex: 1;
		display: flex;
		align-items: center;
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 6px;
		padding-left: 1rem;
		transition: border-color 0.15s;
	}

	.top-search-wrap:focus-within { border-color: var(--accent); }
	.top-search-wrap .search-input { padding: 0.6rem 0; font-size: 0.9rem; }
	.top-search-wrap .search-btn { min-height: 2.625rem; font-size: 0.72rem; padding: 0 1.2rem; }

	.results-container {
		flex: 1;
		max-width: 1280px;
		width: 100%;
		margin: 0 auto;
		padding: 1.5rem 1.5rem 5rem;
	}

	.domain-label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.domain-text { font-family: var(--mono); font-size: 0.9rem; font-weight: 600; color: var(--text-muted); }

	.badge { font-family: var(--mono); font-size: 0.68rem; padding: 0.15rem 0.5rem; border-radius: 3px; }
	.badge.scanning { background: var(--accent-dim); color: var(--accent); border: 1px solid rgba(254,229,0,0.2); }

	.results-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		align-items: start;
	}

	/* ─── Column shared ─────────────────────────────────────────────────────── */

	.col { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }

	.col-header {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
		padding-bottom: 0.75rem;
		border-bottom: 1px solid var(--border);
	}

	.col-title {
		font-family: var(--mono);
		font-size: 0.7rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.col-meta { font-size: 0.72rem; color: var(--text-muted); font-family: var(--mono); }
	.col-error { font-size: 0.82rem; color: var(--error); font-family: var(--mono); }
	.col-empty { display: flex; flex-direction: column; align-items: center; gap: 0.6rem; padding: 2.5rem 0; color: var(--text-muted); font-size: 0.82rem; }
	.empty-glyph { font-size: 1.5rem; opacity: 0.25; }

	/* ─── Skeleton ──────────────────────────────────────────────────────────── */

	.skeletons { display: flex; flex-direction: column; gap: 0.5rem; }

	.skeleton {
		height: 52px;
		border-radius: 5px;
		background: linear-gradient(90deg, var(--surface) 25%, var(--surface-2) 50%, var(--surface) 75%);
		background-size: 200% 100%;
		animation: shimmer 1.4s infinite;
	}

	.skeleton:nth-child(2) { animation-delay: 0.1s; height: 44px; }
	.skeleton:nth-child(3) { animation-delay: 0.2s; height: 60px; }
	.skeleton:nth-child(4) { animation-delay: 0.3s; height: 44px; }

	@keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

	/* ─── Group filter ──────────────────────────────────────────────────────── */

	.group-filter { display: flex; gap: 0.3rem; flex-wrap: wrap; }

	.group-btn {
		background: var(--surface);
		border: 1px solid var(--border);
		color: var(--text-muted);
		font-family: var(--mono);
		font-size: 0.68rem;
		font-weight: 500;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		padding: 0.25rem 0.6rem;
		border-radius: 3px;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.3rem;
		transition: all 0.12s;
	}

	.group-btn:hover { border-color: var(--border-hover); color: var(--text); }
	.group-btn.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
	.group-count { opacity: 0.65; font-size: 0.62rem; }

	/* ─── DNS records ───────────────────────────────────────────────────────── */

	.records-list { display: flex; flex-direction: column; gap: 0.5rem; }

	.record-block {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 5px;
		overflow: hidden;
		transition: border-color 0.12s;
	}

	.record-block:hover { border-color: var(--border-hover); }

	.record-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}

	.record-type-row { display: flex; align-items: center; gap: 0.6rem; }

	.type-badge {
		font-family: var(--mono);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--accent);
		letter-spacing: 0.05em;
		min-width: 4rem;
	}

	.type-desc { font-size: 0.7rem; color: var(--text-muted); }

	.record-count-badge {
		font-family: var(--mono);
		font-size: 0.65rem;
		color: var(--text-muted);
		background: var(--border);
		padding: 0.1rem 0.4rem;
		border-radius: 2px;
	}

	.record-entries { display: flex; flex-direction: column; }

	.record-entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.75rem;
		gap: 0.75rem;
		border-bottom: 1px solid var(--border);
	}

	.record-entry:last-child { border-bottom: none; }
	.record-data { font-family: var(--mono); font-size: 0.78rem; word-break: break-all; flex: 1; }
	.record-ttl { font-family: var(--mono); font-size: 0.68rem; color: var(--text-muted); flex-shrink: 0; }

	/* ─── RDAP cards ────────────────────────────────────────────────────────── */

	.rdap-cards { display: flex; flex-direction: column; gap: 0.5rem; }

	.rdap-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 0.875rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.rdap-card-title {
		font-family: var(--mono);
		font-size: 0.62rem;
		font-weight: 600;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--text-muted);
		padding-bottom: 0.45rem;
		border-bottom: 1px solid var(--border);
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.role-extra {
		font-size: 0.58rem;
		color: var(--text-dim);
		text-transform: none;
		letter-spacing: 0;
		font-weight: 400;
	}

	.rdap-row { display: flex; align-items: baseline; gap: 0.5rem; }
	.rdap-row-wrap { align-items: flex-start; flex-wrap: wrap; }

	.rdap-label {
		font-size: 0.67rem;
		font-family: var(--mono);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		min-width: 5.5rem;
		flex-shrink: 0;
	}

	.rdap-val { font-size: 0.82rem; color: var(--text); }
	.rdap-val.mono { font-family: var(--mono); font-size: 0.78rem; }
	.rdap-val.dim { color: var(--text-muted); }
	.rdap-val.small { font-size: 0.72rem; }
	.rdap-val.break { word-break: break-all; overflow-wrap: anywhere; }
	.rdap-val.accent-text { color: var(--accent); }

	.rdap-separator {
		font-family: var(--mono);
		font-size: 0.6rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: var(--accent);
		opacity: 0.7;
		margin-top: 0.25rem;
		padding-top: 0.5rem;
		border-top: 1px dashed var(--border);
	}

	.status-tags { display: flex; flex-wrap: wrap; gap: 0.25rem; }

	.status-tag {
		font-family: var(--mono);
		font-size: 0.62rem;
		padding: 0.12rem 0.4rem;
		border-radius: 2px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-muted);
	}

	/* ─── Nameservers ───────────────────────────────────────────────────────── */

	.ns-entry { display: flex; flex-direction: column; gap: 0.2rem; padding: 0.1rem 0; }

	.ns-name { display: flex; align-items: center; gap: 0.4rem; }

	.ns-arrow { color: var(--accent); font-size: 0.75rem; font-weight: 700; }

	.ns-ips { display: flex; flex-wrap: wrap; gap: 0.25rem; padding-left: 1rem; }

	.ip-tag {
		font-family: var(--mono);
		font-size: 0.65rem;
		padding: 0.1rem 0.35rem;
		border-radius: 2px;
		border: 1px solid var(--border);
	}

	.ip-tag.v4 { color: var(--accent); background: var(--accent-dim); border-color: rgba(254,229,0,0.15); }
	.ip-tag.v6 { color: #7eb8ff; background: rgba(126,184,255,0.07); border-color: rgba(126,184,255,0.15); }

	/* ─── Address ───────────────────────────────────────────────────────────── */

	.address-block {
		display: flex;
		flex-direction: column;
		gap: 0.1rem;
		font-size: 0.8rem;
		color: var(--text);
	}

	/* ─── Notices accordion ─────────────────────────────────────────────────── */

	.notice-item {
		border-bottom: 1px solid var(--border);
	}
	.notice-item:last-child { border-bottom: none; }

	.notice-toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		background: transparent;
		border: none;
		padding: 0.55rem 0;
		cursor: pointer;
		gap: 0.5rem;
		text-align: left;
	}

	.notice-toggle:hover .notice-toggle-title { color: var(--text); }

	.notice-toggle-title {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-muted);
		transition: color 0.12s;
		flex: 1;
	}

	.notice-item.open .notice-toggle-title { color: var(--text); }

	.notice-chevron {
		font-size: 0.9rem;
		color: var(--text-muted);
		transition: transform 0.2s ease, color 0.12s;
		flex-shrink: 0;
		line-height: 1;
	}

	.notice-chevron.rotated { transform: rotate(90deg); color: var(--accent); }

	.notice-body {
		padding-bottom: 0.65rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.notice-desc { font-size: 0.72rem; color: var(--text-muted); line-height: 1.55; }

	.notice-links { display: flex; flex-direction: column; gap: 0.2rem; margin-top: 0.15rem; }

	.notice-link {
		font-family: var(--mono);
		font-size: 0.68rem;
		color: var(--accent);
		text-decoration: none;
		opacity: 0.75;
		word-break: break-all;
	}

	.notice-link:hover { opacity: 1; text-decoration: underline; }

	/* ─── Globe loading screen ──────────────────────────────────────────────── */

	.globe-screen {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2.25rem;
		padding: 3rem 1.5rem;
	}



	.spinner-arc {
		transform-box: fill-box;
		transform-origin: center;
		animation: spin 0.99s linear infinite;
	}

	@keyframes spin {
		from { transform: rotate(-90deg); }
		to   { transform: rotate(270deg); }
	}

	.globe-info {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.4rem;
	}

	.globe-domain {
		font-family: var(--mono);
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text);
	}

	.globe-status {
		font-family: var(--mono);
		font-size: 0.68rem;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		animation: pulse-opacity 2s ease-in-out infinite;
	}

	@keyframes pulse-opacity {
		0%, 100% { opacity: 0.3; }
		50%       { opacity: 0.8; }
	}

	/* ─── Responsive ────────────────────────────────────────────────────────── */

	@media (max-width: 840px) {
		.results-grid { grid-template-columns: 1fr; }
		.type-desc { display: none; }
	}

	@media (max-width: 520px) {
		.hero-layout { padding: 2rem 1rem; }
		.brand-name, .brand-cursor { font-size: 1.75rem; }
		.search-btn { padding: 0 1rem; }
		.results-container { padding: 1rem 1rem 4rem; }
		.top-bar-inner { padding: 0.5rem 1rem; }
	}

	/* ─── Propagation ────────────────────────────────────────────────────────── */

	.prop-section {
		margin-top: 2.5rem;
		border-top: 1px solid var(--border);
		padding-top: 1.75rem;
	}

	.prop-header {
		display: flex;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 1.25rem;
	}

	.prop-title {
		font-family: var(--mono);
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		color: var(--accent);
	}

	.prop-meta {
		font-family: var(--mono);
		font-size: 0.68rem;
		color: var(--text-muted);
	}

	.prop-loading {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 1.5rem 0;
	}

	.prop-loading-text {
		font-family: var(--mono);
		font-size: 0.75rem;
		color: var(--text-muted);
	}

	/* Map */
	.map-wrap {
		width: 100%;
		background: #040404;
		border: 1px solid var(--border);
		border-radius: 6px;
		overflow: hidden;
		margin-bottom: 1.25rem;
	}

	.world-map {
		width: 100%;
		height: auto;
		display: block;
	}

	.sphere-bg     { fill: #060606; }
	.sphere-border { fill: none; stroke: #222; stroke-width: 1; }
	.graticule     { fill: none; stroke: #111; stroke-width: 0.4; }
	.land          { fill: #141414; stroke: #252525; stroke-width: 0.5; }

	.resolver-dot { transition: r 0.15s ease; cursor: default; }
	.resolver-dot:hover { r: 7; }

	.map-tooltip {
		position: fixed;
		pointer-events: none;
		z-index: 200;
		transform: translate(14px, -50%);
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		padding: 0.45rem 0.65rem;
		display: flex;
		flex-direction: column;
		gap: 0.18rem;
		font-family: var(--mono);
		font-size: 0.7rem;
		white-space: nowrap;
		box-shadow: 0 4px 16px rgba(0,0,0,0.5);
	}
	.tt-header { display: flex; align-items: center; gap: 0.45rem; color: var(--text); font-weight: 600; margin-bottom: 0.1rem; }
	.tt-header .fi { width: 18px; height: 13px; border-radius: 2px; flex-shrink: 0; }
	.tt-ip     { color: var(--accent); }
	.tt-meta   { color: var(--text-muted); margin-top: 0.1rem; }
	.tt-status { color: #ef4444; }

	/* Resolver list */
	.resolver-list {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.resolver-row {
		display: grid;
		grid-template-columns: 1.4rem 9rem 7rem 1fr auto auto 1rem;
		align-items: center;
		gap: 0.5rem 0.75rem;
		padding: 0.45rem 0;
		border-bottom: 1px solid #0f0f0f;
		font-family: var(--mono);
		font-size: 0.73rem;
	}

	.r-flag { font-size: 0.85rem; }

	.r-city {
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.r-name {
		color: var(--text-dim);
		white-space: nowrap;
	}

	.r-ips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.r-ip {
		color: var(--text);
		background: var(--surface);
		padding: 0.1rem 0.35rem;
		border-radius: 3px;
		font-size: 0.7rem;
	}

	.r-noip {
		color: #555;
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.r-ttl { color: var(--text-dim); font-size: 0.68rem; white-space: nowrap; }
	.r-ms  { color: var(--text-dim); font-size: 0.68rem; white-space: nowrap; text-align: right; }
	.r-dot { font-size: 0.6rem; line-height: 1; text-align: right; }
	.dim   { color: #444 !important; }

	@media (max-width: 600px) {
		.resolver-row {
			grid-template-columns: 1.4rem 1fr auto 1rem;
			grid-template-rows: auto auto;
		}
		.r-name { display: none; }
		.r-ttl  { display: none; }
	}
</style>
