// Combine (CB): join bodies into one, cut bodies out of one, or keep only what they share.
// The first body clicked is the one that stays; the rest are the tools used on it.
import { markDirty } from '../app/regenerate';
import { state } from '../app/state';
import type { BuildStep } from '../kernel/protocol';
import type { OtherFeature } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace, setSelectedFaces } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { bodyNames, drawBodies, hoverBody, reportLater } from './bodypick';
import { focusPrimary, registerTool, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';

interface CombineParams { target: string | null; tools: string[]; operation: 'Join' | 'Cut' | 'Intersect'; keepTools: 'Remove' | 'Keep' }
type Dlg = ActiveDialog<CombineParams>;

/** A click: the first body is the one that stays, later ones are tools; the kept body again lets everything go. */
function pickBody(A: Dlg, id: string): void {
  const P = A.params;
  if (P.target === id) { P.target = P.tools.shift() || null; }
  else if (P.tools.includes(id)) P.tools.splice(P.tools.indexOf(id), 1);
  else if (!P.target) P.target = id;
  else P.tools.push(id);
  updateChips(); updatePreview();
}

registerTool<CombineParams>({
  type: 'combine',
  title: 'Combine',
  icon: 'combine',
  gc: 'g-modify',
  prompt: 'Click the body to keep, then the bodies to use on it',
  fields: [
    { key: 'target', kind: 'chip', label: 'Body to keep', chipId: 'cbTarget', note: 'The first body you click. Click it again to let it go.' },
    { key: 'tools', kind: 'chip', label: 'Bodies to use', chipId: 'cbTools', note: 'Click more bodies in the view or the Browser. Click again to remove one.' },
    { key: 'operation', kind: 'choice', label: 'Operation', options: ['Join', 'Cut', 'Intersect'], hintId: 'cbHint' },
    { key: 'keepTools', kind: 'choice', label: 'Bodies used', options: ['Remove', 'Keep'] },
  ],
  defaults: () => {
    const sel = state.selection.filter((s) => s.kind === 'face' || s.kind === 'edge').map((s) => (s as { bodyId: string }).bodyId);
    const ids = [...new Set(sel)];
    return { target: ids[0] || null, tools: ids.slice(1), operation: 'Join', keepTools: 'Remove' };
  },
  onOpen: () => focusPrimary(),
  chips: (A: Dlg) => {
    const P = A.params;
    return {
      cbTarget: { set: !!P.target, picking: !P.target, text: P.target ? bodyNames([P.target]) : 'Click the body to keep' },
      cbTools: { set: P.tools.length > 0, picking: !!P.target && !P.tools.length, text: P.tools.length ? bodyNames(P.tools) : 'Click the bodies to use' },
    };
  },
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params;
    if (!P.target || !P.tools.length) return null;
    return { kind: 'combine', id: A.edit ? A.edit.id : 'draft', target: P.target, tools: P.tools, operation: P.operation, keepTools: P.keepTools === 'Keep' };
  },
  preview: (A: Dlg) => {
    const P = A.params;
    drawBodies(P.target ? [P.target, ...P.tools] : []);
    setHint('cbHint', P.operation === 'Join' ? 'The bodies become one body' : P.operation === 'Cut' ? 'The other bodies are cut out of the first one' : 'Only the part the bodies share is kept');
    return { cut: P.operation === 'Cut', ok: !!P.target && P.tools.length > 0 };
  },
  onBuilt: (A: Dlg) => { drawBodies(A.params.target ? [A.params.target, ...A.params.tools] : []); },
  hover: () => hoverBody(),
  click: (A: Dlg) => {
    const fh = faceAtCursor();
    if (!fh) { focusPrimary(); return; }
    setHoverFace(null);
    pickBody(A, fh.bodyId);
  },
  pickRef: (A: Dlg, kind, id) => { if (kind !== 'body') return false; pickBody(A, id); return true; },
  onClose: () => { setHoverFace(null); setSelectedFaces([]); },
  commit: (A: Dlg, P) => {
    if (!P.target) { message('Click the body to keep', 'warn'); return false; }
    if (!P.tools.length) { message('Click the bodies to use on it', 'warn'); return false; }
    if (A.note) { message(A.note[0].toUpperCase() + A.note.slice(1), 'warn'); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const k = ++state.counters.combine; f = { id: 'cb' + k, type: 'combine', name: 'Combine' + k, params: P as unknown as Record<string, unknown> }; state.features.push(f); }
    state.selection = [];
    markDirty();
    message(`${f.name}: ${P.operation === 'Join' ? 'joined' : P.operation === 'Cut' ? 'cut' : 'intersected'} ${P.tools.length} bod${P.tools.length > 1 ? 'ies' : 'y'}`, 'ok');
    reportLater(f);
    return true;
  },
});
