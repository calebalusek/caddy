// Split body (SP): cut a body in two with a plane (an origin plane, an offset plane or a flat face), so
// a part too big for the printer can be printed in pieces. Optional keys (pins, a rib or a dovetail) make the
// halves line up when glued; the clearance is the gap that lets them slide together.
import { markDirty, resolveRef } from '../app/regenerate';
import { state } from '../app/state';
import type { BuildStep } from '../kernel/protocol';
import type { OtherFeature, PlaneRef } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace, setSelectedFaces } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { planeShapeGeometry } from '../view/planes';
import { bodyNames, drawBodies, hoverBody, reportLater, syncSlots } from './bodypick';
import { focusPrimary, registerTool, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';
import { endPick, planeName, selectedPlaneRef, startPick } from './pick';

interface SplitParams { body: string | null; ref: PlaneRef | null; keys: 'None' | 'Pins' | 'Rib' | 'Dovetail'; keySize: number; keyCount: number; keyDepth: number; clearance: number }
type Dlg = ActiveDialog<SplitParams>;
const keyed = (P: SplitParams): boolean => P.keys !== 'None';

function pickPlane(): void {
  const A = state.active as Dlg | null;
  if (!A) return;
  startPick({
    title: 'Split body',
    prompt: 'Select the plane to split along: a plane or a flat face',
    beforeIndex: A.edit ? state.features.indexOf(A.edit) : null,
    onPick: (ref) => {
      if (state.active !== A) return;
      A.params.ref = ref;
      updateChips(); updatePreview(); focusPrimary();
      message(`Splitting along ${planeName(ref)}. Press Enter to finish.`);
    },
    onCancel: () => { updateChips(); },
  });
  updateChips();
}

registerTool<SplitParams>({
  type: 'split',
  title: 'Split body',
  icon: 'split',
  gc: 'g-modify',
  prompt: 'Click the body to split, then the plane to cut along',
  fields: [
    { key: 'body', kind: 'chip', label: 'Body', chipId: 'spBody', note: 'Click a body in the view or the Browser. The side the plane points to keeps the name; the other side becomes a new body.' },
    { key: 'ref', kind: 'chip', label: 'Split plane', chipId: 'spPlane', act: 'pickPlane' },
    { key: 'keys', kind: 'choice', label: 'Alignment keys', options: ['None', 'Pins', 'Rib', 'Dovetail'], hintId: 'spHint' },
    { key: 'keySize', kind: 'length', label: 'Key size (pin diameter or key width)', showIf: keyed },
    { key: 'keyDepth', kind: 'length', label: 'Key depth', showIf: keyed },
    { key: 'keyCount', kind: 'length', label: 'Pins', unit: '×', showIf: (P) => P.keys === 'Pins' },
    { key: 'clearance', kind: 'length', label: 'Clearance (gap that lets the halves fit)', showIf: keyed },
  ],
  defaults: () => {
    const sel = state.selection.find((s) => s.kind === 'face' || s.kind === 'edge') as { bodyId: string } | undefined;
    return { body: sel ? sel.bodyId : state.bodies.length === 1 ? state.bodies[0].id : null, ref: selectedPlaneRef(), keys: 'None', keySize: 0, keyCount: 2, keyDepth: 0, clearance: 0 };
  },
  onOpen: (A: Dlg) => { if (A.params.body && !A.params.ref) pickPlane(); else focusPrimary(); },
  chips: (A: Dlg) => {
    const P = A.params, picking = !!state.pick;
    return {
      spBody: { set: !!P.body, picking: !picking && !P.body, text: P.body ? bodyNames([P.body]) : 'Click a body' },
      spPlane: { picking, set: !!P.ref, text: picking ? 'Click a plane or flat face…' : P.ref ? planeName(P.ref) : 'Click to pick a plane' },
    };
  },
  onAct: (A: Dlg, act) => { if (act === 'pickPlane') pickPlane(); void A; },
  onEscape: (A: Dlg) => { if (state.pick && A.params.ref) { endPick(); updateChips(); focusPrimary(); return true; } return false; },
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params, fr = resolveRef(P.ref);
    if (!P.body || !fr) return null;
    const have = A.edit ? (A.edit as OtherFeature).bodyIds || [] : [];
    return { kind: 'split', id: A.edit ? A.edit.id : 'draft', body: P.body, plane: { o: fr.o, n: fr.n }, keys: P.keys, keySize: P.keySize, keyCount: Math.max(1, Math.round(P.keyCount)), keyDepth: P.keyDepth, clearance: P.clearance, bodyIds: [have[0] || 'draft-b1'] };
  },
  preview: (A: Dlg) => {
    const P = A.params, fr = resolveRef(P.ref);
    drawBodies(P.body ? [P.body] : []);
    setHint('spHint', keyed(P) && !(P.keySize > 0) ? 'Type a key size and a depth' : A.info || '');
    return { geo: fr ? planeShapeGeometry(fr) : null, ok: !!P.body && !!fr };
  },
  onBuilt: (A: Dlg) => { drawBodies(A.params.body ? [A.params.body] : []); setHint('spHint', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : A.info || ''); },
  hover: () => (state.pick ? false : hoverBody()),
  click: (A: Dlg) => {
    if (state.pick) return;
    const fh = faceAtCursor();
    if (!fh) { focusPrimary(); return; }
    A.params.body = A.params.body === fh.bodyId ? null : fh.bodyId;
    setHoverFace(null);
    updateChips(); updatePreview();
    if (A.params.body && !A.params.ref) pickPlane();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'body' || state.pick) return false;
    A.params.body = A.params.body === id ? null : id;
    updateChips(); updatePreview();
    if (A.params.body && !A.params.ref) pickPlane();
    return true;
  },
  onClose: () => { setHoverFace(null); setSelectedFaces([]); },
  commit: (A: Dlg, P) => {
    if (!P.body) { message('Click a body to split', 'warn'); return false; }
    if (!resolveRef(P.ref)) { message('Pick the plane to split along first', 'warn'); pickPlane(); return false; }
    if (keyed(P) && !(P.keySize > 0 && P.keyDepth > 0)) { message('Type a key size and a depth, or choose no keys', 'warn'); focusPrimary(); return false; }
    if (A.note) { message(A.note[0].toUpperCase() + A.note.slice(1), 'warn'); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const k = ++state.counters.split; f = { id: 'sp' + k, type: 'split', name: 'Split' + k, params: P as unknown as Record<string, unknown>, bodyIds: [] }; state.features.push(f); }
    syncSlots(f, 1);
    state.selection = [];
    markDirty();
    message(`${f.name}: ${A.info || 'split in two'}`, 'ok');
    reportLater(f);
    return true;
  },
});
