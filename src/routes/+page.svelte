<script lang="ts">
	import { fade } from 'svelte/transition';
	import { DNS_GROUPS, DNS_TYPE_INFO, ALL_DNS_TYPES, formatTTL } from '$lib/dns-types';
	import type { DnsTypeResult } from '$lib/dns-types';

	type GroupKey = keyof typeof DNS_GROUPS | 'all';

	let query = $state('');
	let activeGroup = $state<GroupKey>('core');
	let submittedDomain = $state('');

	let dnsRecords = $state<Record<string, DnsTypeResult>>({});
	let rdapData = $state<Record<string, unknown> | null>(null);
	let dnsLoading = $state(false);
	let rdapLoading = $state(false);
	let dnsError = $state('');
	let rdapError = $state('');

	const groups: { key: GroupKey; label: string }[] = [
		{ key: 'core', label: 'Core' },
		{ key: 'security', label: 'Security' },
		{ key: 'services', label: 'Services' },
		{ key: 'advanced', label: 'Advanced' },
		{ key: 'all', label: 'All' }
	];

	function getTypesForGroup(group: GroupKey): string[] {
		if (group === 'all') return [...ALL_DNS_TYPES];
		return [...DNS_GROUPS[group].types];
	}

	const filteredRecords = $derived(() => {
		const types = getTypesForGroup(activeGroup);
		return Object.fromEntries(
			Object.entries(dnsRecords).filter(([t]) => types.includes(t))
		);
	});

	const totalDnsFound = $derived(() =>
		Object.values(dnsRecords).reduce((s, r) => s + (r as DnsTypeResult).answers.length, 0)
	);

	const typesWithResults = $derived(() =>
		Object.entries(dnsRecords).filter(([, r]) => (r as DnsTypeResult).answers.length > 0)
	);

	function countForGroup(key: GroupKey): number {
		const types = getTypesForGroup(key);
		return Object.keys(dnsRecords).filter((t) => types.includes(t)).length;
	}

	async function submit() {
		const raw = query.trim();
		if (!raw || dnsLoading || rdapLoading) return;

		const domain = raw.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');

		submittedDomain = domain;
		dnsRecords = {};
		rdapData = null;
		dnsError = '';
		rdapError = '';

		searchDNS(domain);
		searchRDAP(domain);
	}

	async function searchDNS(domain: string) {
		dnsLoading = true;
		try {
			const types = [...ALL_DNS_TYPES].join(',');
			const res = await fetch(`/api/dns?domain=${encodeURIComponent(domain)}&types=${types}`);
			const data = await res.json();
			if (data.error) dnsError = data.error;
			else dnsRecords = data.records ?? {};
		} catch {
			dnsError = 'DNS query failed';
		} finally {
			dnsLoading = false;
		}
	}

	async function searchRDAP(domain: string) {
		rdapLoading = true;
		try {
			const res = await fetch(`/api/rdap?domain=${encodeURIComponent(domain)}`);
			const data = await res.json();
			if (data.error) rdapError = data.error;
			else rdapData = data;
		} catch {
			rdapError = 'RDAP query failed';
		} finally {
			rdapLoading = false;
		}
	}

	function reset() {
		submittedDomain = '';
		query = '';
		dnsRecords = {};
		rdapData = null;
		dnsError = '';
		rdapError = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') submit();
	}

	// ─── RDAP helpers ────────────────────────────────────────────────────────────

	function getEvent(events: unknown[], action: string): string | undefined {
		if (!Array.isArray(events)) return undefined;
		const ev = events.find((e: unknown) => (e as { eventAction?: string }).eventAction === action);
		return (ev as { eventDate?: string } | undefined)?.eventDate;
	}

	function fmtDate(iso?: string): string {
		if (!iso) return '—';
		return new Date(iso).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function getRegistrar(entities: unknown[]): Record<string, unknown> | null {
		if (!Array.isArray(entities)) return null;
		return (
			(entities.find((e: unknown) => {
				const ent = e as { roles?: string[] };
				return ent.roles?.includes('registrar');
			}) as Record<string, unknown>) ?? null
		);
	}

	function getVcardField(vcard: unknown[], key: string): string {
		if (!Array.isArray(vcard?.[1])) return '';
		const field = vcard[1].find((f: unknown) => Array.isArray(f) && f[0] === key);
		if (!field || !Array.isArray(field)) return '';
		const val = field[3];
		return Array.isArray(val) ? val[0] : String(val ?? '');
	}

	function getRegistrarName(registrar: Record<string, unknown> | null): string {
		if (!registrar) return '—';
		const vcard = registrar.vcardArray as unknown[];
		if (vcard) return getVcardField(vcard, 'fn') || String(registrar.handle ?? '—');
		return String(registrar.handle ?? '—');
	}

	function getRegistrarIanaId(registrar: Record<string, unknown> | null): string {
		if (!registrar) return '—';
		const pubIds = registrar.publicIds as { type?: string; identifier?: string }[] | undefined;
		if (!Array.isArray(pubIds)) return '—';
		const iana = pubIds.find((p) => p.type === 'IANA Registrar ID');
		return iana?.identifier ?? '—';
	}

	function getNameservers(data: Record<string, unknown>): string[] {
		const ns = data.nameservers as { ldhName?: string }[] | undefined;
		if (!Array.isArray(ns)) return [];
		return ns.map((n) => n.ldhName ?? '').filter(Boolean);
	}

	function getStatuses(data: Record<string, unknown>): string[] {
		const s = data.status as string[] | undefined;
		return Array.isArray(s) ? s : [];
	}

	function isDnssecSigned(data: Record<string, unknown>): boolean {
		return !!(data.secureDNS as { delegationSigned?: boolean } | undefined)?.delegationSigned;
	}
</script>

<svelte:head>
	<title>whois — DNS & RDAP lookup</title>
</svelte:head>

<!-- ═══════════════════════════════════════════════════════════════════════════
     PRE-SEARCH  —  full-page centered hero
════════════════════════════════════════════════════════════════════════════ -->
{#if !submittedDomain}
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
     POST-SEARCH  —  sticky top bar + two-column results
════════════════════════════════════════════════════════════════════════════ -->
{:else}
	<div class="results-layout" transition:fade={{ duration: 150 }}>

		<!-- Sticky search bar -->
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

		<!-- Two-column results -->
		<div class="results-container">
			<div class="domain-label">
				<span class="domain-text">{submittedDomain}</span>
				{#if dnsLoading || rdapLoading}
					<span class="badge scanning">scanning</span>
				{/if}
			</div>

			<div class="results-grid">

				<!-- ──────────────── DNS COLUMN ──────────────── -->
				<section class="col dns-col">
					<div class="col-header">
						<span class="col-title">DNS</span>
						{#if !dnsLoading && !dnsError}
							<span class="col-meta">{totalDnsFound()} records · {Object.keys(dnsRecords).length} types</span>
						{/if}
					</div>

					<!-- Group filter -->
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
									{#if n > 0}
										<span class="group-count">{n}</span>
									{/if}
								{/if}
							</button>
						{/each}
					</div>

					<!-- DNS content -->
					{#if dnsLoading}
						<div class="skeletons">
							{#each { length: 5 } as _}
								<div class="skeleton"></div>
							{/each}
						</div>
					{:else if dnsError}
						<div class="col-error">{dnsError}</div>
					{:else if Object.keys(filteredRecords()).length === 0}
						<div class="col-empty">
							<span class="empty-glyph">◌</span>
							No records in this group
						</div>
					{:else}
						<div class="records-list">
							{#each Object.entries(filteredRecords()) as [type, result]}
								{@const info = DNS_TYPE_INFO[type]}
								{@const res = result as DnsTypeResult}
								<div class="record-block">
									<div class="record-head">
										<div class="record-type-row">
											<span class="type-badge">{type}</span>
											{#if info}
												<span class="type-desc">{info.description}</span>
											{/if}
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

				<!-- ──────────────── RDAP COLUMN ──────────────── -->
				<section class="col rdap-col">
					<div class="col-header">
						<span class="col-title">RDAP</span>
						{#if rdapData && !rdapLoading}
							<span class="col-meta">Registration data</span>
						{/if}
					</div>

					{#if rdapLoading}
						<div class="skeletons">
							{#each { length: 6 } as _}
								<div class="skeleton"></div>
							{/each}
						</div>
					{:else if rdapError}
						<div class="col-error">{rdapError}</div>
					{:else if !rdapData}
						<div class="col-empty">
							<span class="empty-glyph">◌</span>
							No RDAP data available
						</div>
					{:else}
						{@const events = rdapData.events as unknown[]}
						{@const registrar = getRegistrar(rdapData.entities as unknown[])}
						{@const nameservers = getNameservers(rdapData)}
						{@const statuses = getStatuses(rdapData)}
						{@const dnssec = isDnssecSigned(rdapData)}

						<div class="rdap-cards">

							<div class="rdap-card">
								<div class="rdap-card-title">Domain</div>
								<div class="rdap-row">
									<span class="rdap-label">Handle</span>
									<span class="rdap-val mono">{rdapData.handle ?? '—'}</span>
								</div>
								<div class="rdap-row">
									<span class="rdap-label">DNSSEC</span>
									<span class="rdap-val" class:accent-text={dnssec}>
										{dnssec ? 'Signed ✓' : 'Unsigned'}
									</span>
								</div>
								<div class="rdap-row rdap-row-wrap">
									<span class="rdap-label">Status</span>
									<div class="status-tags">
										{#each statuses as s}
											<span class="status-tag">{s}</span>
										{:else}
											<span class="rdap-val">—</span>
										{/each}
									</div>
								</div>
							</div>

							<div class="rdap-card">
								<div class="rdap-card-title">Timeline</div>
								<div class="rdap-row">
									<span class="rdap-label">Registered</span>
									<span class="rdap-val mono">{fmtDate(getEvent(events, 'registration'))}</span>
								</div>
								<div class="rdap-row">
									<span class="rdap-label">Expires</span>
									<span class="rdap-val mono">{fmtDate(getEvent(events, 'expiration'))}</span>
								</div>
								<div class="rdap-row">
									<span class="rdap-label">Updated</span>
									<span class="rdap-val mono">{fmtDate(getEvent(events, 'last changed'))}</span>
								</div>
							</div>

							<div class="rdap-card">
								<div class="rdap-card-title">Registrar</div>
								<div class="rdap-row">
									<span class="rdap-label">Name</span>
									<span class="rdap-val">{getRegistrarName(registrar)}</span>
								</div>
								<div class="rdap-row">
									<span class="rdap-label">IANA ID</span>
									<span class="rdap-val mono">{getRegistrarIanaId(registrar)}</span>
								</div>
							</div>

							<div class="rdap-card">
								<div class="rdap-card-title">Nameservers</div>
								{#if nameservers.length === 0}
									<span class="rdap-val">—</span>
								{:else}
									<div class="ns-list">
										{#each nameservers as ns}
											<div class="ns-row">
												<span class="ns-arrow">›</span>
												<span class="rdap-val mono">{ns}</span>
											</div>
										{/each}
									</div>
								{/if}
							</div>

						</div>
					{/if}
				</section>

			</div>
		</div>
	</div>
{/if}

<style>
	/* ─── Shared tokens ─────────────────────────────────────────────────────── */

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

	.search-input::placeholder {
		color: var(--text-dim);
	}

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

	.search-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.search-btn:not(:disabled):hover {
		opacity: 0.82;
	}

	.spinner {
		width: 13px;
		height: 13px;
		border: 2px solid rgba(0, 0, 0, 0.25);
		border-top-color: #000;
		border-radius: 50%;
		animation: spin 0.55s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* ─── PRE-SEARCH HERO ───────────────────────────────────────────────────── */

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

	header {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
	}

	.brand {
		display: flex;
		align-items: baseline;
	}

	.brand-name {
		font-family: var(--mono);
		font-size: 2.25rem;
		font-weight: 600;
		letter-spacing: -0.02em;
		color: var(--text);
	}

	.brand-cursor {
		font-family: var(--mono);
		font-size: 2.25rem;
		font-weight: 600;
		color: var(--accent);
		animation: blink 1.1s step-end infinite;
	}

	@keyframes blink {
		0%, 100% { opacity: 1; }
		50%       { opacity: 0; }
	}

	.brand-sub {
		font-size: 0.78rem;
		color: var(--text-muted);
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.hero-search {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.search-wrap {
		display: flex;
		align-items: center;
		border: 1px solid var(--border);
		background: var(--surface);
		border-radius: 6px;
		padding-left: 1rem;
		transition: border-color 0.15s;
	}

	.search-wrap:focus-within {
		border-color: var(--accent);
	}

	.hero-hint {
		font-size: 0.72rem;
		color: var(--text-muted);
		padding-left: 0.25rem;
	}

	/* ─── POST-SEARCH LAYOUT ────────────────────────────────────────────────── */

	.results-layout {
		min-height: 100dvh;
		display: flex;
		flex-direction: column;
	}

	/* ─── Sticky top bar ───────────────────────────────────────────────────── */

	.top-bar {
		position: sticky;
		top: 0;
		z-index: 50;
		background: rgba(0, 0, 0, 0.92);
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
		letter-spacing: -0.02em;
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

	.top-search-wrap:focus-within {
		border-color: var(--accent);
	}

	.top-search-wrap .search-input {
		padding: 0.6rem 0;
		font-size: 0.9rem;
	}

	.top-search-wrap .search-btn {
		min-height: 2.625rem;
		font-size: 0.72rem;
		padding: 0 1.2rem;
	}

	/* ─── Results container ────────────────────────────────────────────────── */

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

	.domain-text {
		font-family: var(--mono);
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--text-muted);
	}

	.badge {
		font-family: var(--mono);
		font-size: 0.68rem;
		padding: 0.15rem 0.5rem;
		border-radius: 3px;
	}

	.badge.scanning {
		background: var(--accent-dim);
		color: var(--accent);
		border: 1px solid rgba(254, 229, 0, 0.2);
	}

	/* ─── Two-column grid ──────────────────────────────────────────────────── */

	.results-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 1.5rem;
		align-items: start;
	}

	/* ─── Column shared ────────────────────────────────────────────────────── */

	.col {
		display: flex;
		flex-direction: column;
		gap: 1rem;
		min-width: 0;
	}

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

	.col-meta {
		font-size: 0.72rem;
		color: var(--text-muted);
		font-family: var(--mono);
	}

	.col-error {
		font-size: 0.82rem;
		color: var(--error);
		padding: 0.5rem 0;
		font-family: var(--mono);
	}

	.col-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.6rem;
		padding: 2.5rem 0;
		color: var(--text-muted);
		font-size: 0.82rem;
	}

	.empty-glyph {
		font-size: 1.5rem;
		opacity: 0.25;
	}

	/* ─── Skeleton loader ──────────────────────────────────────────────────── */

	.skeletons {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.skeleton {
		height: 52px;
		border-radius: 5px;
		background: linear-gradient(
			90deg,
			var(--surface) 25%,
			var(--surface-2) 50%,
			var(--surface) 75%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s infinite;
	}

	.skeleton:nth-child(2) { animation-delay: 0.1s; }
	.skeleton:nth-child(3) { animation-delay: 0.2s; }
	.skeleton:nth-child(4) { animation-delay: 0.3s; }

	@keyframes shimmer {
		0%   { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	/* ─── Group filter ─────────────────────────────────────────────────────── */

	.group-filter {
		display: flex;
		gap: 0.3rem;
		flex-wrap: wrap;
	}

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

	.group-btn:hover {
		border-color: var(--border-hover);
		color: var(--text);
	}

	.group-btn.active {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--accent-text);
	}

	.group-count {
		opacity: 0.65;
		font-size: 0.62rem;
	}

	/* ─── DNS record blocks ────────────────────────────────────────────────── */

	.records-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.record-block {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 5px;
		overflow: hidden;
		transition: border-color 0.12s;
	}

	.record-block:hover {
		border-color: var(--border-hover);
	}

	.record-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}

	.record-type-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
	}

	.type-badge {
		font-family: var(--mono);
		font-size: 0.72rem;
		font-weight: 600;
		color: var(--accent);
		letter-spacing: 0.05em;
		min-width: 4rem;
	}

	.type-desc {
		font-size: 0.7rem;
		color: var(--text-muted);
	}

	.record-count-badge {
		font-family: var(--mono);
		font-size: 0.65rem;
		color: var(--text-muted);
		background: var(--border);
		padding: 0.1rem 0.4rem;
		border-radius: 2px;
	}

	.record-entries {
		display: flex;
		flex-direction: column;
	}

	.record-entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.45rem 0.75rem;
		gap: 0.75rem;
		border-bottom: 1px solid var(--border);
	}

	.record-entry:last-child {
		border-bottom: none;
	}

	.record-data {
		font-family: var(--mono);
		font-size: 0.78rem;
		color: var(--text);
		word-break: break-all;
		flex: 1;
	}

	.record-ttl {
		font-family: var(--mono);
		font-size: 0.68rem;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	/* ─── RDAP cards ───────────────────────────────────────────────────────── */

	.rdap-cards {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.rdap-card {
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 5px;
		padding: 0.875rem;
		display: flex;
		flex-direction: column;
		gap: 0.55rem;
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
	}

	.rdap-row {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
	}

	.rdap-row-wrap {
		align-items: flex-start;
	}

	.rdap-label {
		font-size: 0.68rem;
		font-family: var(--mono);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-muted);
		min-width: 5.5rem;
		flex-shrink: 0;
	}

	.rdap-val {
		font-size: 0.82rem;
		color: var(--text);
	}

	.rdap-val.mono {
		font-family: var(--mono);
		font-size: 0.78rem;
	}

	.rdap-val.accent-text {
		color: var(--accent);
	}

	.status-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem;
	}

	.status-tag {
		font-family: var(--mono);
		font-size: 0.62rem;
		padding: 0.12rem 0.4rem;
		border-radius: 2px;
		background: var(--surface-2);
		border: 1px solid var(--border);
		color: var(--text-muted);
	}

	.ns-list {
		display: flex;
		flex-direction: column;
		gap: 0.3rem;
	}

	.ns-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	.ns-arrow {
		color: var(--accent);
		font-size: 0.75rem;
		font-weight: 700;
	}

	/* ─── Responsive ───────────────────────────────────────────────────────── */

	@media (max-width: 840px) {
		.results-grid {
			grid-template-columns: 1fr;
		}

		.type-desc {
			display: none;
		}
	}

	@media (max-width: 520px) {
		.hero-layout {
			padding: 2rem 1rem;
		}

		.brand-name,
		.brand-cursor {
			font-size: 1.75rem;
		}

		.search-btn {
			padding: 0 1rem;
		}

		.results-container {
			padding: 1rem 1rem 4rem;
		}

		.top-bar-inner {
			padding: 0.5rem 1rem;
		}
	}
</style>
