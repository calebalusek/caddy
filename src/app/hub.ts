// Tiny event hub so UI pieces refresh without importing each other.
//   doc    — features/bodies changed (tree, timeline)
//   mode   — solid/sketch mode, tool or pick changed (toolbar, prompt)
//   select — selection or hover changed (viewport highlights)
//   theme  — light/dark switched (three.js colors)
export type HubEvent = 'doc' | 'mode' | 'select' | 'theme';

const listeners: Record<HubEvent, Array<() => void>> = { doc: [], mode: [], select: [], theme: [] };

export const on = (evt: HubEvent, fn: () => void): void => { listeners[evt].push(fn); };
export const emit = (...evts: HubEvent[]): void => { evts.forEach((e) => listeners[e].forEach((fn) => fn())); };
