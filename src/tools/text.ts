// Text (TXT): letters on a plane or a flat face, raised (Join / New body) or engraved (Cut).
// Type the words, then the size and the height. The result previews live on the model.
import { emit } from '../app/hub';
import { markDirty, resolveRef } from '../app/regenerate';
import { whenBuilt } from '../app/solids';
import { state } from '../app/state';
import { fmt } from '../core/format';
import type { BuildStep, Operation } from '../kernel/protocol';
import { toWorld, vadd, vsc } from '../model/frames';
import type { OtherFeature, PlaneRef, Vec3 } from '../model/types';
import { message } from '../ui/message';
import { visibleBodies } from '../view/bodies';
import { v3 } from '../view/planes';
import { focusPrimary, openDialog, registerTool, setChoice, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';
import { endPick, planeName, selectedPlaneRef, startPick } from './pick';
import { stepFor } from '../model/steps';

interface TextParams {
  text: string;
  font: 'Barlow' | 'Barlow Bold';
  size: number;
  height: number;
  ref: PlaneRef | null;
  x: number;
  y: number;
  angle: number;
  operation: Operation;
  opAuto: boolean;
}
type Dlg = ActiveDialog<TextParams>;

let preset: PlaneRef | null = null;
/** Open the Text tool, optionally on the plane a sketch was on (the Text button inside a sketch). */
export function openText(ref?: PlaneRef | null): void {
  preset = ref || null;
  openDialog('text');
}

function pickPlane(): void {
  const A = state.active as Dlg | null;
  if (!A) return;
  startPick({
    title: 'Text',
    prompt: 'Select the plane or flat face the text goes on',
    beforeIndex: A.edit ? state.features.indexOf(A.edit) : null,
    onPick: (ref) => {
      if (state.active !== A) return;
      A.params.ref = ref;
      if (A.params.opAuto && !A.edit) { A.params.operation = ref.kind === 'face' ? 'Join' : 'New body'; setChoice('operation', A.params.operation); }
      updateChips(); updatePreview(); focusPrimary();
      message(`Text on ${planeName(ref)}. Type the words, a size and a height.`);
    },
    onCancel: () => { updateChips(); },
  });
  updateChips();
}

/** Where the text's middle lands in space, for the arrow and for picking the body to join. */
function anchorWorld(A: Dlg): Vec3 | null {
  const f = { id: 'x', type: 'text', name: '', params: A.params } as unknown as OtherFeature, st = stepFor(state.features, f);
  return st && st.kind === 'text' && st.frame ? toWorld(st.frame, st.anchor[0], st.anchor[1]) : null;
}
const joinBody = (A: Dlg): string | null => {
  const at = anchorWorld(A), hit = at ? visibleBodies().find((b) => b.box.distanceToPoint(v3(at)) < 0.5) : null;
  return hit ? hit.id : state.bodies.length ? state.bodies[state.bodies.length - 1].id : null;
};

registerTool<TextParams>({
  type: 'text',
  title: 'Text',
  icon: 'text',
  gc: 'g-create',
  prompt: 'Type the text, then its size and height',
  fields: [
    { key: 'text', kind: 'text', label: 'Text', note: 'Type the words' },
    { key: 'ref', kind: 'chip', label: 'On', chipId: 'tpChip', act: 'repick' },
    { key: 'font', kind: 'choice', label: 'Font', options: ['Barlow', 'Barlow Bold'] },
    { key: 'size', kind: 'length', label: 'Letter size', primary: true },
    { key: 'height', kind: 'length', label: 'Height (how far it stands out or cuts in)' },
    { key: 'operation', kind: 'choice', label: 'Operation', options: ['Join', 'Cut', 'New body'], lockOnEdit: true, hintId: 'opHint' },
  ],
  advanced: [
    { key: 'x', kind: 'length', label: 'Move sideways' },
    { key: 'y', kind: 'length', label: 'Move up' },
    { key: 'angle', kind: 'length', label: 'Turn', unit: '°' },
  ],
  distanceKey: 'height',
  minDistance: 0,
  defaults: () => {
    const ref = preset || selectedPlaneRef();
    preset = null;
    return { text: '', font: 'Barlow Bold', size: 0, height: 0, ref, x: 0, y: 0, angle: 0, operation: ref && ref.kind === 'face' ? 'Join' : 'New body', opAuto: true };
  },
  onOpen: (A: Dlg) => { if (!A.params.ref) pickPlane(); else document.querySelector<HTMLInputElement>('section.dialog #f-text')?.focus(); },
  chips: (A: Dlg) => {
    const picking = !!state.pick;
    return { tpChip: { picking, set: !!A.params.ref, text: picking ? 'Click a plane or flat face…' : A.params.ref ? planeName(A.params.ref) : 'Click to pick a plane or face' } };
  },
  onAct: () => pickPlane(),
  onEscape: (A: Dlg) => { if (state.pick && A.params.ref) { endPick(); updateChips(); focusPrimary(); return true; } return false; },
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params, f = { id: A.edit ? A.edit.id : 'draft', type: 'text', name: '', params: P } as unknown as OtherFeature;
    if (!P.text.trim() || !(P.size > 0) || !(P.height > 0) || !resolveRef(P.ref)) return null;
    const st = stepFor(state.features, f);
    if (!st || st.kind !== 'text') return null;
    return { ...st, bodyId: A.edit ? (A.edit as OtherFeature).bodyId || null : P.operation === 'Join' ? joinBody(A) || 'draft-body' : P.operation === 'New body' ? 'draft-body' : null };
  },
  preview: (A: Dlg) => {
    const P = A.params, fr = resolveRef(P.ref), at = anchorWorld(A);
    setHint('opHint', P.opAuto ? 'Picked automatically from where the text goes' : '');
    setHint('h-height', P.text.trim() && P.size > 0 && P.height > 0 ? '' : 'Type the text, a letter size and a height');
    const handle = fr && at ? { base: v3(at), tip: v3(vadd(at, vsc(fr.n, (P.operation === 'Cut' ? -1 : 1) * Math.max(0, P.height)))), axis: v3(fr.n), dir: P.operation === 'Cut' ? -1 : 1, value: P.height } : null;
    return { handle, cut: P.operation === 'Cut', ok: !!P.text.trim() && P.size > 0 && P.height > 0 && !!fr };
  },
  onBuilt: (A: Dlg) => { setHint('opHint', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : A.params.opAuto ? 'Picked automatically from where the text goes' : ''); },
  commit: (A: Dlg, P) => {
    if (!resolveRef(P.ref)) { message('Pick the plane or face the text goes on', 'warn'); pickPlane(); return false; }
    if (!P.text.trim()) { message('Type the text first', 'warn'); return false; }
    if (!(P.size > 0)) { message('Give the letters a size', 'warn'); focusPrimary(); return false; }
    if (!(P.height > 0)) { message('Give the text a height', 'warn'); return false; }
    P.opAuto = false;
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else {
      const n = ++state.counters.text;
      f = { id: 'tx' + n, type: 'text', name: (P.operation === 'Cut' ? 'Engrave' : 'Text') + n, params: P as unknown as Record<string, unknown> };
      let bid = P.operation === 'Join' ? joinBody(A) : null;
      if (P.operation === 'New body' || (P.operation === 'Join' && !bid)) { const bn = ++state.counters.body; state.bodies.push({ id: 'b' + bn, name: 'Body' + bn, visible: true }); bid = 'b' + bn; }
      if (bid) f.bodyId = bid;
      state.features.push(f);
      state.selection = [];
    }
    markDirty();
    const feat = f;
    message(`${feat.name}: "${P.text.length > 24 ? P.text.slice(0, 24) + '…' : P.text}", ${fmt(P.size)} mm letters, ${fmt(P.height)} mm ${P.operation === 'Cut' ? 'deep' : 'high'}`, 'ok');
    setTimeout(() => void whenBuilt().then(() => { if (feat.error) { message(`${feat.name} needs attention: ${feat.note}`, 'warn'); emit('doc'); } }), 0);
    return true;
  },
});
