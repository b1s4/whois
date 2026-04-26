import type { Handle } from '@sveltejs/kit';

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname.startsWith('/api/')) {
		const fetchSite = event.request.headers.get('sec-fetch-site');
		// Browsers set sec-fetch-site: same-origin for fetch() calls from same-origin JS.
		// Direct navigation, curl, and Postman won't have it — block them.
		if (fetchSite !== 'same-origin') {
			return new Response('Forbidden', { status: 403 });
		}
	}
	return resolve(event);
};
