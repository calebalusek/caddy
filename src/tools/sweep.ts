// Sweep (SW): move a profile (sketch region or flat body face) along a path (a connected chain of
// sketch lines and arcs, or a circle). Two selection boxes, Profile and Path: the highlighted one
// receives the next click. The result previews live on the model through the kernel.
import { emit } from '../app/hub';
import { markDirty } from '../app/regenerate';
import { baseBodies, baseBody, findProfile, whenBuilt } from '../app/solids';
import { bodyById, feats, state } from '../app/state';
import type { FaceSpec, Operation } from '../kernel/protocol';
import { profileSpec } from '../kernel/spec';
import { toWorld, vadd, vdot, vsc } from '../model/frames';
import { pathSegments, sweepPath, type PathRef } from '../model/path';
import type { OtherFeature, Vec3 } from '../model/types';
import { chainOf } from '../sketch/geom';
import { curvePts } from '../sketch/model';
import { refreshProfiles, sketchGroupVisible, toScreen } from '../sketch/visuals';
import { message } from '../ui/message';
import { insideBase, setBoldSegments, setHoverEdge, setHoverFace, visibleBodies } from '../view/bodies';
import { faceAtCursor, profileAtCursor } from '../view/hit';
import { selectedFlatFace } from '../view/interaction';
import { v3 } from '../view/planes';
import { focusPrimary, registerTool, setChoice, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';
import { autoProfile } from './extrude';
import { mouse } from './pick';

interface SweepParams {
  sketchId: string | null;
  key: string | null;
  hint?: { pts: [number, number][]; area: number };
  face?: FaceSpec | null;
  path: PathRef | null;
  orientation: 'Perpendicular' | 'Parallel';
  corners: 'Round' | 'Mitered';
  operation: Operation;
  opAuto: boolean;
}
type Dlg = ActiveDialog<SweepParams> & { pickField?: 'profile' | 'path' };

const pathOf = (P: SweepParams): ReturnType<typeof sweepPath> => sweepPath(state.features, P.path);

/** Where the profile sits: a point inside it, in space. */
function profilePoint(P: SweepParams): Vec3 | null {
  if (P.face) return P.face.p;
  const r = findProfile(P);
  return r ? toWorld(r.sk.frame!, r.pr.inner![0], r.pr.inner![1]) : null;
}

/** Join, Cut or New body, from where the profile sits and which way the path leaves it. */
function autoOperation(P: SweepParams): { op: Operation; body: string | null } {
  const bodies = visibleBodies().filter((v) => baseBody(v.id)), at = profilePoint(P), pr = pathOf(P);
  if (!bodies.length || !at) return { op: 'New body', body: null };
  let probe = at;
  if (pr.path) {
    const s = pr.path.segs, fr = pr.path.frame, W = (q: [number, number]): Vec3 => toWorld(fr, q[0], q[1]);
    const d = (p: Vec3): number => Math.hypot(p[0] - at[0], p[1] - at[1], p[2] - at[2]);
    const a = W(s[0].a), b = W(s[s.length - 1].b), first = s[0], last = s[s.length - 1];
    const lead = d(b) < d(a) ? last : first, from = d(b) < d(a) ? last.b : first.a, to = lead.type === 'line' ? (d(b) < d(a) ? lead.a : lead.b) : null;
    const dir = to ? [to[0] - from[0], to[1] - from[1]] : null;
    if (dir) { const l = Math.hypot(dir[0], dir[1]) || 1; probe = vadd(at, vsc(vadd(vsc(fr.u, dir[0] / l), vsc(fr.v, dir[1] / l)), 0.3)); }
  }
  if (insideBase(v3(probe), baseBodies())) return { op: 'Cut', body: null };
  const hit = bodies.find((b) => b.box.distanceToPoint(v3(at)) < 0.5);
  return hit ? { op: 'Join', body: hit.id } : { op: 'New body', body: null };
}
const joinBody = (P: SweepParams): string | null => {
  const hit = autoOperation(P).body;
  return (hit && bodyById(hit) ? hit : null) || (state.bodies.length ? state.bodies[state.bodies.length - 1].id : null);
};

/** The path curve nearest the cursor (within 9 px): the whole connected chain it belongs to. */
function pathAtCursor(): PathRef | null {
  let best: { sketchId: string; id: string; circle: boolean } | null = null, bd = 9;
  feats('sketch').forEach((s) => {
    if (!s.frame || !sketchGroupVisible(s)) return;
    s.curves.forEach((c) => {
      if (c.construction) return;
      const P = curvePts(s, c).map((p) => toScreen(v3(toWorld(s.frame!, p[0], p[1])))), closed = c.type === 'circle';
      for (let i = 0; i + 1 < P.length + (closed ? 1 : 0); i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if (a.behind || b.behind) continue;
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
        let t = L2 ? ((mouse.x - a.x) * dx + (mouse.y - a.y) * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(mouse.x - a.x - dx * t, mouse.y - a.y - dy * t);
        if (d < bd) { bd = d; best = { sketchId: s.id, id: c.id, circle: closed }; }
      }
    });
  });
  if (!best) return null;
  const b = best as { sketchId: string; id: string; circle: boolean }, s = feats('sketch').find((x) => x.id === b.sketchId)!;
  return { sketchId: b.sketchId, curveIds: b.circle ? [b.id] : chainOf(s, b.id, true).map((x) => x.id) };
}
function chainSegs(ref: PathRef): [Vec3, Vec3][] {
  const r = sweepPath(state.features, ref);
  return r.path ? pathSegments(r.path) : [];
}
const drawPath = (P: SweepParams): void => { const r = pathOf(P); setBoldSegments(r.path ? pathSegments(r.path) : []); };

function setProfile(A: Dlg, sel: { sketchId: string; key: string }): void {
  const P = A.params;
  delete P.face; delete P.hint;
  P.sketchId = sel.sketchId; P.key = sel.key;
  if (!P.path) A.pickField = 'path';
}

registerTool<SweepParams>({
  type: 'sweep',
  title: 'Sweep',
  icon: 'sweep',
  gc: 'g-create',
  prompt: 'Pick a profile and a path to sweep it along',
  fields: [
    { key: 'profile', kind: 'chip', label: 'Profile', chipId: 'selChip', act: 'pickProfile' },
    { key: 'path', kind: 'chip', label: 'Path', chipId: 'pathChip', act: 'pickPath' },
    { key: 'orientation', kind: 'choice', label: 'Orientation', options: ['Perpendicular', 'Parallel'] },
    { key: 'corners', kind: 'choice', label: 'Sharp corners', options: ['Round', 'Mitered'], showIf: (p) => p.orientation !== 'Parallel' },
    { key: 'operation', kind: 'choice', label: 'Operation', options: ['Join', 'Cut', 'New body'], lockOnEdit: true, hintId: 'opHint' },
  ],
  defaults: () => {
    const fs = !state.selected && !state.treeSel ? selectedFlatFace() : null;
    const base = { path: null, orientation: 'Perpendicular' as const, corners: 'Round' as const, operation: 'New body' as Operation, opAuto: true };
    if (fs) return { ...base, face: { bodyId: fs.bodyId, surf: fs.surf, n: fs.n, w: vdot(fs.n, fs.p), p: fs.p }, sketchId: null, key: null };
    const p = autoProfile();
    return { ...base, sketchId: p ? p.sketchId : null, key: p ? p.key : null };
  },
  onOpen: (A: Dlg) => { A.pickField = profilePoint(A.params) ? 'path' : 'profile'; updateChips(); },
  chips: (A: Dlg) => {
    const P = A.params, r = findProfile(P), face = P.face && baseBody(P.face.bodyId), pr = pathOf(P), n = P.path ? P.path.curveIds.length : 0;
    return {
      selChip: { set: !!r || !!face, picking: A.pickField === 'profile', text: r ? 'Profile in ' + r.sk.name : face ? 'Face of ' + (bodyById(P.face!.bodyId)?.name || 'body') : 'Click a sketch profile or a flat face' },
      pathChip: { set: !!pr.path, picking: A.pickField === 'path', text: pr.path ? `${n} curve${n > 1 ? 's' : ''} in ${pr.name}${pr.path.closed ? ' (closed)' : ''}` : 'Click a sketch line, arc or circle' },
    };
  },
  onAct: (A: Dlg, act) => {
    A.pickField = act === 'pickPath' ? 'path' : 'profile';
    updateChips();
    message(A.pickField === 'path' ? 'Click the path: a sketch line, arc or circle' : 'Click a sketch profile or a flat face');
  },
  draftStep: (A: Dlg) => {
    const P = A.params, r = findProfile(P), pr = pathOf(P);
    if (!(r || P.face) || !pr.path) return null;
    const bodyId = A.edit ? (A.edit as OtherFeature).bodyId || null : P.operation === 'Join' ? joinBody(P) || 'draft-body' : P.operation === 'New body' ? 'draft-body' : null;
    return { kind: 'sweep', id: A.edit ? A.edit.id : 'draft', profile: !P.face && r ? profileSpec(r.sk.frame!, r.pr) : null, face: P.face || null, path: pr.path, orientation: P.orientation, corners: P.corners, operation: P.operation, bodyId };
  },
  preview: (A: Dlg) => {
    const P = A.params, r = findProfile(P);
    refreshProfiles();
    drawPath(P);
    if (P.opAuto && !A.edit) { P.operation = autoOperation(P).op; setChoice('operation', P.operation); }
    setHint('opHint', P.opAuto ? 'Picked automatically' : '');
    return { cut: P.operation === 'Cut', ok: (!!r || !!P.face) && !!pathOf(P).path };
  },
  onBuilt: (A: Dlg) => {
    drawPath(A.params);
    setHint('opHint', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : A.params.opAuto ? 'Picked automatically' : '');
  },
  hover: (A: Dlg) => {
    const wantPath = A.pickField === 'path', pa = pathAtCursor();
    if (wantPath || (pa && !profileAtCursor())) {
      if (pa) { if (state.hovered) { state.hovered = null; refreshProfiles(); } setHoverFace(null); setHoverEdge(chainSegs(pa), 'path' + pa.sketchId + pa.curveIds.join(',')); return true; }
      setHoverEdge(null); setHoverFace(null);
      return false;
    }
    setHoverEdge(null);
    const ph = profileAtCursor(), fh = faceAtCursor();
    const useProfile = ph && (!fh || ph.distance - 0.05 <= fh.distance), h = useProfile ? ph!.sel : null;
    if ((h && h.sketchId + h.key) !== (state.hovered && state.hovered.sketchId + state.hovered.key)) { state.hovered = h; refreshProfiles(); }
    if (!useProfile && fh && fh.face.planar) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return !!h;
  },
  click: (A: Dlg) => {
    const P = A.params, pa = pathAtCursor(), ph = profileAtCursor(), fh = faceAtCursor();
    const useProfile = ph && (!fh || ph.distance - 0.05 <= fh.distance);
    if (pa && (A.pickField === 'path' || !(useProfile || (fh && fh.face.planar)))) {
      P.path = pa;
      const r = pathOf(P);
      message(r.path ? `Path set: ${pa.curveIds.length} connected curve${pa.curveIds.length > 1 ? 's' : ''}` : `That path can't be used: ${r.err}`, r.path ? 'ok' : 'warn');
      if (!(profilePoint(P))) A.pickField = 'profile';
    } else if (useProfile) setProfile(A, ph!.sel);
    else if (fh && fh.face.planar) {
      const f = fh.face, p: Vec3 = [fh.point.x, fh.point.y, fh.point.z];
      P.face = { bodyId: fh.bodyId, surf: f.surf, n: f.n, w: vdot(f.n, p), p };
      P.sketchId = null; P.key = null; delete P.hint;
      if (!P.path) A.pickField = 'path';
    } else if (fh) { message('That face is curved. Pick a flat face or a sketch profile.', 'warn'); return; }
    else { message('Click a sketch profile or flat face, or a sketch line, arc or circle for the path'); focusPrimary(); return; }
    if (!A.edit) P.opAuto = true;
    setHoverEdge(null); setHoverFace(null);
    updateChips(); updatePreview();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'sketch') return false;
    const s = feats('sketch').find((x) => x.id === id);
    if (!s || s.error) return true;
    const P = A.params;
    if (A.pickField === 'path') {
      const ids = s.curves.filter((c) => !c.construction).map((c) => c.id), ref = { sketchId: s.id, curveIds: ids };
      if (!sweepPath(state.features, ref).path) { message(`${s.name} isn't one connected path. Click one of its curves instead.`, 'warn'); return true; }
      P.path = ref; message(`Path set from ${s.name}`);
    } else {
      const pr = (s.profiles || []).filter((p) => p.outer).sort((a, b) => b.area - a.area)[0] || (s.profiles || [])[0];
      if (!pr) { message(`${s.name} has no closed profile`, 'warn'); return true; }
      setProfile(A, { sketchId: s.id, key: pr.key });
      message(`Profile from ${s.name}`);
    }
    updateChips(); updatePreview();
    return true;
  },
  onClose: () => { state.hovered = null; setHoverEdge(null); setHoverFace(null); setBoldSegments([]); refreshProfiles(); },
  commit: (A: Dlg, P) => {
    if (!findProfile(P) && !P.face) { message('Click a sketch profile or a flat face to sweep', 'warn'); return false; }
    const pr = pathOf(P);
    if (!pr.path) { message(`Pick a path: ${pr.err}`, 'warn'); return false; }
    P.opAuto = false;
    let f: OtherFeature;
    if (A.edit) { f = A.edit as OtherFeature; f.params = P as unknown as Record<string, unknown>; }
    else {
      const n = ++state.counters.sweep;
      f = { id: 'w' + n, type: 'sweep', name: (P.operation === 'Cut' ? 'SweepCut' : 'Sweep') + n, params: P as unknown as Record<string, unknown> };
      let bid = P.operation === 'Join' ? joinBody(P) : null;
      if (P.operation === 'New body' || (P.operation === 'Join' && !bid)) { const bn = ++state.counters.body; state.bodies.push({ id: 'b' + bn, name: 'Body' + bn, visible: true }); bid = 'b' + bn; }
      if (bid) f.bodyId = bid;
      state.features.push(f);
      state.selected = null; state.treeSel = null; state.selection = [];
    }
    markDirty();
    const k = P.path!.curveIds.length;
    message(A.edit ? `${f.name} updated` : `${f.name} along ${k} curve${k > 1 ? 's' : ''} (${P.orientation.toLowerCase()})`, 'ok');
    setTimeout(() => void whenBuilt().then(() => { if (f.error) { message(`${f.name} needs attention: ${f.note}`, 'warn'); emit('doc'); } }), 0);
    return true;
  },
});
