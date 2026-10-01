// The .caddy.json project format. Stores the timeline (features and their sketches), bodies' names
// and looks, counters and the view. No meshes: the model rebuilds from the timeline on open.
//
// Version 1 is what the prototype wrote; version 2 is the same shape plus each sketch's undo
// history. Both open here.
import { newCounters, type Body, type Counters, type Feature, type Frame, type PlaneRef, type SketchFeature } from '../model/types';

export const FORMAT_VERSION = 2;
/** How many undo steps per sketch travel with the file. */
const HIST_KEEP = 30;

export interface ViewState { theta: number; phi: number; r: number; target: [number, number, number] }

export interface ProjectFile {
  format: 'caddy';
  version: number;
  app: string;
  units: 'mm';
  id: string;
  name: string;
  created: number;
  modified: number;
  counters: Counters;
  originPlanesVisible: boolean;
  view: ViewState | null;
  bodies: Body[];
  features: any[];
}

export interface ProjectContent {
  id: string;
  name: string;
  created: number;
  counters: Counters;
  originPlanesVisible: boolean;
  view: ViewState | null;
  bodies: Body[];
  features: Feature[];
}

const copyFrame = (f: Frame): Frame => ({ o: [...f.o], u: [...f.u], v: [...f.v], n: [...f.n], ext: [...f.ext] });
const copyRef = (r: PlaneRef | null | undefined): PlaneRef | null =>
  !r ? null : r.kind === 'face' ? { kind: 'face', bodyName: r.bodyName, frame: copyFrame(r.frame) } : r.kind === 'plane' ? { kind: 'plane', id: r.id } : { kind: 'origin', id: r.id };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export function serializeProject(doc: { id: string; name: string; created: number }, s: { features: Feature[]; bodies: Body[]; counters: Counters; originPlanesVisible: boolean }, view: ViewState | null): ProjectFile {
  return {
    format: 'caddy', version: FORMAT_VERSION, app: 'CADDY', units: 'mm',
    id: doc.id, name: doc.name, created: doc.created, modified: Date.now(),
    counters: { ...s.counters },
    originPlanesVisible: s.originPlanesVisible,
    view,
    bodies: s.bodies.map((b) => ({ id: b.id, name: b.name, visible: b.visible !== false, ...(b.appearance ? { appearance: clone(b.appearance) } : {}) })),
    features: s.features.map((f) => {
      const o: any = { id: f.id, type: f.type, name: f.name };
      if (f.visible === false) o.visible = false;
      if (f.type === 'sketch') Object.assign(o, { params: { ref: copyRef(f.params.ref) }, pts: clone(f.pts), curves: clone(f.curves), cons: clone(f.cons), nid: f.nid, hist: f.hist.slice(-HIST_KEEP) });
      else if (f.type === 'plane') o.params = { ref: copyRef(f.params.ref), distance: f.params.distance };
      else {
        o.params = clone(f.params);
        if (f.bodyId) o.bodyId = f.bodyId;
        if (f.bodyIds) o.bodyIds = f.bodyIds.slice();
      }
      return o;
    }),
  };
}

const KNOWN = new Set(['sketch', 'plane', 'extrude', 'fillet', 'revolve', 'hole', 'sweep', 'shell', 'pattern']);

/** Read a project file (version 1 or 2). Throws a plain-English error if it is not one. */
export function parseProject(d: any): ProjectContent {
  if (!d || d.format !== 'caddy' || !Array.isArray(d.features)) throw new Error('This is not a CADDY project file');
  const bodies: Body[] = (d.bodies || []).map((b: any) => ({ id: String(b.id), name: String(b.name), visible: b.visible !== false, ...(b.appearance ? { appearance: b.appearance } : {}) }));
  const features: Feature[] = [];
  d.features.forEach((f: any) => {
    if (!f || !KNOWN.has(f.type)) return; // from a newer version: skipped rather than failing the whole file
    const base = { id: String(f.id), name: String(f.name), visible: f.visible === false ? false : true };
    if (f.type === 'sketch') {
      const sk: SketchFeature = { ...base, type: 'sketch', params: { ref: copyRef(f.params && f.params.ref) }, pts: f.pts || {}, curves: f.curves || [], cons: f.cons || [], nid: f.nid || 0, hist: Array.isArray(f.hist) ? f.hist.filter((h: unknown) => typeof h === 'string') : [] };
      if (!sk.pts.O) sk.pts.O = { x: 0, y: 0 };
      features.push(sk);
    } else if (f.type === 'plane') features.push({ ...base, type: 'plane', params: { ref: copyRef(f.params && f.params.ref), distance: +(f.params && f.params.distance) || 0 } });
    else {
      const o: any = { ...base, type: f.type, params: clone(f.params || {}) };
      if (f.bodyId) o.bodyId = f.bodyId;
      if (f.bodyIds) o.bodyIds = f.bodyIds.slice();
      features.push(o);
    }
  });
  // counters must stay ahead of every id in the file, even if the file's own counters are behind
  const counters: Counters = Object.assign(newCounters(), d.counters || {});
  const bump = (k: keyof Counters, id: string): void => { const n = parseInt(String(id).replace(/^[a-z]+/i, ''), 10); if (n > counters[k]) counters[k] = n; };
  features.forEach((f) => bump(f.type as keyof Counters, f.id));
  bodies.forEach((b) => bump('body', b.id));
  const v = d.view;
  const view: ViewState | null = v && isFinite(v.r) && Array.isArray(v.target) ? { theta: +v.theta, phi: +v.phi, r: +v.r, target: [+v.target[0], +v.target[1], +v.target[2]] } : null;
  return { id: d.id ? String(d.id) : '', name: d.name ? String(d.name) : 'Untitled part', created: +d.created || Date.now(), counters, originPlanesVisible: !!d.originPlanesVisible, view, bodies, features };
}

export const safeName = (s: string): string => (s || 'project').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'project';
export function bumpVersion(n: string): string { const m = n.match(/^(.*?)([ _-]?)v(\d+)$/i); return m ? `${m[1]}${m[2]}v${+m[3] + 1}` : `${n} v2`; }
export function addDate(n: string, d = new Date()): string {
  const s = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return n.includes(s) ? n : `${n} ${s}`;
}
export function uniqueName(n: string, names: string[]): string { if (!names.includes(n)) return n; let i = 2; while (names.includes(`${n} (${i})`)) i++; return `${n} (${i})`; }
