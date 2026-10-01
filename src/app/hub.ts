// Tiny event hub so UI pieces refresh without importing each other.
//   doc    — features/bodies changed (tree, timeline)
//   mode   — solid/sketch mode, tool or pick changed (toolbar, prompt)
//   select — selection or hover changed (viewport highlights)
//   theme  — light/dark switched (three.js colors)
//   built  — the kernel finished rebuilding the bodies
//   view   — Design / Render view switched, or a body's material changed
//   units  — millimeters / inches switched (everything that shows a length redraws)
export type HubEvent = 'doc' | 'mode' | 'select' | 'theme' | 'built' | 'view' | 'units';

const listeners: Record<HubEvent, Array<() => void>> = { doc: [], mode: [], select: [], theme: [], built: [], view: [], units: [] };

export const on = (evt: HubEvent, fn: () => void): void => { listeners[evt].push(fn); };
export const emit = (...evts: HubEvent[]): void => { evts.forEach((e) => listeners[e].forEach((fn) => fn())); };
