// Parametric rebuild: walk the timeline in order and rebuild everything from the stored parameters.
import { ORIGIN, offsetFrame } from '../model/frames';
import type { Frame, PlaneRef } from '../model/types';
import { syncPlaneFeatures } from '../view/planes';
import { emit } from './hub';
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
    }
  }
  syncPlaneFeatures();
  emit('doc');
  markDirty();
}
