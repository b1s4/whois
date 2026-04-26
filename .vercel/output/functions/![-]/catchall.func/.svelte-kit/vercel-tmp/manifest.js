export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["favicon.svg"]),
	mimeTypes: {".svg":"image/svg+xml"},
	_: {
		client: {start:"_app/immutable/entry/start.ChBTCI0U.js",app:"_app/immutable/entry/app.DpJuM1Fh.js",imports:["_app/immutable/entry/start.ChBTCI0U.js","_app/immutable/chunks/Bx_UmOWh.js","_app/immutable/chunks/BQ4LK9im.js","_app/immutable/chunks/Cb_7h-n6.js","_app/immutable/entry/app.DpJuM1Fh.js","_app/immutable/chunks/BQ4LK9im.js","_app/immutable/chunks/CCw_jS2b.js","_app/immutable/chunks/DFOp4LhD.js","_app/immutable/chunks/Cb_7h-n6.js","_app/immutable/chunks/mllPWx4g.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('../output/server/nodes/0.js')),
			__memo(() => import('../output/server/nodes/1.js')),
			__memo(() => import('../output/server/nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/api/dns",
				pattern: /^\/api\/dns\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('../output/server/entries/endpoints/api/dns/_server.ts.js'))
			},
			{
				id: "/api/rdap",
				pattern: /^\/api\/rdap\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('../output/server/entries/endpoints/api/rdap/_server.ts.js'))
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
