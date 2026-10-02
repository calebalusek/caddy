// Offset body (OB): grow a body outward or shrink it inward by a distance, for clearances and tolerances
// (a lid that fits, a pocket for a part). Sharp corners keep their points; Round smooths them.
import { fmtU } from '../core/units';
import { markDirty } from '../app/regenerate';
import { baseBody } from '../app/solids';
import { state } from '../app/state';
import type { BuildStep } from '../kernel/protocol';
import type { OtherFeature } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace, setSelectedFaces } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { v3 } from '../view/planes';
import { bodyNames, drawBodies, hoverBody, reportLater, syncSlots, toggle } from './bodypick';
import { focusPrimary, refreshHandle, registerTool, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';

interface OffParams { bodies: string[]; distance: number; corners: 'Sharp' | 'Round'; result: 'In place' | 'New body' }
type Dlg = ActiveDialog<OffParams>;
const slotsNeeded = (P: OffParams): number => (P.result === 'New body' ? P.bodies.length : 0);

/** The arrow stands on top of the first body and slides up (grow) or down (shrink). */
function sizeHandle(A: Dlg) {
  const b = A.params.bodies.length ? baseBody(A.params.bodies[0]) : null;
  if (!b) return null;
  const top: [number, number, number] = [(b.box[0][0] + b.box[1][0]) / 2, (b.box[0][1] + b.box[1][1]) / 2, b.box[1][2]];
  return { base: v3(top), tip: v3([top[0], top[1], top[2] + A.params.distance]), axis: v3([0, 0, 1]), dir: 1, value: A.params.distance };
}

registerTool<OffParams>({
  type: 'offsetbody',
  title: 'Offset body',
  icon: 'offsetbody',
  gc: 'g-modify',
  prompt: 'Click the bodies to grow or shrink, then type a distance',
  fields: [
    { key: 'bodies', kind: 'chip', label: 'Bodies', chipId: 'obChip', note: 'Click a body in the view or the Browser. Click again to remove it.' },
    { key: 'distance', kind: 'length', label: 'Distance (+ grows, − shrinks)', primary: true },
    { key: 'corners', kind: 'choice', label: 'Corners', options: ['Sharp', 'Round'] },
    { key: 'result', kind: 'choice', label: 'Result', options: ['In place', 'New body'], hintId: 'obHint' },
  ],
  distanceKey: 'distance',
  defaults: () => {
    const sel = state.selection.filter((s) => s.kind === 'face' || s.kind === 'edge').map((s) => (s as { bodyId: string }).bodyId);
    const bodies = [...new Set(sel)];
    return { bodies: bodies.length ? bodies : state.bodies.length === 1 ? [state.bodies[0].id] : [], distance: 0, corners: 'Sharp', result: 'In place' };
  },
  onOpen: () => focusPrimary(),
  chips: (A: Dlg) => ({ obChip: { set: A.params.bodies.length > 0, picking: !A.params.bodies.length, text: A.params.bodies.length ? bodyNames(A.params.bodies) : 'Click a body' } }),
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params;
    if (!P.bodies.length || Math.abs(P.distance) < 1e-6) return null;
    const have = A.edit ? (A.edit as OtherFeature).bodyIds || [] : [];
    return { kind: 'offsetbody', id: A.edit ? A.edit.id : 'draft', bodies: P.bodies, distance: P.distance, sharp: P.corners === 'Sharp', copy: P.result === 'New body', bodyIds: Array.from({ length: slotsNeeded(P) }, (_, i) => have[i] || 'draft-b' + (i + 1)) };
  },
  preview: (A: Dlg) => {
    const P = A.params;
    drawBodies(P.bodies);
    setHint('obHint', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : '');
    return { handle: sizeHandle(A), cut: P.distance < 0, ok: P.bodies.length > 0 && Math.abs(P.distance) >= 1e-6 };
  },
  onBuilt: (A: Dlg) => { drawBodies(A.params.bodies); setHint('obHint', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : ''); refreshHandle(); },
  hover: () => hoverBody(),
  click: (A: Dlg) => {
    const fh = faceAtCursor();
    if (!fh) { focusPrimary(); return; }
    toggle(A.params.bodies, fh.bodyId);
    setHoverFace(null);
    updateChips(); updatePreview(); focusPrimary();
  },
  pickRef: (A: Dlg, kind, id) => { if (kind !== 'body') return false; toggle(A.params.bodies, id); updateChips(); updatePreview(); return true; },
  onClose: () => { setHoverFace(null); setSelectedFaces([]); },
  commit: (A: Dlg, P) => {
    if (!P.bodies.length) { message('Click a body first', 'warn'); return false; }
    if (Math.abs(P.distance) < 1e-6) { message('Type a distance (a minus sign shrinks)', 'warn'); focusPrimary(); return false; }
    if (A.note) { message(A.note[0].toUpperCase() + A.note.slice(1), 'warn'); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const k = ++state.counters.offsetbody; f = { id: 'ob' + k, type: 'offsetbody', name: 'Offset' + k, params: P as unknown as Record<string, unknown>, bodyIds: [] }; state.features.push(f); }
    syncSlots(f, slotsNeeded(P));
    state.selection = [];
    markDirty();
    message(`${f.name}: ${P.distance > 0 ? 'grown' : 'shrunk'} by ${fmtU(Math.abs(P.distance))}${P.result === 'New body' ? ' as a new body' : ''}`, 'ok');
    reportLater(f);
    return true;
  },
});
