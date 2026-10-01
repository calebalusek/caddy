// Parametric rebuild: walk the timeline in order and rebuild everything from the stored parameters.
import { ORIGIN, offsetFrame } from '../model/frames';
import type { Frame, PlaneRef } from '../model/types';
import { analyze } from '../sketch/solver';
import { buildSketchVisual, liveSketchIds, removeSketchVisual } from '../sketch/visuals';
import { syncPlaneFeatures } from '../view/planes';
import { emit } from './hub';
import { rebuildSolids } from './solids';
import { featById, state } from './state';

/** The frame a plane reference points at right now; null if what it refers to is gone or broken. */
export function resolveRef(ref: PlaneRef | null | undefined): Frame | null {
  if (!ref) return null;
  if (ref.kind === 'origin') return ORIGIN[ref.id];
  if (ref.kind === 'plane') {
    const p = featById(ref.id);
    return p && p.type === 'plane' && p.frame && !p.error ? p.frame : null;
  }
  return ref.frame;
}

const dirtyHooks: Array<() => void> = [];
/** Called whenever the document changed and should be autosaved. */
export const onDirty = (fn: () => void): void => { dirtyHooks.push(fn); };
export const markDirty = (): void => { dirtyHooks.forEach((fn) => fn()); };

export function regenerate(): void {
  for (const f of state.features) {
    f.error = false;
    f.note = '';
    if (f.type === 'plane') {
      const base = resolveRef(f.params.ref);
      if (!base) { f.error = true; f.note = 'its reference plane is gone'; f.frame = null; continue; }
      f.frame = offsetFrame(base, f.params.distance);
    } else if (f.type === 'sketch') {
      f.frame = resolveRef(f.params.ref);
      if (!f.frame) { f.error = true; f.note = 'its plane is gone'; }
      if (!f.status) f.status = analyze(f);
      buildSketchVisual(f);
    }
  }
  // sketches that were deleted take their drawing with them
  const alive = new Set(state.features.map((f) => f.id));
  liveSketchIds().forEach((id) => { if (!alive.has(id)) removeSketchVisual(id); });
  syncPlaneFeatures();
  emit('doc');
  markDirty();
  void rebuildSolids();
}
