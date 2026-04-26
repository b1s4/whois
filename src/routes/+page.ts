import type { PageLoad } from './$types';

export const load: PageLoad = ({ url }) => ({
	domain: url.searchParams.get('d') ?? ''
});
