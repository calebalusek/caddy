// Pattern (PTR rectangular / PTC circular, one menu): copies of a feature's tool (a hole, a boss, a
// cut…) or of whole bodies, in a grid, fitted between two edges, or around an axis.
// The result previews live on the model through the kernel.
import { emit } from '../app/hub';
import { markDirty } from '../app/regenerate';
import { baseBodies, baseBody, whenBuilt } from '../app/solids';
import { bodyById, featById, feats, state } from '../app/state';
import type { BuildStep, EdgeInfo } from '../kernel/protocol';
import { vadd, vlen, vnorm, vsc, vsub, toWorld } from '../model/frames';
import { newBodiesPerSource, type PatternParams } from '../model/pattern';
import type { OtherFeature, Vec3 } from '../model/types';
import { curvePts } from '../sketch/model';
import { sketchGroupVisible, toScreen } from '../sketch/visuals';
import { message } from '../ui/message';
import { setBoldSegments, setHoverEdge, setHoverFace, setSelectedFaces } from '../view/bodies';
import { edgeAtCursor, faceAtCursor } from '../view/hit';
import { v3 } from '../view/planes';
import { focusPrimary, refreshHandle, registerTool, setHint, updateChips, updatePreview, openDialog, syncFields, type ActiveDialog } from './dialog';
import { mouse } from './pick';

type Dlg = ActiveDialog<PatternParams> & { pickMode?: 'copy' | 'e1' | 'e2' | 'v1' | 'v2' | 'axis' };
const PATTERNABLE = new Set(['extrude', 'hole', 'revolve', 'sweep']);
let preset: PatternParams['ptype'] = 'Rectangular';
/** Open the menu as the rectangular or the circular pattern (PTR / PTC). */
export function openPattern(type: PatternParams['ptype']): void { preset = type; openDialog('pattern'); }

const isRect = (P: PatternParams): boolean => P.ptype === 'Rectangular';
const spacing = (P: PatternParams): boolean => isRect(P) && P.layout !== 'Fit to edges';
const fit = (P: PatternParams): boolean => isRect(P) && P.layout === 'Fit to edges';
const AX: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

/** The feature a body face came from ("h1:h0" → h1; copies are tagged "pt1:2|h1:h0"). */
function featOfSurf(surf: string): string | null {
  const s = surf.includes('|') ? surf.split('|')[1] : surf, pre = s.split(':')[0];
  return pre && pre !== 'F' && PATTERNABLE.has(featById(pre)?.type || '') ? pre : null;
}

/** Where the first source sits (for the drag arrow). */
function sourceCenter(P: PatternParams): Vec3 | null {
  if (P.what === 'Bodies') { const b = P.bodies[0] ? baseBody(P.bodies[0]) : null; return b ? [0, 1, 2].map((i) => (b.box[0][i] + b.box[1][i]) / 2) as Vec3 : null; }
  const id = P.feats[0];
  if (!id) return null;
  const pts: Vec3[] = [];
  baseBodies().forEach((b) => b.faces.forEach((f) => { if (f.surf && !f.surf.includes('|') && f.surf.split(':')[0] === id) pts.push(f.p); }));
  if (!pts.length) return null;
  return [0, 1, 2].map((i) => pts.reduce((s, p) => s + p[i], 0) / pts.length) as Vec3;
}

/** The bodies each copy that becomes a new body needs. */
function slotsNeeded(P: PatternParams): number {
  const per = newBodiesPerSource(P);
  if (P.what === 'Bodies') return per * P.bodies.length;
  return P.feats.reduce((n, id) => { const f = featById(id); return n + (f && (f.params as any).operation === 'New body' ? per : 0); }, 0);
}

/** Bold blue on what will be copied, and on the picked edges and axis. */
function drawPicked(A: Dlg): void {
  const P = A.params, faces: { bodyId: string; faceId: number }[] = [];
  baseBodies().forEach((b) => b.faces.forEach((f) => {
    if (P.what === 'Bodies' ? P.bodies.includes(b.id) : !!f.surf && !f.surf.includes('|') && P.feats.includes(f.surf.split(':')[0])) faces.push({ bodyId: b.id, faceId: f.id });
  }));
  setSelectedFaces(faces);
  const segs: [Vec3, Vec3][] = [];
  const edge = (e: { a: Vec3; b: Vec3 } | null): void => { if (e) segs.push([e.a, e.b]); };
  if (fit(P)) { edge(P.e1); edge(P.e2); }
  if (spacing(P) && P.dir1 === 'Edge' && A.params.v1) { /* the direction is a vector; no segment to draw */ }
  if (!isRect(P) && (P.axis === 'Pick' || P.axis === 'Edge') && P.axC && P.axD) segs.push([vadd(P.axC, vsc(P.axD, -60)), vadd(P.axC, vsc(P.axD, 60))]);
  else if (!isRect(P) && AX[P.axis]) segs.push([vsc(AX[P.axis], -60), vsc(AX[P.axis], 90)]);
  setBoldSegments(segs);
}

/** The sketch circle nearest the cursor (within 9 px). */
function circleAtCursor(): { c: Vec3; d: Vec3; r: number; segs: [Vec3, Vec3][] } | null {
  let best: ReturnType<typeof circleAtCursor> = null, bd = 9;
  feats('sketch').forEach((s) => {
    if (!s.frame || !sketchGroupVisible(s)) return;
    s.curves.forEach((cv) => {
      if (cv.type !== 'circle') return;
      const W = curvePts(s, cv).map((p) => toWorld(s.frame!, p[0], p[1])), P = W.map((w) => toScreen(v3(w)));
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if (a.behind || b.behind) continue;
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
        let t = L2 ? ((mouse.x - a.x) * dx + (mouse.y - a.y) * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(mouse.x - a.x - dx * t, mouse.y - a.y - dy * t);
        if (d < bd) { bd = d; best = { c: toWorld(s.frame!, s.pts[cv.c].x, s.pts[cv.c].y), d: s.frame!.n, r: cv.r, segs: W.map((w, k) => [w, W[(k + 1) % W.length]] as [Vec3, Vec3]) }; }
      }
    });
  });
  return best;
}

const ZERO = 'Spacing 0 puts every copy on top of the original';
const mode = (A: Dlg): NonNullable<Dlg['pickMode']> => A.pickMode || 'copy';
const wantsEdge = (A: Dlg): boolean => ['e1', 'e2', 'v1', 'v2'].includes(mode(A));

registerTool<PatternParams>({
  type: 'pattern',
  title: 'Pattern',
  icon: 'pattern',
  gc: 'g-modify',
  prompt: 'Click a face of the feature to copy (or a body), then set the count',
  fields: [
    { key: 'ptype', kind: 'choice', label: 'Type', options: ['Rectangular', 'Circular'] },
    { key: 'what', kind: 'choice', label: 'Objects', options: ['Features', 'Bodies'] },
    { key: 'objs', kind: 'chip', label: 'Copy', chipId: 'copyChip', act: 'pickCopy', note: 'Click a face of the feature, or the feature in History, or a body in the Browser. Click again to remove it.' },
    { key: 'layout', kind: 'choice', label: 'Layout', options: ['Spacing', 'Fit to edges'], showIf: isRect },
    { key: 'dir1', kind: 'choice', label: 'Direction', options: ['X', 'Y', 'Z', 'Edge'], showIf: spacing },
    { key: 'v1', kind: 'chip', label: 'Direction edge', chipId: 'v1Chip', act: 'pickV1', showIf: (p) => spacing(p) && p.dir1 === 'Edge' },
    { key: 'n1', kind: 'length', label: 'Count', unit: '×', showIf: spacing },
    { key: 'd1', kind: 'length', label: 'Spacing', primary: true, showIf: spacing },
    { key: 'dir2', kind: 'choice', label: 'Second direction', options: ['None', 'X', 'Y', 'Z', 'Edge'], showIf: spacing },
    { key: 'v2', kind: 'chip', label: 'Second direction edge', chipId: 'v2Chip', act: 'pickV2', showIf: (p) => spacing(p) && p.dir2 === 'Edge' },
    { key: 'n2', kind: 'length', label: 'Count', unit: '×', showIf: (p) => spacing(p) && p.dir2 !== 'None' },
    { key: 'd2', kind: 'length', label: 'Spacing', showIf: (p) => spacing(p) && p.dir2 !== 'None' },
    { key: 'e1', kind: 'chip', label: 'Edge along the length', chipId: 'e1Chip', act: 'pickE1', showIf: fit },
    { key: 'e2', kind: 'chip', label: 'Edge along the height', chipId: 'e2Chip', act: 'pickE2', showIf: fit },
    { key: 'cols', kind: 'length', label: 'Columns (along the length edge)', unit: '×', showIf: fit },
    { key: 'rows', kind: 'length', label: 'Rows (along the height edge)', unit: '×', showIf: fit },
    { key: 'gaps', kind: 'choice', label: 'Distances', options: ['Equal', 'Custom'], showIf: fit },
    { key: 'm1', kind: 'length', label: 'Edge gap along the length', showIf: (p) => fit(p) && p.gaps === 'Custom' },
    { key: 'm2', kind: 'length', label: 'Edge gap along the height', showIf: (p) => fit(p) && p.gaps === 'Custom' },
    { key: 'axis', kind: 'choice', label: 'Axis', options: ['X', 'Y', 'Z', 'Pick'], showIf: (p) => !isRect(p) },
    { key: 'axC', kind: 'chip', label: 'Picked axis', chipId: 'axisChip', act: 'pickAxis', showIf: (p) => !isRect(p) && p.axis === 'Pick' },
    { key: 'radius', kind: 'length', label: 'Radius (0 keeps it in place)', showIf: (p) => !isRect(p) },
    { key: 'count', kind: 'length', label: 'Count', unit: '×', showIf: (p) => !isRect(p) },
    { key: 'angle', kind: 'length', label: 'Total angle', unit: '°', showIf: (p) => !isRect(p) },
  ],
  distanceKey: 'd1',
  defaults: () => {
    const fs = state.selection.find((s) => s.kind === 'face') as Extract<(typeof state.selection)[number], { kind: 'face' }> | undefined;
    const fid = fs ? featOfSurf(fs.surf) : null;
    return {
      ptype: preset, what: 'Features', feats: fid ? [fid] : [], bodies: [], layout: 'Spacing', dir1: 'X', n1: 2, d1: 0, dir2: 'None', n2: 2, d2: 0, v1: null, v2: null, e1: null, e2: null,
      cols: 2, rows: 2, gaps: 'Equal', m1: 0, m2: 0, axis: 'Z', axC: null, axD: null, radius: 0, count: 4, angle: 360,
    };
  },
  onOpen: (A: Dlg) => { A.pickMode = 'copy'; updateChips(); focusPrimary(); },
  chips: (A: Dlg) => {
    const P = A.params, m = mode(A);
    const names = P.what === 'Bodies' ? P.bodies.map((id) => bodyById(id)?.name || 'a body') : P.feats.map((id) => featById(id)?.name || 'a feature');
    const edgeText = (e: { a: Vec3; b: Vec3 } | null, ask: string): string => (e ? `Edge of ${fmtLen(vlen(vsub(e.b, e.a)))} mm` : ask);
    return {
      copyChip: { set: names.length > 0, picking: m === 'copy', text: names.length ? names.join(', ') : P.what === 'Bodies' ? 'Click a body to copy' : 'Click a face of the feature to copy' },
      v1Chip: { set: !!P.v1, picking: m === 'v1', text: P.v1 ? 'Edge direction set' : 'Click a straight edge' },
      v2Chip: { set: !!P.v2, picking: m === 'v2', text: P.v2 ? 'Edge direction set' : 'Click a straight edge' },
      e1Chip: { set: !!P.e1, picking: m === 'e1', text: edgeText(P.e1, 'Click an edge along the length') },
      e2Chip: { set: !!P.e2, picking: m === 'e2', text: edgeText(P.e2, 'Click an edge along the height') },
      axisChip: { set: !!P.axD, picking: m === 'axis', text: P.axD ? 'Axis picked' : 'Click a round edge or a sketch circle' },
    };
  },
  onAct: (A: Dlg, act) => {
    A.pickMode = ({ pickCopy: 'copy', pickE1: 'e1', pickE2: 'e2', pickV1: 'v1', pickV2: 'v2', pickAxis: 'axis' } as const)[act as 'pickCopy'] || 'copy';
    updateChips();
    message(wantsEdge(A) ? 'Click a straight edge' : mode(A) === 'axis' ? 'Click a round edge or a sketch circle' : 'Click a face of the feature to copy');
  },
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params;
    if (!(P.what === 'Bodies' ? P.bodies.length : P.feats.length)) return null;
    const have = A.edit ? (A.edit as OtherFeature).bodyIds || [] : [];
    const ids = Array.from({ length: slotsNeeded(P) }, (_, i) => have[i] || 'draft-b' + (i + 1));
    return { kind: 'pattern', id: A.edit ? A.edit.id : 'draft', params: P, bodyIds: ids };
  },
  preview: (A: Dlg) => {
    const P = A.params;
    drawPicked(A);
    setHint('h-d1', spacing(P) && !(+P.d1) ? ZERO : '');
    let handle = null;
    const c = spacing(P) ? sourceCenter(P) : null;
    if (c && P.dir1 !== 'Edge') {
      const d = AX[P.dir1], v = Math.max(0, +P.d1 || 0);
      handle = { base: v3(c), tip: v3(vadd(c, vsc(d, v))), axis: v3(d), dir: 1, value: P.d1 || 0 };
    }
    return { handle, ok: (P.what === 'Bodies' ? P.bodies.length : P.feats.length) > 0 };
  },
  onBuilt: (A: Dlg) => {
    drawPicked(A);
    refreshHandle();
    const t = A.note ? A.note[0].toUpperCase() + A.note.slice(1) : spacing(A.params) && !(+A.params.d1) ? ZERO : '';
    ['h-d1', 'h-cols', 'h-count'].forEach((id) => setHint(id, ''));
    setHint(spacing(A.params) ? 'h-d1' : fit(A.params) ? 'h-cols' : 'h-count', t);
  },
  hover: (A: Dlg) => {
    const P = A.params;
    if (!isRect(P) && mode(A) !== 'copy' || (!isRect(P) && P.axis !== 'Z')) {
      const ci = circleAtCursor();
      if (ci) { setHoverFace(null); setHoverEdge(ci.segs, 'circ' + ci.c.join(',')); return true; }
    }
    if (wantsEdge(A) || mode(A) === 'axis') {
      const eh = edgeAtCursor(baseBodies());
      const ok = eh && (mode(A) === 'axis' ? eh.edge.kind === 'round' : eh.edge.kind === 'line');
      if (eh && ok) { setHoverFace(null); setHoverEdge(eh.segs, 'pe' + eh.bodyId + eh.edge.id); return true; }
      setHoverEdge(null); setHoverFace(null);
      return false;
    }
    setHoverEdge(null);
    const fh = faceAtCursor();
    if (fh && (P.what === 'Bodies' || featOfSurf(fh.face.surf))) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return false;
  },
  click: (A: Dlg) => {
    const P = A.params, m = mode(A);
    const done = (): void => { setHoverEdge(null); setHoverFace(null); updateChips(); updatePreview(); focusPrimary(); };
    if (!isRect(P) && (m === 'axis' || P.axis !== 'Z' || m === 'copy')) {
      const ci = circleAtCursor();
      if (ci) { P.axis = 'Pick'; P.axC = ci.c; P.axD = ci.d; P.radius = ci.r; A.pickMode = 'copy'; message('Axis, center and radius taken from the circle', 'ok'); syncFields(); done(); return; }
    }
    if (wantsEdge(A) || m === 'axis') {
      const eh = edgeAtCursor(baseBodies());
      const e: EdgeInfo | undefined = eh?.edge;
      if (!eh || !e) { message(m === 'axis' ? 'Click a round edge or a sketch circle' : 'Click a straight edge'); focusPrimary(); return; }
      if (m === 'axis') { if (e.kind !== 'round') { message('That edge is straight. Click a round edge for the axis.', 'warn'); return; } P.axis = 'Pick'; P.axC = e.center!; P.axD = e.axis!; A.pickMode = 'copy'; syncFields(); done(); return; }
      if (e.kind !== 'line') { message('Click a straight edge', 'warn'); return; }
      if (m === 'v1') { P.v1 = vnorm(vsub(e.b, e.a)); A.pickMode = 'copy'; }
      else if (m === 'v2') { P.v2 = vnorm(vsub(e.b, e.a)); A.pickMode = 'copy'; }
      else if (m === 'e1') { P.e1 = { a: e.a, b: e.b }; A.pickMode = P.e2 ? 'copy' : 'e2'; }
      else { P.e2 = { a: e.a, b: e.b }; A.pickMode = 'copy'; }
      done();
      return;
    }
    const fh = faceAtCursor();
    if (!fh) { focusPrimary(); return; }
    if (P.what === 'Bodies') {
      const i = P.bodies.indexOf(fh.bodyId);
      if (i >= 0) P.bodies.splice(i, 1); else P.bodies.push(fh.bodyId);
    } else {
      const id = featOfSurf(fh.face.surf);
      if (!id) { message('Click a face made by an Extrude, Hole, Revolve or Sweep (or switch Objects to Bodies)', 'warn'); return; }
      const i = P.feats.indexOf(id);
      if (i >= 0) P.feats.splice(i, 1); else P.feats.push(id);
    }
    done();
  },
  pickRef: (A: Dlg, kind, id) => {
    const P = A.params;
    if (kind === 'body') {
      P.what = 'Bodies'; syncFields();
      const i = P.bodies.indexOf(id);
      if (i >= 0) P.bodies.splice(i, 1); else P.bodies.push(id);
    } else if (PATTERNABLE.has(kind) && featById(id)) {
      P.what = 'Features'; syncFields();
      const i = P.feats.indexOf(id);
      if (i >= 0) P.feats.splice(i, 1); else P.feats.push(id);
    } else if (kind === 'sketch' || kind === 'plane' || kind === 'origin') return false;
    else { message(`${featById(id)?.name || 'That'} can't be patterned. Pick a hole, cut, extrude, revolve or sweep.`, 'warn'); return true; }
    A.pickMode = 'copy';
    updateChips(); updatePreview(); focusPrimary();
    return true;
  },
  onClose: () => { setHoverEdge(null); setHoverFace(null); setSelectedFaces([]); setBoldSegments([]); },
  commit: (A: Dlg, P) => {
    const n = P.what === 'Bodies' ? P.bodies.length : P.feats.length;
    if (!n) { message('Click a face of the feature to copy (or a body) first', 'warn'); return false; }
    if (!(isRect(P) ? P.layout === 'Fit to edges' || +P.n1 > 1 || (P.dir2 !== 'None' && +P.n2 > 1) : +P.count > 1)) { message('Set a count of 2 or more', 'warn'); focusPrimary(); return false; }
    if (A.note) { message(A.note[0].toUpperCase() + A.note.slice(1), 'warn'); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const k = ++state.counters.pattern; f = { id: 'pt' + k, type: 'pattern', name: 'Pattern' + k, params: P as unknown as Record<string, unknown>, bodyIds: [] }; state.features.push(f); }
    // one new body for each copy that becomes its own body
    const ids = f.bodyIds || (f.bodyIds = []), need = slotsNeeded(P);
    while (ids.length < need) { const bn = ++state.counters.body; state.bodies.push({ id: 'b' + bn, name: 'Body' + bn, visible: true }); ids.push('b' + bn); }
    while (ids.length > need) { const gone = ids.pop()!; state.bodies = state.bodies.filter((b) => b.id !== gone); }
    state.selection = [];
    markDirty();
    const feat = f;
    message(`${feat.name}: ${isRect(P) ? 'rectangular' : 'circular'} pattern`, 'ok');
    setTimeout(() => void whenBuilt().then(() => { if (feat.error) { message(`${feat.name} needs attention: ${feat.note}`, 'warn'); emit('doc'); } }), 0);
    return true;
  },
});

const fmtLen = (v: number): string => String(Math.round(v * 100) / 100);
