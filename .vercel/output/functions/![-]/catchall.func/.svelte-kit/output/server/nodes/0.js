

export const index = 0;
let component_cache;
export const component = async () => component_cache ??= (await import('../entries/pages/_layout.svelte.js')).default;
export const imports = ["_app/immutable/nodes/0.DA2iSb1S.js","_app/immutable/chunks/DFOp4LhD.js","_app/immutable/chunks/BQ4LK9im.js"];
export const stylesheets = ["_app/immutable/assets/0.ClPbuqGj.css"];
export const fonts = [];
