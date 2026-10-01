// App state: the document (features, bodies) plus what the user is doing right now.
import { storage } from '../core/dom';
import { newCounters, type Body, type Counters, type Feature, type FeatureType, type PlaneRef } from '../model/types';
import type { ActiveDialog } from '../tools/dialog';

export interface PickOpts {
  title: string;
  prompt: string;
  /** Only planes created before this timeline index may be picked (editing an earlier feature). */
  beforeIndex?: number | null;
  onPick: (ref: PlaneRef) => void;
  onCancel?: () => void;
}

/** Something selected in the viewport outside of any tool (select first, then tool). */
export type Selection = { kind: 'plane'; key: string; ref: PlaneRef };

export interface DocInfo {
  id: string;
  name: string;
  created: number;
  stored: boolean;
  renamed: boolean;
}

const newProjId = (): string => 'prj-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
export const newDoc = (name?: string): DocInfo => ({ id: newProjId(), name: name || 'Untitled part', created: Date.now(), stored: false, renamed: false });

export const state = {
  mode: 'solid' as 'solid' | 'sketch',
  features: [] as Feature[],
  bodies: [] as Body[],
  counters: newCounters() as Counters,
  /** Plane/face pick in progress (Create sketch, Offset plane reference). */
  pick: null as PickOpts | null,
  /** The open tool menu, if any. */
  active: null as ActiveDialog | null,
  selection: [] as Selection[],
  /** Key of the thing under the cursor that a click would select. */
  hoverKey: null as string | null,
  /** Last command run; Enter or Space repeats it. */
  last: null as string | null,
  usage: {} as Record<string, number>,
  originPlanesVisible: false,
  gridOn: true,
  viewMode: 'design' as 'design' | 'render',
  device: 'desktop' as 'desktop' | 'tablet',
  doc: newDoc(),
};

try { state.usage = JSON.parse(storage.get('caddy-usage') || '{}') || {}; } catch { state.usage = {}; }
export const saveUsage = (): void => storage.set('caddy-usage', JSON.stringify(state.usage));

export const featById = (id: string): Feature | undefined => state.features.find((f) => f.id === id);
export const feats = <T extends FeatureType>(t: T): (Feature & { type: T })[] =>
  state.features.filter((f): f is Feature & { type: T } => f.type === t);
export const bodyById = (id: string): Body | undefined => state.bodies.find((b) => b.id === id);

export const refKey = (ref: PlaneRef): string => (ref.kind === 'face' ? 'face:' + ref.bodyName + ':' + ref.frame.o.concat(ref.frame.n).map((v) => v.toFixed(3)).join(',') : ref.kind + ':' + ref.id);
