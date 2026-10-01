// Thread (TH): a real screw thread cut into a shaft (external) or the wall of a hole (internal).
// Click a round face. The pitch is the standard coarse one for its diameter unless you set your own.
// Threads are modeled for real, so they take a few seconds to build.
import { emit } from '../app/hub';
import { fmtU } from '../core/units';
import { markDirty } from '../app/regenerate';
import { whenBuilt } from '../app/solids';
import { bodyById, state } from '../app/state';
import type { BuildStep, FaceSpec } from '../kernel/protocol';
import type { OtherFeature, Vec3 } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace, setSelectedFaces } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { focusPrimary, registerTool, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';

interface ThreadParams {
  face: FaceSpec | null;
  size: 'Standard' | 'Custom';
  pitch: number;
  depth: number;
  length: number;
  hand: 'Right' | 'Left';
}
type Dlg = ActiveDialog<ThreadParams>;

registerTool<ThreadParams>({
  type: 'thread',
  title: 'Thread',
  icon: 'thread',
  gc: 'g-create',
  prompt: 'Click a shaft or a hole to thread',
  fields: [
    { key: 'face', kind: 'chip', label: 'Round face', chipId: 'thChip', note: 'Click a shaft (external thread) or the wall of a hole (internal). The thread starts at the end you click nearest. Modeled threads take a few seconds to build.' },
    { key: 'size', kind: 'choice', label: 'Size', options: ['Standard', 'Custom'], hintId: 'thHint' },
    { key: 'pitch', kind: 'length', label: 'Pitch', primary: true, showIf: (p) => p.size === 'Custom' },
    { key: 'length', kind: 'length', label: 'Length (0 = the whole face)' },
    { key: 'hand', kind: 'choice', label: 'Direction', options: ['Right', 'Left'] },
  ],
  advanced: [{ key: 'depth', kind: 'length', label: 'Thread depth (0 = standard)' }],
  defaults: () => ({ face: null, size: 'Standard', pitch: 0, depth: 0, length: 0, hand: 'Right' }),
  chips: (A: Dlg) => {
    const f = A.params.face, b = f ? bodyById(f.bodyId) : null;
    return { thChip: { set: !!f, text: f ? `Round face of ${b ? b.name : 'a body'}` : 'Click a shaft or a hole' } };
  },
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params;
    if (!P.face || (P.size === 'Custom' && !(P.pitch > 0))) return null;
    return { kind: 'thread', id: A.edit ? A.edit.id : 'draft', face: P.face, pitch: P.size === 'Custom' ? P.pitch : 0, depth: P.depth || 0, length: P.length || 0, hand: P.hand };
  },
  preview: (A: Dlg) => {
    const P = A.params;
    setHint('thHint', A.info || (P.size === 'Custom' && !(P.pitch > 0) ? 'Type a pitch' : ''));
    return { cut: true, ok: !!P.face && (P.size === 'Standard' || P.pitch > 0) };
  },
  onBuilt: (A: Dlg) => {
    setHint('thHint', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : A.info || '');
  },
  hover: () => {
    const fh = faceAtCursor();
    if (fh && !fh.face.planar) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return false;
  },
  click: (A: Dlg) => {
    const fh = faceAtCursor();
    if (!fh) { focusPrimary(); return; }
    if (fh.face.planar) { message('Threads go on round faces: a shaft or the wall of a hole', 'warn'); return; }
    const p: Vec3 = [fh.point.x, fh.point.y, fh.point.z];
    A.params.face = { bodyId: fh.bodyId, surf: fh.face.surf, n: fh.face.n, w: 0, p };
    setHoverFace(null);
    updateChips(); updatePreview(); focusPrimary();
  },
  onClose: () => { setHoverFace(null); setSelectedFaces([]); },
  commit: (A: Dlg, P) => {
    if (!P.face) { message('Click a shaft or a hole first', 'warn'); return false; }
    if (P.size === 'Custom' && !(P.pitch > 0)) { message('Type a pitch, or choose Standard', 'warn'); focusPrimary(); return false; }
    if (A.note) { message(A.note[0].toUpperCase() + A.note.slice(1), 'warn'); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const n = ++state.counters.thread; f = { id: 'th' + n, type: 'thread', name: 'Thread' + n, params: P as unknown as Record<string, unknown> }; state.features.push(f); }
    state.selection = [];
    markDirty();
    const feat = f;
    message(`${feat.name}: ${A.info || 'thread'}${P.length > 0 ? `, ${fmtU(P.length)} long` : ''}`, 'ok');
    setTimeout(() => void whenBuilt().then(() => { if (feat.error) { message(`${feat.name} needs attention: ${feat.note}`, 'warn'); emit('doc'); } }), 0);
    return true;
  },
});
