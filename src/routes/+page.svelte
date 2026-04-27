<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { fade, slide } from 'svelte/transition';
	import { DNS_GROUPS, DNS_TYPE_INFO, ALL_DNS_TYPES, formatTTL } from '$lib/dns-types';
	import type { DnsTypeResult } from '$lib/dns-types';

	let { data } = $props();
	import { geoEquirectangular, geoPath, geoGraticule10 } from 'd3-geo';
	import { feature } from 'topojson-client';
	import worldJson from 'world-atlas/countries-110m.json';
	import 'flag-icons/css/flag-icons.min.css';

	// ─── World map (computed once, module-level) ─────────────────────────────────
	const MAP_W = 960, MAP_H = 500;
	const _proj  = geoEquirectangular().fitSize([MAP_W, MAP_H], { type: 'Sphere' });
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
	let activeGroup = $state<GroupKey>('all');
	let submitted   = $state('');

	let dnsRecords  = $state<Record<string, DnsTypeResult>>({});
	let rdapData    = $state<Record<string, unknown> | null>(null);
	let dnsLoading  = $state(false);
	let rdapLoading = $state(false);
	let dnsError    = $state('');
	let rdapError   = $state('');

	const ALL_PROP_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR', 'SRV', 'SOA', 'TXT', 'CAA', 'DS', 'DNSKEY'] as const;

	interface PropResult {
		id: string; name: string; city: string; flag: string; iso: string;
		lat: number; lon: number;
		records: string[]; ttl: number | null;
		status: 'ok' | 'nxdomain' | 'error' | 'timeout'; ms: number;
	}
	let propResults  = $state<PropResult[]>([]);
	let propLoading  = $state(false);
	let propType     = $state('A');
	let hoveredId    = $state<string | null>(null);
	let mapTooltip   = $state<{ r: PropResult; x: number; y: number } | null>(null);

	const majorityRecord = $derived.by((): string => {
		const counts = new Map<string, number>();
		for (const r of propResults) for (const rec of r.records) counts.set(rec, (counts.get(rec) ?? 0) + 1);
		let max = 0, best = '';
		for (const [rec, n] of counts) if (n > max) { max = n; best = rec; }
		return best;
	});

	function propColor(r: PropResult): string {
		if (r.status === 'ok') return r.records.includes(majorityRecord) ? 'var(--accent)' : '#f97316';
		if (r.status === 'nxdomain') return '#ef4444';
		return '#3a3a3a';
	}

	function selectPropType(t: string) {
		propType = t;
		if (submitted) searchPropagation(submitted, t);
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
		return Object.fromEntries(
			Object.entries(dnsRecords).filter(([t, r]) => types.includes(t) && (r as DnsTypeResult).answers.length > 0)
		);
	});

	const totalDnsFound = $derived(() =>
		Object.values(dnsRecords).reduce((s, r) => s + (r as DnsTypeResult).answers.length, 0)
	);

	function countForGroup(key: GroupKey): number {
		return Object.entries(dnsRecords).filter(([t, r]) =>
			getTypesForGroup(key).includes(t) && (r as DnsTypeResult).answers.length > 0
		).length;
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
		activeGroup = 'all';
		goto(`/?d=${encodeURIComponent(domain)}`, { replaceState: false, noScroll: true, keepFocus: true });
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

	async function searchPropagation(domain: string, type = propType) {
		propLoading = true;
		try {
			const res  = await fetch(`/api/propagation?domain=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`);
			const data = await res.json();
			if (!data.error) propResults = data.results;
		} catch {}
		finally { propLoading = false; }
	}

	onMount(() => {
		const saved = localStorage.getItem('whois-accent');
		if (saved) {
			setAccent(saved);
			if (!ACCENT_PRESETS.some(p => p.value === saved)) {
				[cpHue, cpSat, cpVal] = hexToHsv(saved);
				customHexInput = saved.slice(1);
			}
		}

		if (data.domain) {
			query = data.domain;
			submit();
		}
	});

	let openNotices = $state(new Set<number>());

	function toggleNotice(i: number) {
		const next = new Set(openNotices);
		next.has(i) ? next.delete(i) : next.add(i);
		openNotices = next;
	}

	function reset() {
		submitted = ''; query = ''; dnsRecords = {}; rdapData = null; propResults = []; dnsError = ''; rdapError = '';
		openNotices = new Set(); propType = 'A';
		goto('/', { replaceState: false, noScroll: true });
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

	// ─── Clipboard ────────────────────────────────────────────────────────────────

	let copiedKey = $state<string | null>(null);

	async function copyText(text: string, key: string) {
		try {
			await navigator.clipboard.writeText(text);
			copiedKey = key;
			setTimeout(() => { if (copiedKey === key) copiedKey = null; }, 1400);
		} catch {}
	}

	// ─── Settings ─────────────────────────────────────────────────────────────────

	const ACCENT_PRESETS = [
		{ name: 'yellow',  value: '#fee500' },
		{ name: 'green',   value: '#00e040' },
		{ name: 'cyan',    value: '#00c8ff' },
		{ name: 'blue',    value: '#2979ff' },
		{ name: 'purple',  value: '#9333ea' },
		{ name: 'orange',  value: '#ff6d00' },
		{ name: 'red',     value: '#ff2222' },
		{ name: 'white',   value: '#e2e2e2' },
	] as const;

	let settingsOpen   = $state(false);
	let accentColor    = $state('#fee500');
	let customExpanded = $state(false);
	let customHexInput = $state('');
	let cpHue          = $state(50);
	let cpSat          = $state(100);
	let cpVal          = $state(100);

	const isCustomActive = $derived(!ACCENT_PRESETS.some(p => p.value === accentColor));

	function hsvToHex(h: number, s: number, v: number): string {
		s /= 100; v /= 100;
		const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
		let r = 0, g = 0, b = 0;
		if      (h < 60)  { r = c; g = x; }
		else if (h < 120) { r = x; g = c; }
		else if (h < 180) {        g = c; b = x; }
		else if (h < 240) {        g = x; b = c; }
		else if (h < 300) { r = x;        b = c; }
		else              { r = c;        b = x; }
		const hex = (n: number) => Math.round((n + m) * 255).toString(16).padStart(2, '0');
		return '#' + hex(r) + hex(g) + hex(b);
	}

	function hexToHsv(hex: string): [number, number, number] {
		const r = parseInt(hex.slice(1, 3), 16) / 255;
		const g = parseInt(hex.slice(3, 5), 16) / 255;
		const b = parseInt(hex.slice(5, 7), 16) / 255;
		const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
		let h = 0;
		if (d) {
			if      (mx === r) h = ((g - b) / d + 6) % 6 * 60;
			else if (mx === g) h = ((b - r) / d + 2) * 60;
			else               h = ((r - g) / d + 4) * 60;
		}
		return [Math.round(h), mx ? Math.round(d / mx * 100) : 0, Math.round(mx * 100)];
	}

	function expandHex(h: string): string | null {
		const s = h.replace(/[^0-9a-fA-F]/g, '');
		if (s.length === 3) return '#' + s[0]+s[0] + s[1]+s[1] + s[2]+s[2];
		if (s.length === 6) return '#' + s;
		return null;
	}

	function setAccent(color: string) {
		accentColor = color;
		const r = parseInt(color.slice(1, 3), 16);
		const g = parseInt(color.slice(3, 5), 16);
		const b = parseInt(color.slice(5, 7), 16);
		document.documentElement.style.setProperty('--accent', color);
		document.documentElement.style.setProperty('--accent-dim', `rgba(${r},${g},${b},0.08)`);
		const lum = r * 0.299 + g * 0.587 + b * 0.114;
		document.documentElement.style.setProperty('--accent-text', lum > 160 ? '#000000' : '#ffffff');
		localStorage.setItem('whois-accent', color);
	}

	function selectPreset(color: string) {
		customExpanded = false;
		setAccent(color);
	}

	function applyHsv() {
		const hex = hsvToHex(cpHue, cpSat, cpVal);
		customHexInput = hex.slice(1);
		setAccent(hex);
	}

	function toggleCustom() {
		customExpanded = !customExpanded;
		if (customExpanded) {
			const init = isCustomActive ? accentColor
				: (customHexInput.length === 6 ? '#' + customHexInput : '#888888');
			[cpHue, cpSat, cpVal] = hexToHsv(init);
			customHexInput = init.slice(1);
		}
	}

	function onCustomHexInput(e: Event) {
		const raw = (e.target as HTMLInputElement).value.replace(/[^0-9a-fA-F]/g, '');
		customHexInput = raw;
		const hex = expandHex(raw);
		if (hex) { [cpHue, cpSat, cpVal] = hexToHsv(hex); setAccent(hex); }
	}

	function updateSvFromPointer(e: PointerEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		cpSat = Math.round(Math.max(0, Math.min(100, (e.clientX - rect.left) / rect.width  * 100)));
		cpVal = Math.round(Math.max(0, Math.min(100, (1 - (e.clientY - rect.top) / rect.height) * 100)));
		applyHsv();
	}

	function startSvDrag(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		updateSvFromPointer(e);
	}

	function onSvMove(e: PointerEvent) {
		if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) updateSvFromPointer(e);
	}

	function closeSettings(e: MouseEvent) {
		if (settingsOpen && !(e.target as Element)?.closest?.('.settings-wrap')) {
			settingsOpen = false;
		}
	}
</script>

<svelte:head>
	<title>{submitted ? `${submitted} — whois_` : 'whois_ — DNS & RDAP lookup'}</title>
</svelte:head>

<svelte:window onclick={closeSettings} />

{#snippet settingsBtn()}
	<div class="top-actions">
		<a
			class="top-icon-btn"
			href="https://github.com/b1s4/whois"
			target="_blank"
			rel="noopener noreferrer"
			title="GitHub"
			aria-label="GitHub repository"
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.28 1.15-.28 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>
		</a>

		<div class="settings-wrap">
			<button
				class="top-icon-btn"
				class:settings-active={settingsOpen}
				onclick={(e) => { e.stopPropagation(); settingsOpen = !settingsOpen; }}
				title="Settings"
				aria-label="Settings"
			>
				<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 0 0-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 0 0-2.282.819l-.922 1.597a1.875 1.875 0 0 0 .432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 0 0 0 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 0 0-.432 2.385l.922 1.597a1.875 1.875 0 0 0 2.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 0 0 2.28-.819l.923-1.597a1.875 1.875 0 0 0-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 0 0 0-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 0 0-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 0 0-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 0 0-1.85-1.567h-1.843ZM12 15.75a3.75 3.75 0 1 0 0-7.5 3.75 3.75 0 0 0 0 7.5Z"/></svg>
			</button>

			{#if settingsOpen}
				<div class="settings-panel">
					<div class="settings-panel-head">
						<span class="settings-panel-title">settings</span>
					</div>
					<div class="settings-body">
						<span class="settings-group-label">accent color</span>
						{#each ACCENT_PRESETS as preset}
							<button
								class="color-row"
								class:color-row-active={accentColor === preset.value}
								onclick={() => selectPreset(preset.value)}
							>
								<span class="color-row-dot" style="background:{preset.value}"></span>
								<span class="color-row-name">{preset.name}</span>
								{#if accentColor === preset.value}
									<span class="color-row-check">✓</span>
								{/if}
							</button>
						{/each}

						<!-- Custom color row -->
						<button
							class="color-row"
							class:color-row-active={isCustomActive}
							onclick={toggleCustom}
						>
							<span
								class="color-row-dot"
								class:dot-custom={!isCustomActive}
								style={isCustomActive ? `background:${accentColor}` : ''}
							></span>
							<span class="color-row-name">custom</span>
							{#if isCustomActive}
								<span class="color-row-check">✓</span>
							{:else}
								<span class="custom-chevron" class:custom-chevron-open={customExpanded}>›</span>
							{/if}
						</button>

						{#if customExpanded}
							<div class="cp-wrap" transition:slide={{ duration: 140 }}>
								<!-- SV gradient square -->
								<div
									class="cp-sv"
									style="--cp-hue:{cpHue}"
									onpointerdown={startSvDrag}
									onpointermove={onSvMove}
									onpointerup={(e) => (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)}
									aria-label="Color saturation and brightness"
									role="application"
								>
									<div class="cp-sv-thumb" style="left:{cpSat}%;top:{100 - cpVal}%"></div>
								</div>
								<!-- Hue strip -->
								<input
									class="cp-hue"
									type="range" min="0" max="360" step="1"
									value={cpHue}
									oninput={(e) => { cpHue = Number((e.target as HTMLInputElement).value); applyHsv(); }}
								/>
								<!-- Hex input row -->
								<div class="cp-hex-row">
									<span class="cp-hash">#</span>
									<input
										class="cp-hex-input"
										type="text"
										maxlength="6"
										placeholder="fee500"
										value={customHexInput}
										oninput={onCustomHexInput}
										spellcheck="false"
										autocomplete="off"
									/>
									<span class="cp-preview" style="background:{hsvToHex(cpHue, cpSat, cpVal)}"></span>
								</div>
							</div>
						{/if}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/snippet}

<!-- ═══════════════════════════════════════════════════════════════════════════
     PRE-SEARCH
════════════════════════════════════════════════════════════════════════════ -->
{#if !submitted}
	<main class="hero-layout" transition:fade={{ duration: 150 }}>
		<div class="hero-settings-slot desktop-only">{@render settingsBtn()}</div>
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
						<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.533 1.27893C5.35215 1.27893 1.12598 5.41887 1.12598 10.5579C1.12598 15.697 5.35215 19.8369 10.533 19.8369C12.767 19.8369 14.8235 19.0671 16.4402 17.7794L20.7929 22.132C21.1834 22.5226 21.8166 22.5226 22.2071 22.132C22.5976 21.7415 22.5976 21.1083 22.2071 20.7178L17.8634 16.3741C19.1616 14.7849 19.94 12.7634 19.94 10.5579C19.94 5.41887 15.7138 1.27893 10.533 1.27893ZM3.12598 10.5579C3.12598 6.55226 6.42768 3.27893 10.533 3.27893C14.6383 3.27893 17.94 6.55226 17.94 10.5579C17.94 14.5636 14.6383 17.8369 10.533 17.8369C6.42768 17.8369 3.12598 14.5636 3.12598 10.5579Z"/></svg>
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
							<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10.533 1.27893C5.35215 1.27893 1.12598 5.41887 1.12598 10.5579C1.12598 15.697 5.35215 19.8369 10.533 19.8369C12.767 19.8369 14.8235 19.0671 16.4402 17.7794L20.7929 22.132C21.1834 22.5226 21.8166 22.5226 22.2071 22.132C22.5976 21.7415 22.5976 21.1083 22.2071 20.7178L17.8634 16.3741C19.1616 14.7849 19.94 12.7634 19.94 10.5579C19.94 5.41887 15.7138 1.27893 10.533 1.27893ZM3.12598 10.5579C3.12598 6.55226 6.42768 3.27893 10.533 3.27893C14.6383 3.27893 17.94 6.55226 17.94 10.5579C17.94 14.5636 14.6383 17.8369 10.533 17.8369C6.42768 17.8369 3.12598 14.5636 3.12598 10.5579Z"/></svg>
						{/if}
					</button>
				</div>
				<div class="settings-topbar desktop-only">{@render settingsBtn()}</div>
			</div>
		</div>

		<!-- Globe loading state -->
		{#if dnsLoading}
			<div class="globe-screen" transition:fade={{ duration: 200 }}>
				<svg class="spinner-svg" viewBox="0 0 66 66" width="62" height="62">
					<circle cx="33" cy="33" r="28" fill="none" stroke="rgba(0,0,0,0.44)" stroke-width="10"/>
					<circle cx="33" cy="33" r="28" fill="none" stroke="var(--accent)" stroke-width="10"
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

					<!-- ════════════════ DNS COLUMN (right on desktop) ════════════════ -->
				<section class="col dns-col">
					<div class="col-header">
						<span class="col-title">DNS</span>
						{#if !dnsLoading && !dnsError}
							<span class="col-meta">{totalDnsFound()} records · {Object.keys(dnsRecords).length} types</span>
						{/if}
					</div>

					<div class="group-filter">
						{#each groups as g}
							{@const n = g.key === 'all' ? Object.keys(dnsRecords).length : countForGroup(g.key)}
							{#if g.key === 'all' || n > 0}
								<button
									class="group-btn"
									class:active={activeGroup === g.key}
									onclick={() => (activeGroup = g.key)}
								>
									{g.label}
									{#if g.key !== 'all' && n > 0}<span class="group-count">{n}</span>{/if}
								</button>
							{/if}
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

				<!-- ════════════════ LEFT COL: PROPAGATION + RDAP ════════════════ -->
				<div class="left-col">

				<!-- ════ RDAP (rendered last in HTML so it comes after prop) ════ -->
				<section class="col rdap-col" style="order:2">
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

			<!-- ════════════════ PROPAGATION (above RDAP) ════════════════ -->
			{#if propLoading || propResults.length > 0}
				<div class="prop-section" style="order:1" transition:fade={{ duration: 200 }}>
					<div class="prop-header">
						<span class="prop-title">PROPAGATION</span>
						{#if !propLoading}
							<span class="prop-meta">
								{propType} record · {propResults.filter(r => r.status === 'ok').length}/{propResults.length} resolvers responded
							</span>
						{/if}
					</div>

					<!-- Type selector -->
					<div class="prop-type-bar">
						{#each ALL_PROP_TYPES as t}
							<button
								class="prop-type-pill"
								class:active={propType === t}
								onclick={() => selectPropType(t)}
							>{t}</button>
						{/each}
					</div>

					{#if propLoading}
						<div class="prop-loading">
							<svg class="spinner-svg" viewBox="0 0 66 66" width="28" height="28">
								<circle cx="33" cy="33" r="28" fill="none" stroke="rgba(0,0,0,0.44)" stroke-width="10"/>
								<circle cx="33" cy="33" r="28" fill="none" stroke="var(--accent)" stroke-width="10"
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
								{#each propResults as r}
									{@const pos = project(r.lon, r.lat)}
									{#if pos}
										<circle
											class="resolver-dot"
											class:highlighted={hoveredId === r.id}
											cx={pos[0]} cy={pos[1]} r="5"
											fill={propColor(r)}
											stroke="var(--bg)" stroke-width="1.5"
											onmouseenter={(e) => { hoveredId = r.id; mapTooltip = { r, x: e.clientX, y: e.clientY }; }}
											onmousemove={(e) => { mapTooltip = { r, x: e.clientX, y: e.clientY }; }}
											onmouseleave={() => { hoveredId = null; mapTooltip = null; }}
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
								{#if tt.r.records.length}
									{#each tt.r.records as rec}<span class="tt-ip">{rec}</span>{/each}
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
								<div
									class="resolver-row"
									class:row-highlighted={hoveredId === r.id}
									onmouseenter={() => { hoveredId = r.id; }}
									onmouseleave={() => { hoveredId = null; }}
								>
									<span class="r-flag"><span class="fi fi-{r.iso}"></span></span>
									<span class="r-city">{r.city}</span>
									<span class="r-name">{r.name}</span>
									<span class="r-ips">
										{#if r.records.length}
											{#each r.records as rec}<span class="r-ip">{rec}</span>{/each}
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

			</div><!-- /left-col -->
			</div><!-- /results-grid -->

		</div><!-- /results-container -->
		{/if}<!-- /dnsLoading -->
	</div><!-- /results-layout -->
{/if}

<div class="mobile-only mobile-fixed-actions">
	{@render settingsBtn()}
</div>

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
		padding: 0 1.1rem;
		min-height: 3.125rem;
		cursor: pointer;
		transition: opacity 0.15s;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.search-btn:disabled { opacity: 0.35; cursor: not-allowed; }
	.search-btn:not(:disabled):hover { opacity: 0.82; }

	.spinner {
		width: 13px; height: 13px;
		border: 2px solid currentColor;
		border-right-color: transparent;
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
		max-width: 425px;
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
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 95%;
		max-width: 1800px;
		margin: 0 auto;
		padding: 0.625rem 0;
	}

	.top-brand {
		position: absolute;
		left: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		padding: 0.25rem 0;
	}

	.top-brand-text {
		font-family: var(--mono);
		font-size: 1rem;
		font-weight: 600;
		color: var(--accent);
	}

	.top-search-wrap {
		width: 525px;
		max-width: calc(100% - 5rem);
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
	.top-search-wrap .search-btn { min-height: 2.625rem; padding: 0 0.9rem; }

	.results-container {
		flex: 1;
		width: 95%;
		max-width: 1800px;
		margin: 0 auto;
		padding: 1.5rem 0 5rem;
	}

	.domain-label {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 1.25rem;
	}

	.domain-text { font-family: var(--mono); font-size: 0.9rem; font-weight: 600; color: var(--text-muted); }

	.badge { font-family: var(--mono); font-size: 0.68rem; padding: 0.15rem 0.5rem; border-radius: 3px; }
	.badge.scanning { background: var(--accent-dim); color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); }

	.results-grid {
		display: grid;
		grid-template-columns: 2fr 1.25fr;
		column-gap: 1.75rem;
		row-gap: 0;
		align-items: start;
	}

	/* Desktop: DNS right (col 2), left-col left (col 1) */
	.dns-col  { grid-column: 2; grid-row: 1; position: sticky; top: 4.5rem; max-height: calc(100dvh - 5.5rem); overflow-y: auto; }
	.left-col { grid-column: 1; grid-row: 1; display: flex; flex-direction: column; gap: 0; min-width: 0; overflow: hidden; }

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

	.ip-tag.v4 { color: var(--accent); background: var(--accent-dim); border-color: color-mix(in srgb, var(--accent) 15%, transparent); }
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
		/* Mobile order: DNS (row 1), then left-col — RDAP + Prop (row 2) */
		.dns-col  { grid-column: 1; grid-row: 1; position: static; max-height: none; overflow-y: visible; }
		.left-col { grid-column: 1; grid-row: 2; }
		.type-desc { display: none; }
	}

	/* ── Tablet / large phone ──────────────────────────────────────────────── */
	@media (max-width: 640px) {
		.top-bar-inner    { width: 92%; padding: 0.45rem 0; }
		.results-container { width: 92%; padding: 1rem 0 4rem; }
		.prop-type-pill { padding: 0.3rem 0.65rem; font-size: 0.7rem; }
		.prop-type-bar { gap: 0.35rem; }
	}

	/* ── Resolver rows: fix grid on mobile ─────────────────────────────────── */
	@media (max-width: 600px) {
		.resolver-row {
			grid-template-columns: 1.4rem 1fr auto 1rem;
			grid-template-rows: auto auto;
			row-gap: 0.3rem;
		}
		.r-flag { grid-column: 1; grid-row: 1; }
		.r-city { grid-column: 2; grid-row: 1; }
		.r-name { display: none; }
		.r-ips  { grid-column: 1 / -1; grid-row: 2; }
		.r-ttl  { display: none; }
		.r-ms   { grid-column: 3; grid-row: 1; }
		.r-dot  { grid-column: 4; grid-row: 1; }

		/* Larger dots — 5 SVG units ≈ 2px on a 375px screen, needs to be tappable */
		.resolver-dot { r: 8; }
		.resolver-dot:hover { r: 8; }
		.resolver-dot.highlighted { r: 11; }
	}

	/* ── Small phone ───────────────────────────────────────────────────────── */
	@media (max-width: 520px) {
		.hero-layout { padding: 2rem 1rem; }
		.brand-name, .brand-cursor { font-size: 1.75rem; }
		.search-btn { padding: 0 1rem; }
		.results-container { width: 92%; padding: 1rem 0 4rem; }
		.top-bar-inner { width: 92%; padding: 0.4rem 0; gap: 0.5rem; }
		.top-search-wrap .search-btn { padding: 0 0.875rem; }

		/* Tighter record entries */
		.record-entry { padding: 0.4rem 0.6rem; }
		.record-head  { padding: 0.4rem 0.6rem; }
	}

	/* ── Tiny phone (≤400px) ───────────────────────────────────────────────── */
	@media (max-width: 400px) {
		.hero-layout { padding: 1.5rem 0.875rem; }
		.brand-name, .brand-cursor { font-size: 1.5rem; }
		.results-container { width: 92%; padding: 0.875rem 0 3.5rem; }
		.top-bar-inner { width: 92%; padding: 0.375rem 0; gap: 0.375rem; }
		.top-brand-text { font-size: 0.85rem; }

		/* Stack RDAP label + value vertically to avoid cramping */
		.rdap-row { flex-direction: column; gap: 0.1rem; }
		.rdap-label { min-width: auto; }

		/* Smaller map dots on very small screens (fewer px to spare) */
		.resolver-dot { r: 6; }
		.resolver-dot.highlighted { r: 9; }

		/* Shrink map height slightly */
		.map-wrap { margin-bottom: 0.875rem; }

		/* Compact prop header */
		.prop-section { margin-top: 1.75rem; padding-top: 1.25rem; }
	}

	/* ─── Propagation ────────────────────────────────────────────────────────── */

	.prop-section {
		padding-bottom: 1.75rem;
	}
	/* RDAP comes after prop in left-col — add separator on top */
	.left-col .rdap-col {
		border-top: 1px solid var(--border);
		padding-top: 1.75rem;
		margin-top: 0.25rem;
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

	.prop-type-bar {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin-bottom: 1rem;
	}
	.prop-type-pill {
		padding: 0.18rem 0.55rem;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: transparent;
		color: var(--text-muted);
		font-family: var(--mono);
		font-size: 0.68rem;
		cursor: pointer;
		transition: border-color 0.15s, color 0.15s, background 0.15s;
	}
	.prop-type-pill:hover { border-color: var(--border-hover); color: var(--text); }
	.prop-type-pill.active { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }

	.resolver-dot { transition: r 0.15s ease, stroke-width 0.15s; cursor: default; }
	.resolver-dot:hover { r: 7; }
	.resolver-dot.highlighted { r: 9; stroke: #fff; stroke-width: 2; }
	.row-highlighted { background: #1a1a1a; }

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
		padding: 0.45rem 0.4rem;
		border-bottom: 1px solid #0f0f0f;
		border-radius: 4px;
		font-family: var(--mono);
		cursor: default;
		transition: background 0.12s;
		font-size: 0.73rem;
	}

	.r-flag .fi { width: 18px; height: 13px; border-radius: 2px; display: block; }

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
		word-break: break-all;
		overflow-wrap: anywhere;
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

	/* ─── Copy button ─────────────────────────────────────────────────────────── */

	.copy-btn {
		opacity: 0;
		flex-shrink: 0;
		background: transparent;
		border: none;
		cursor: pointer;
		font-family: var(--mono);
		font-size: 0.6rem;
		color: var(--text-dim);
		padding: 0.1rem 0.3rem;
		border-radius: 2px;
		transition: opacity 0.12s, color 0.12s;
		letter-spacing: 0.04em;
	}
	.record-entry:hover .copy-btn { opacity: 1; }
	.copy-btn:hover:not(.copied) { color: var(--text-muted); }
	.copy-btn.copied { opacity: 1; color: var(--accent); }

	@media (pointer: coarse) {
		.copy-btn { opacity: 1; }
	}

	/* ─── Share / copy-link button ────────────────────────────────────────────── */

	.share-btn {
		margin-left: auto;
		background: transparent;
		border: 1px solid var(--border);
		color: var(--text-muted);
		font-family: var(--mono);
		font-size: 0.62rem;
		padding: 0.15rem 0.5rem;
		border-radius: 3px;
		cursor: pointer;
		transition: border-color 0.12s, color 0.12s;
		letter-spacing: 0.04em;
	}
	.share-btn:hover { border-color: var(--border-hover); color: var(--text); }
	.share-btn.share-copied { border-color: var(--accent); color: var(--accent); }

	/* ─── Expiry date colors ──────────────────────────────────────────────────── */

	.expiry-warn   { color: #f97316 !important; }
	.expiry-danger { color: var(--error) !important; }

	/* ─── Settings & top actions ─────────────────────────────────────────────── */

	.hero-layout { position: relative; }

	.hero-settings-slot {
		position: absolute;
		top: 1.25rem;
		right: 1.5rem;
	}

	.settings-topbar {
		position: absolute;
		right: 0;
		display: flex;
		align-items: center;
	}

	.top-actions {
		display: flex;
		align-items: center;
		gap: 0.15rem;
	}

	/* Shared icon button (GitHub + settings gear) */
	.top-icon-btn {
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 0.3rem 0.35rem;
		border-radius: 4px;
		display: flex;
		align-items: center;
		justify-content: center;
		text-decoration: none;
		transition: color 0.15s;
	}
	.top-icon-btn:hover       { color: var(--text); }
	.top-icon-btn.settings-active { color: var(--accent); }

	@media (max-width: 600px) {
		.desktop-only { display: none !important; }

		.mobile-fixed-actions > .top-actions {
			position: fixed;
			bottom: 1.5rem;
			right: 1.5rem;
			z-index: 1000;
		}

		.top-icon-btn {
			background: rgba(0,0,0,0.4);
			border: 1px solid var(--border);
			padding: 0.5rem 0.5rem;
			backdrop-filter: blur(8px);
		}
		.top-icon-btn:hover {
			background: rgba(0,0,0,0.6);
		}

		.settings-panel {
			top: auto;
			bottom: calc(100% + 0.6rem);
		}
	}

	@media (min-width: 601px) {
		.mobile-only { display: none !important; }
	}

	.settings-wrap { position: relative; }

	/* Panel */
	.settings-panel {
		position: absolute;
		right: 0;
		top: calc(100% + 0.6rem);
		bottom: auto;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 5px;
		width: 188px;
		z-index: 200;
		overflow: hidden;
		box-shadow: 0 12px 32px rgba(0,0,0,0.7);
	}

	.settings-panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.55rem 0.75rem;
		background: var(--surface-2);
		border-bottom: 1px solid var(--border);
	}

	.settings-panel-title {
		font-family: var(--mono);
		font-size: 0.6rem;
		font-weight: 600;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: var(--accent);
	}

	.settings-body {
		display: flex;
		flex-direction: column;
		padding: 0.4rem 0;
	}

	.settings-group-label {
		font-family: var(--mono);
		font-size: 0.57rem;
		letter-spacing: 0.09em;
		text-transform: uppercase;
		color: var(--text-dim);
		padding: 0.35rem 0.75rem 0.25rem;
		display: block;
	}

	.color-row {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.32rem 0.75rem;
		background: transparent;
		border: none;
		cursor: pointer;
		width: 100%;
		text-align: left;
		transition: background 0.1s;
	}
	.color-row:hover      { background: var(--surface-2); }
	.color-row-active     { background: var(--surface-2); }

	.color-row-dot {
		width: 0.6rem;
		height: 0.6rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.color-row-name {
		font-family: var(--mono);
		font-size: 0.72rem;
		color: var(--text-muted);
		flex: 1;
		transition: color 0.1s;
	}
	.color-row:hover .color-row-name { color: var(--text); }
	.color-row-active .color-row-name { color: var(--text); }

	.color-row-check {
		font-family: var(--mono);
		font-size: 0.62rem;
		color: var(--accent);
	}

	.custom-chevron {
		font-size: 0.85rem;
		color: var(--text-dim);
		transition: transform 0.18s ease, color 0.12s;
		line-height: 1;
	}
	.custom-chevron-open { transform: rotate(90deg); color: var(--text-muted); }

	/* Dot with conic gradient when no custom color picked yet */
	.dot-custom {
		background: conic-gradient(
			#f87171, #fb923c, #fee500, #00e676, #22d3ee, #60a5fa, #a78bfa, #f87171
		) !important;
	}

	/* ── Custom color picker ──────────────────────────────────────────────────── */

	.cp-wrap {
		border-top: 1px solid var(--border);
		background: #0a0a0a;
		padding: 0.55rem 0.6rem 0.6rem;
		display: flex;
		flex-direction: column;
		gap: 0.45rem;
	}

	/* SV gradient square */
	.cp-sv {
		position: relative;
		width: 100%;
		height: 90px;
		border-radius: 3px;
		background:
			linear-gradient(to top,  #000 0%, transparent 100%),
			linear-gradient(to right, #fff 0%, hsl(var(--cp-hue), 100%, 50%) 100%);
		cursor: crosshair;
		touch-action: none;
		user-select: none;
		border: 1px solid #222;
	}

	.cp-sv-thumb {
		position: absolute;
		width: 11px;
		height: 11px;
		border-radius: 50%;
		border: 2px solid #fff;
		box-shadow: 0 0 0 1px rgba(0,0,0,0.4);
		transform: translate(-50%, -50%);
		pointer-events: none;
	}

	/* Hue strip */
	.cp-hue {
		-webkit-appearance: none;
		appearance: none;
		display: block;
		width: 100%;
		height: 8px;
		border-radius: 4px;
		border: none;
		padding: 0;
		margin: 0;
		outline: none;
		cursor: pointer;
		background: linear-gradient(to right,
			hsl(0,100%,50%), hsl(30,100%,50%), hsl(60,100%,50%),
			hsl(90,100%,50%), hsl(120,100%,50%), hsl(150,100%,50%),
			hsl(180,100%,50%), hsl(210,100%,50%), hsl(240,100%,50%),
			hsl(270,100%,50%), hsl(300,100%,50%), hsl(330,100%,50%),
			hsl(360,100%,50%)
		);
	}
	.cp-hue::-webkit-slider-thumb {
		-webkit-appearance: none;
		width: 12px; height: 12px;
		border-radius: 50%;
		background: #fff;
		border: 1.5px solid rgba(0,0,0,0.25);
		box-shadow: 0 1px 3px rgba(0,0,0,0.55);
		cursor: pointer;
	}
	.cp-hue::-moz-range-thumb {
		width: 12px; height: 12px;
		border-radius: 50%;
		background: #fff;
		border: 1.5px solid rgba(0,0,0,0.25);
		box-shadow: 0 1px 3px rgba(0,0,0,0.55);
		cursor: pointer;
	}

	/* Hex input row */
	.cp-hex-row {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		border: 1px solid var(--border);
		border-radius: 3px;
		padding: 0.28rem 0.5rem;
		background: var(--surface);
	}

	.cp-hash {
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--accent);
		user-select: none;
		flex-shrink: 0;
	}

	.cp-hex-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		outline: none;
		font-family: var(--mono);
		font-size: 0.7rem;
		color: var(--text);
		letter-spacing: 0.08em;
		padding: 0;
	}
	.cp-hex-input::placeholder { color: var(--text-dim); }

	.cp-preview {
		width: 0.9rem;
		height: 0.9rem;
		border-radius: 50%;
		flex-shrink: 0;
		border: 1px solid rgba(255,255,255,0.12);
	}
</style>
