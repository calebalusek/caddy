// Offset plane (PL): a construction plane at a distance from an origin plane, another plane or a flat face.
import { markDirty, resolveRef } from '../app/regenerate';
import { state } from '../app/state';
import { fmt } from '../core/dom';
import { offsetFrame, toWorld } from '../model/frames';
import type { PlaneFeature, PlaneRef } from '../model/types';
import { message } from '../ui/message';
import { planeShapeGeometry, v3 } from '../view/planes';
import { focusPrimary, registerTool, updateChips, updatePreview, type ActiveDialog } from './dialog';
import { endPick, planeName, selectedPlaneRef, startPick } from './pick';

interface PlaneParams { ref: PlaneRef | null; distance: number }

function pickReference(): void {
  const A = state.active as ActiveDialog<PlaneParams> | null;
  if (!A) return;
  const idx = A.edit ? state.features.indexOf(A.edit) : null;
  startPick({
    title: 'Offset plane',
    prompt: 'Select a plane or planar face',
    beforeIndex: idx,
    onPick: (ref) => {
      if (state.active !== A) return;
      A.params.ref = ref;
      updateChips(); updatePreview(); focusPrimary();
      message(`${planeName(ref)} picked. Type the offset or drag the arrow, then press Enter.`);
    },
    onCancel: () => { updateChips(); },
  });
  updateChips();
}

registerTool<PlaneParams>({
  type: 'plane',
  title: 'Offset plane',
  icon: 'plane',
  gc: 'g-construct',
  prompt: 'Offset: type a value or drag the arrow',
  fields: [
    { key: 'ref', kind: 'chip', label: 'Reference', chipId: 'refChip', act: 'repick' },
    { key: 'distance', kind: 'length', label: 'Offset', primary: true },
  ],
  distanceKey: 'distance',
  defaults: () => ({ ref: selectedPlaneRef(), distance: 0 }),
  onOpen: (A) => { if (!A.params.ref) pickReference(); else focusPrimary(); },
  chips: (A) => {
    const has = !!A.params.ref, picking = !!state.pick;
    return { refChip: { picking, set: has, text: picking ? 'Click a plane or flat face…' : has ? planeName(A.params.ref) : 'Click to pick a plane' } };
  },
  onAct: (_A, act) => { if (act === 'repick') pickReference(); },
  onEscape: (A) => {
    // Esc during a re-pick only ends the pick when there is already a reference to fall back on.
    if (state.pick && A.params.ref) { endPick(); updateChips(); focusPrimary(); return true; }
    return false;
  },
  preview: (A) => {
    const P = A.params, fr = resolveRef(P.ref);
    if (!fr) return { ok: false };
    const of = offsetFrame(fr, P.distance), e = fr.ext, cx = (e[0] + e[1]) / 2, cy = (e[2] + e[3]) / 2;
    return {
      geo: planeShapeGeometry(of),
      handle: { base: v3(toWorld(fr, cx, cy)), tip: v3(toWorld(of, cx, cy)), axis: v3(fr.n), dir: P.distance < 0 ? -1 : 1, value: P.distance },
      ok: true,
    };
  },
  commit: (A, P) => {
    if (!P.ref) { message('Pick a plane or flat face first', 'warn'); pickReference(); return false; }
    if (A.edit) {
      (A.edit as PlaneFeature).params = P;
      message(`${A.edit.name} set to ${fmt(P.distance)} mm from ${planeName(P.ref)}`, 'ok');
    } else {
      const n = ++state.counters.plane;
      const f: PlaneFeature = { id: 'p' + n, type: 'plane', name: 'Plane' + n, params: P, visible: true };
      state.features.push(f);
      message(`${f.name} created ${fmt(P.distance)} mm from ${planeName(P.ref)}. Type sk to sketch on it.`, 'ok');
    }
    state.selection = [];
    markDirty();
    return true;
  },
});
