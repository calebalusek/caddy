// Shell (SH): hollow out a body. Click faces to leave open (none = a closed hollow), set the wall
// thickness, choose Inside or Outside. The result previews live on the body.
import { emit } from '../app/hub';
import { markDirty } from '../app/regenerate';
import { baseBody, shownBodies, whenBuilt } from '../app/solids';
import { bodyById, state } from '../app/state';
import { fmt } from '../core/format';
import type { BodyResult, FaceInfo } from '../kernel/protocol';
import { vadd, vdot, vsc } from '../model/frames';
import type { OtherFeature, Vec3 } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace, setSelectedFaces } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { v3 } from '../view/planes';
import { focusPrimary, refreshHandle, registerTool, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';

/** A face as the feature saves it (same as version 1 files; the body id is the feature's). */
interface ShellFace { surf: string; n: Vec3; w: number; p: Vec3; curved?: boolean }
interface ShellParams { bodyId: string | null; faces: ShellFace[]; thickness: number; direction: 'Inside' | 'Outside' }
type Dlg = ActiveDialog<ShellParams>;

const specOf = (f: FaceInfo, p: Vec3): ShellFace => ({ surf: f.surf, n: f.n, w: vdot(f.n, p), p, curved: !f.planar });
/** The body face a saved face points at right now. */
function faceFor(b: BodyResult, s: ShellFace): FaceInfo | null {
  let best: FaceInfo | null = null, bd = Infinity;
  b.faces.forEach((f) => {
    if (vdot(f.n, s.n) < 0.99 && f.planar) return;
    if (f.planar && Math.abs(vdot(f.n, f.p) - s.w) > 0.05) return;
    if (!f.planar && !(f.surf && f.surf === s.surf)) return;
    const d = Math.hypot(f.p[0] - s.p[0], f.p[1] - s.p[1], f.p[2] - s.p[2]) + (f.surf === s.surf ? 0 : 1e3);
    if (d < bd) { bd = d; best = f; }
  });
  return best;
}
const same = (a: ShellFace, b: ShellFace): boolean => (a.curved || b.curved ? !!a.surf && a.surf === b.surf : vdot(a.n, b.n) > 0.9999 && Math.abs(a.w - b.w) < 1e-3);

/** The preview body the cursor hits has new inside walls; its picked faces are looked up there, not in the plain body. */
function drawPicked(A: Dlg): void {
  const b = A.params.bodyId ? shownBodies().find((x) => x.id === A.params.bodyId) || null : null;
  const list: { bodyId: string; faceId: number }[] = [];
  if (b) A.params.faces.forEach((s) => { const f = faceFor(b, s); if (f) list.push({ bodyId: b.id, faceId: f.id }); });
  setSelectedFaces(list);
}

/** The drag arrow sits on the first open face and slides into the body, so its tip shows the wall thickness. */
function sizeHandle(A: Dlg): ReturnType<NonNullable<Parameters<typeof registerTool>[0]['preview']>>['handle'] {
  const b = A.params.bodyId ? baseBody(A.params.bodyId) : null, s = A.params.faces[0], f = b && s ? faceFor(b, s) : null;
  if (!f) return null;
  const t = Math.max(0, A.params.thickness || 0), dir = A.params.direction === 'Outside' ? 1 : -1;
  return { base: v3(f.p), tip: v3(vadd(f.p, vsc(f.n, dir * t))), axis: v3(f.n), dir, value: t };
}

registerTool<ShellParams>({
  type: 'shell',
  title: 'Shell',
  icon: 'shell',
  gc: 'g-modify',
  prompt: 'Click faces to leave open, then set the wall thickness',
  fields: [
    { key: 'faces', kind: 'chip', label: 'Faces to remove', chipId: 'shellChip', note: 'Click a face again to remove it. No faces = a closed hollow: pick the body in the Browser.' },
    { key: 'thickness', kind: 'length', label: 'Thickness', primary: true },
    { key: 'direction', kind: 'choice', label: 'Direction', options: ['Inside', 'Outside'] },
  ],
  distanceKey: 'thickness',
  minDistance: 0,
  defaults: () => {
    const fs = state.selection.filter((s) => s.kind === 'face') as Extract<(typeof state.selection)[number], { kind: 'face' }>[];
    const bodyId = fs.length ? fs[0].bodyId : null;
    return { bodyId, faces: fs.filter((s) => s.bodyId === bodyId).map((s) => ({ surf: s.surf, n: s.n, w: vdot(s.n, s.p), p: s.p, curved: !s.planar })), thickness: 0, direction: 'Inside' };
  },
  chips: (A: Dlg) => {
    const P = A.params, body = P.bodyId ? bodyById(P.bodyId) : null, n = P.faces.length;
    return { shellChip: { set: !!body, text: body ? `${body.name}: ${n ? `${n} face${n > 1 ? 's' : ''} open` : 'closed hollow'}` : 'Click a face of the body (or pick the body in the Browser)' } };
  },
  draftStep: (A: Dlg) => (A.params.bodyId && A.params.thickness > 0
    ? { kind: 'shell', id: A.edit ? A.edit.id : 'draft', bodyId: A.params.bodyId, faces: A.params.faces.map((f) => ({ ...f, bodyId: A.params.bodyId! })), thickness: A.params.thickness, direction: A.params.direction }
    : null),
  preview: (A: Dlg) => { drawPicked(A); return { handle: sizeHandle(A), cut: A.params.direction !== 'Outside', ok: !!A.params.bodyId && A.params.thickness > 0 }; },
  onBuilt: (A: Dlg) => {
    drawPicked(A);
    refreshHandle();
    setHint('h-thickness', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : '');
  },
  hover: () => {
    const fh = faceAtCursor();
    if (fh) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return false;
  },
  click: (A: Dlg) => {
    const P = A.params, fh = faceAtCursor();
    if (!fh) { focusPrimary(); return; }
    // an inside wall made by this very shell: clicking it takes back the nearest open face
    if (fh.face.surf.startsWith((A.edit ? A.edit.id : 'draft') + ':')) {
      const base = P.bodyId ? baseBody(P.bodyId) : null;
      let best = -1, bs = -Infinity;
      P.faces.forEach((s, i) => { const f = base ? faceFor(base, s) : null; const sc = -(f ? Math.hypot(f.p[0] - fh.point.x, f.p[1] - fh.point.y, f.p[2] - fh.point.z) : 0); if (sc > bs) { bs = sc; best = i; } });
      if (best >= 0) { P.faces.splice(best, 1); message('Open face removed'); updateChips(); updatePreview(); focusPrimary(); }
      else message('That is an inside wall of the shell. Click an outside face to open it.');
      setHoverFace(null);
      return;
    }
    if (P.bodyId && P.bodyId !== fh.bodyId) { P.faces = []; }
    P.bodyId = fh.bodyId;
    const s = specOf(fh.face, [fh.point.x, fh.point.y, fh.point.z]), i = P.faces.findIndex((x) => same(x, s));
    if (i >= 0) P.faces.splice(i, 1); else P.faces.push(s);
    setHoverFace(null);
    updateChips(); updatePreview(); focusPrimary();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'body') return false;
    if (!bodyById(id)) return true;
    if (A.params.bodyId !== id) A.params.faces = [];
    A.params.bodyId = id;
    updateChips(); updatePreview(); focusPrimary();
    message(`${bodyById(id)!.name} picked`);
    return true;
  },
  onClose: () => { setHoverFace(null); setSelectedFaces([]); },
  commit: (A: Dlg, P) => {
    if (!P.bodyId) { message('Click a face of the body to shell', 'warn'); return false; }
    if (!(P.thickness > 0)) { message('Thickness needs to be more than 0 mm', 'warn'); focusPrimary(); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const n = ++state.counters.shell; f = { id: 'sh' + n, type: 'shell', name: 'Shell' + n, params: P as unknown as Record<string, unknown>, bodyId: P.bodyId }; state.features.push(f); }
    state.selection = [];
    markDirty();
    const feat = f;
    message(`${feat.name}: ${fmt(P.thickness)} mm walls`, 'ok');
    setTimeout(() => void whenBuilt().then(() => { if (feat.error) { message(`${feat.name} needs attention: ${feat.note}`, 'warn'); emit('doc'); } }), 0);
    return true;
  },
});
