// Mirror (MI): a mirror image of one or more bodies across a plane (an origin plane, an offset
// plane or a flat face). New body keeps the copy separate; Join fuses it to the original, which is
// how a symmetric part is made from one half. The result previews live on the model.
import { emit } from '../app/hub';
import { markDirty, resolveRef } from '../app/regenerate';
import { baseBodies, whenBuilt } from '../app/solids';
import { bodyById, state } from '../app/state';
import type { BuildStep } from '../kernel/protocol';
import type { OtherFeature, PlaneRef } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace, setSelectedFaces } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { planeShapeGeometry } from '../view/planes';
import { focusPrimary, registerTool, updateChips, updatePreview, type ActiveDialog } from './dialog';
import { endPick, planeName, selectedPlaneRef, startPick } from './pick';

interface MirrorParams { bodies: string[]; ref: PlaneRef | null; operation: 'Join' | 'New body' }
type Dlg = ActiveDialog<MirrorParams>;

function pickPlane(): void {
  const A = state.active as Dlg | null;
  if (!A) return;
  startPick({
    title: 'Mirror',
    prompt: 'Select the mirror plane: a plane or a flat face',
    beforeIndex: A.edit ? state.features.indexOf(A.edit) : null,
    onPick: (ref) => {
      if (state.active !== A) return;
      A.params.ref = ref;
      updateChips(); updatePreview(); focusPrimary();
      message(`Mirroring across ${planeName(ref)}. Press Enter to finish.`);
    },
    onCancel: () => { updateChips(); },
  });
  updateChips();
}

/** One new body for each mirrored body that stays separate. */
const slotsNeeded = (P: MirrorParams): number => (P.operation === 'New body' ? P.bodies.length : 0);

function drawPicked(P: MirrorParams): void {
  const faces: { bodyId: string; faceId: number }[] = [];
  baseBodies().forEach((b) => { if (P.bodies.includes(b.id)) b.faces.forEach((f) => faces.push({ bodyId: b.id, faceId: f.id })); });
  setSelectedFaces(faces);
}

registerTool<MirrorParams>({
  type: 'mirror',
  title: 'Mirror',
  icon: 'mirror',
  gc: 'g-modify',
  prompt: 'Pick the bodies to mirror, then the mirror plane',
  fields: [
    { key: 'bodies', kind: 'chip', label: 'Bodies', chipId: 'mbChip', act: 'pickBodies', note: 'Click a body in the view or the Browser. Click again to remove it.' },
    { key: 'ref', kind: 'chip', label: 'Mirror plane', chipId: 'mpChip', act: 'pickPlane' },
    { key: 'operation', kind: 'choice', label: 'Operation', options: ['New body', 'Join'] },
  ],
  defaults: () => {
    const sel = state.selection.find((s) => s.kind === 'face' || s.kind === 'edge') as { bodyId: string } | undefined;
    const bodies = sel ? [sel.bodyId] : state.bodies.length === 1 ? [state.bodies[0].id] : [];
    return { bodies, ref: selectedPlaneRef(), operation: 'New body' };
  },
  onOpen: (A: Dlg) => { if (A.params.bodies.length && !A.params.ref) pickPlane(); else focusPrimary(); },
  chips: (A: Dlg) => {
    const P = A.params, picking = !!state.pick, names = P.bodies.map((id) => bodyById(id)?.name || 'a body');
    return {
      mbChip: { set: names.length > 0, picking: !picking && !names.length, text: names.length ? names.join(', ') : 'Click a body' },
      mpChip: { picking, set: !!P.ref, text: picking ? 'Click a plane or flat face…' : P.ref ? planeName(P.ref) : 'Click to pick a plane' },
    };
  },
  onAct: (A: Dlg, act) => { if (act === 'pickPlane') pickPlane(); else { if (state.pick) endPick(); message('Click a body in the view or the Browser'); updateChips(); void A; } },
  onEscape: (A: Dlg) => { if (state.pick && A.params.ref) { endPick(); updateChips(); focusPrimary(); return true; } return false; },
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params, fr = resolveRef(P.ref);
    if (!P.bodies.length || !fr) return null;
    const have = A.edit ? (A.edit as OtherFeature).bodyIds || [] : [];
    return { kind: 'mirror', id: A.edit ? A.edit.id : 'draft', bodies: P.bodies, plane: { o: fr.o, n: fr.n }, operation: P.operation, bodyIds: Array.from({ length: slotsNeeded(P) }, (_, i) => have[i] || 'draft-b' + (i + 1)) };
  },
  preview: (A: Dlg) => {
    const P = A.params, fr = resolveRef(P.ref);
    drawPicked(P);
    return { geo: fr ? planeShapeGeometry(fr) : null, ok: P.bodies.length > 0 && !!fr };
  },
  onBuilt: (A: Dlg) => { drawPicked(A.params); },
  hover: () => {
    if (state.pick) return false;
    const fh = faceAtCursor();
    if (fh) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return false;
  },
  click: (A: Dlg) => {
    if (state.pick) return;
    const fh = faceAtCursor();
    if (!fh) { focusPrimary(); return; }
    const P = A.params, i = P.bodies.indexOf(fh.bodyId);
    if (i >= 0) P.bodies.splice(i, 1); else P.bodies.push(fh.bodyId);
    setHoverFace(null);
    updateChips(); updatePreview();
    if (P.bodies.length && !P.ref) pickPlane();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'body' || state.pick) return false;
    if (!bodyById(id)) return true;
    const P = A.params, i = P.bodies.indexOf(id);
    if (i >= 0) P.bodies.splice(i, 1); else P.bodies.push(id);
    updateChips(); updatePreview();
    if (P.bodies.length && !P.ref) pickPlane();
    return true;
  },
  onClose: () => { setHoverFace(null); setSelectedFaces([]); },
  commit: (A: Dlg, P) => {
    if (!P.bodies.length) { message('Click a body to mirror', 'warn'); return false; }
    if (!resolveRef(P.ref)) { message('Pick the mirror plane first', 'warn'); pickPlane(); return false; }
    if (A.note) { message(A.note[0].toUpperCase() + A.note.slice(1), 'warn'); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const k = ++state.counters.mirror; f = { id: 'mi' + k, type: 'mirror', name: 'Mirror' + k, params: P as unknown as Record<string, unknown>, bodyIds: [] }; state.features.push(f); }
    const ids = f.bodyIds || (f.bodyIds = []), need = slotsNeeded(P);
    while (ids.length < need) { const bn = ++state.counters.body; state.bodies.push({ id: 'b' + bn, name: 'Body' + bn, visible: true }); ids.push('b' + bn); }
    while (ids.length > need) { const gone = ids.pop()!; state.bodies = state.bodies.filter((b) => b.id !== gone); }
    state.selection = [];
    markDirty();
    const feat = f;
    message(`${feat.name}: ${P.bodies.length} bod${P.bodies.length > 1 ? 'ies' : 'y'} mirrored across ${planeName(P.ref)}${P.operation === 'Join' ? ' and joined' : ''}`, 'ok');
    setTimeout(() => void whenBuilt().then(() => { if (feat.error) { message(`${feat.name} needs attention: ${feat.note}`, 'warn'); emit('doc'); } }), 0);
    return true;
  },
});
