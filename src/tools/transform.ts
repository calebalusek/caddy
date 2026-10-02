// Move / Rotate / Scale (MV): put bodies where you want them. "Lay a face down" turns a body so the flat
// face you click is on the build plate (the usual print orientation). Copy leaves the original in place.
import { vdot } from '../model/frames';
import { markDirty } from '../app/regenerate';
import { baseBody, baseBodies } from '../app/solids';
import { bodyById, state } from '../app/state';
import type { BuildStep } from '../kernel/protocol';
import type { OtherFeature } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace, setSelectedFaces } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { v3 } from '../view/planes';
import { bodyNames, drawBodies, hoverBody, reportLater, syncSlots, toggle } from './bodypick';
import { focusPrimary, refreshHandle, registerTool, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';
import type { FaceSpec } from '../kernel/protocol';

interface XParams {
  bodies: string[];
  mode: 'Free' | 'Lay a face down';
  face: FaceSpec | null;
  x: number; y: number; z: number;
  rotAxis: 'X' | 'Y' | 'Z';
  angle: number;
  scale: number;
  pivot: 'Body middle' | 'Origin';
  copy: 'Move' | 'Copy';
}
type Dlg = ActiveDialog<XParams>;
const lay = (P: XParams): boolean => P.mode === 'Lay a face down';
const slotsNeeded = (P: XParams): number => (P.copy === 'Copy' && !lay(P) ? P.bodies.length : 0);

/** The arrow stands on top of the first body and slides up and down for the Z move. */
function zHandle(A: Dlg) {
  const P = A.params, b = P.bodies.length && !lay(P) ? baseBody(P.bodies[0]) : null;
  if (!b) return null;
  const top: [number, number, number] = [(b.box[0][0] + b.box[1][0]) / 2, (b.box[0][1] + b.box[1][1]) / 2, b.box[1][2]];
  return { base: v3(top), tip: v3([top[0], top[1], top[2] + P.z]), axis: v3([0, 0, 1]), dir: 1, value: P.z };
}

function drawPicked(A: Dlg): void {
  const P = A.params;
  if (lay(P) && P.face) {
    const b = baseBodies().find((x) => x.id === P.face!.bodyId);
    const f = b && b.faces.filter((q) => q.planar && vdot(q.n, P.face!.n) > 0.99 && Math.abs(vdot(q.n, q.p) - P.face!.w) < 0.05).map((q) => ({ bodyId: b.id, faceId: q.id }));
    setSelectedFaces(f || []);
  } else drawBodies(P.bodies);
}

registerTool<XParams>({
  type: 'transform',
  title: 'Move / Rotate / Scale',
  icon: 'xform',
  gc: 'g-modify',
  prompt: 'Click the bodies to move, turn or scale',
  fields: [
    { key: 'bodies', kind: 'chip', label: 'Bodies', chipId: 'xfChip', note: 'Click a body in the view or the Browser. Click again to remove it.' },
    { key: 'mode', kind: 'choice', label: 'Mode', options: ['Free', 'Lay a face down'] },
    { key: 'face', kind: 'chip', label: 'Face to lay down', chipId: 'xfFace', showIf: lay, note: 'Click the flat face that should sit on the build plate.' },
    { key: 'x', kind: 'length', label: 'Move X', showIf: (P) => !lay(P) },
    { key: 'y', kind: 'length', label: 'Move Y', showIf: (P) => !lay(P) },
    { key: 'z', kind: 'length', label: 'Move Z', primary: true, showIf: (P) => !lay(P) },
    { key: 'rotAxis', kind: 'choice', label: 'Turn about', options: ['X', 'Y', 'Z'], showIf: (P) => !lay(P) },
    { key: 'angle', kind: 'length', label: 'Turn', unit: 'Â°', showIf: (P) => !lay(P) },
    { key: 'scale', kind: 'length', label: 'Scale', unit: '%', showIf: (P) => !lay(P) },
    { key: 'pivot', kind: 'choice', label: 'Turn and scale around', options: ['Body middle', 'Origin'], showIf: (P) => !lay(P) },
    { key: 'copy', kind: 'choice', label: 'Result', options: ['Move', 'Copy'], showIf: (P) => !lay(P), hintId: 'xfHint' },
  ],
  distanceKey: 'z',
  defaults: () => {
    const sel = state.selection.filter((s) => s.kind === 'face' || s.kind === 'edge').map((s) => (s as { bodyId: string }).bodyId);
    const bodies = [...new Set(sel)];
    return { bodies: bodies.length ? bodies : state.bodies.length === 1 ? [state.bodies[0].id] : [], mode: 'Free', face: null, x: 0, y: 0, z: 0, rotAxis: 'Z', angle: 0, scale: 100, pivot: 'Body middle', copy: 'Move' };
  },
  onOpen: () => focusPrimary(),
  chips: (A: Dlg) => {
    const P = A.params, f = P.face, b = f ? bodyById(f.bodyId) : null;
    return {
      xfChip: { set: P.bodies.length > 0, picking: !P.bodies.length, text: P.bodies.length ? bodyNames(P.bodies) : 'Click a body' },
      xfFace: { set: !!f, picking: lay(P) && !f, text: f ? `Flat face of ${b ? b.name : 'a body'}` : 'Click a flat face' },
    };
  },
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params;
    if (!P.bodies.length || (lay(P) && !P.face) || (!lay(P) && !(P.scale > 0))) return null;
    const have = A.edit ? (A.edit as OtherFeature).bodyIds || [] : [];
    return {
      kind: 'transform', id: A.edit ? A.edit.id : 'draft', bodies: P.bodies, mode: lay(P) ? 'lay' : 'free', move: [P.x, P.y, P.z],
      rotAxis: P.rotAxis === 'X' ? [1, 0, 0] : P.rotAxis === 'Y' ? [0, 1, 0] : [0, 0, 1], rotDeg: P.angle, scale: P.scale / 100, pivot: P.pivot === 'Origin' ? 'origin' : 'body',
      copy: P.copy === 'Copy' && !lay(P), lay: lay(P) ? P.face : null, bodyIds: Array.from({ length: slotsNeeded(P) }, (_, i) => have[i] || 'draft-b' + (i + 1)),
    };
  },
  preview: (A: Dlg) => {
    const P = A.params;
    drawPicked(A);
    setHint('xfHint', !lay(P) && !(P.scale > 0) ? 'The scale needs to be more than 0 %' : A.info || '');
    return { handle: zHandle(A), ok: P.bodies.length > 0 && (lay(P) ? !!P.face : P.scale > 0) };
  },
  onBuilt: (A: Dlg) => { drawPicked(A); refreshHandle(); },
  hover: (A: Dlg) => {
    if (!lay(A.params)) return hoverBody();
    const fh = faceAtCursor();
    if (fh && fh.face.planar) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return false;
  },
  click: (A: Dlg) => {
    const fh = faceAtCursor(), P = A.params;
    if (!fh) { focusPrimary(); return; }
    setHoverFace(null);
    if (lay(P)) {
      if (!fh.face.planar) { message('Lay down a flat face', 'warn'); return; }
      P.face = { bodyId: fh.bodyId, n: fh.face.n, w: vdot(fh.face.n, fh.face.p), p: fh.face.p };
      if (!P.bodies.includes(fh.bodyId)) P.bodies = [fh.bodyId];
    } else toggle(P.bodies, fh.bodyId);
    updateChips(); updatePreview();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'body') return false;
    const P = A.params;
    toggle(P.bodies, id);
    if (P.face && !P.bodies.includes(P.face.bodyId)) P.face = null;
    updateChips(); updatePreview();
    return true;
  },
  onClose: () => { setHoverFace(null); setSelectedFaces([]); },
  commit: (A: Dlg, P) => {
    if (!P.bodies.length) { message('Click a body first', 'warn'); return false; }
    if (lay(P) && !P.face) { message('Click the flat face to lay down', 'warn'); return false; }
    if (!lay(P) && !(P.scale > 0)) { message('The scale needs to be more than 0 %', 'warn'); focusPrimary(); return false; }
    if (A.note) { message(A.note[0].toUpperCase() + A.note.slice(1), 'warn'); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const k = ++state.counters.transform; f = { id: 'tf' + k, type: 'transform', name: 'Transform' + k, params: P as unknown as Record<string, unknown>, bodyIds: [] }; state.features.push(f); }
    syncSlots(f, slotsNeeded(P));
    state.selection = [];
    markDirty();
    message(`${f.name}: ${lay(P) ? 'laid on the build plate' : P.copy === 'Copy' ? 'copy made' : 'done'}`, 'ok');
    reportLater(f);
    return true;
  },
});
