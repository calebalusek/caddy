// Parametric rebuild: walk the timeline in order and rebuild everything from the stored parameters.
import { resolveFrames, resolveRefIn } from '../model/steps';
import type { Frame, PlaneRef } from '../model/types';
import { analyze } from '../sketch/solver';
import { buildSketchVisual, liveSketchIds, removeSketchVisual } from '../sketch/visuals';
import { syncPlaneFeatures } from '../view/planes';
import { emit } from './hub';
import { rebuildSolids } from './solids';
import { state } from './state';

/** The frame a plane reference points at right now; null if what it refers to is gone or broken. */
export const resolveRef = (ref: PlaneRef | null | undefined): Frame | null => resolveRefIn(state.features, ref);

const dirtyHooks: Array<() => void> = [];
/** Called whenever the document changed and should be autosaved. */
export const onDirty = (fn: () => void): void => { dirtyHooks.push(fn); };
export const markDirty = (): void => { dirtyHooks.forEach((fn) => fn()); };

export function regenerate(): void {
  resolveFrames(state.features);
  state.features.forEach((f) => {
    if (f.type !== 'sketch') return;
    if (!f.status) f.status = analyze(f);
    buildSketchVisual(f);
  });
  // sketches that were deleted take their drawing with them
  const alive = new Set(state.features.map((f) => f.id));
  liveSketchIds().forEach((id) => { if (!alive.has(id)) removeSketchVisual(id); });
  syncPlaneFeatures();
  emit('doc');
  markDirty();
  void rebuildSolids();
}
