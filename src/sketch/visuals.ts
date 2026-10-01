// How sketches look in the viewport: curves, points, region fills, dimension lines, and the
// hover (orange) / selected (bold blue) highlights.
import * as THREE from 'three';
import { cssv } from '../core/dom';
import { on } from '../app/hub';
import { feats, sameSel, state } from '../app/state';
import { toWorld } from '../model/frames';
import type { Frame, SketchFeature } from '../model/types';
import { frameMatrix, v3 } from '../view/planes';
import { camera, onFrame, scene, V3, vp } from '../view/scene';
import { ray } from '../tools/pick';
import { dimGeom } from './dimgeom';
import { sketchBoundsCenter } from './geom';
import { cmap, conCurves, conPoints, curvePts, pip, shownDim, usedPoints, type P2 } from './model';
import { sketchProfiles, type Loop, type Profile } from './profiles';

const dpr = Math.min(devicePixelRatio || 1, 2);
const skLineMat = new THREE.LineBasicMaterial(), skFixedMat = new THREE.LineBasicMaterial(), skHoverMat = new THREE.LineBasicMaterial(), skSelMat = new THREE.LineBasicMaterial();
const skConstrMat = new THREE.LineDashedMaterial({ dashSize: 2.5, gapSize: 1.8 });
const dimMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true });
export const toolMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true });
export const trimMat = new THREE.LineDashedMaterial({ depthTest: false, transparent: true, dashSize: 1.2, gapSize: 0.8 });
const pointsMat = new THREE.PointsMaterial({ size: 7 * dpr, sizeAttenuation: false, vertexColors: true, depthTest: false, transparent: true });
const ribbonMat = new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide });
const dotsMat = new THREE.PointsMaterial({ size: 13 * dpr, sizeAttenuation: false, depthTest: false, transparent: true });
const hoverMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true });
const sharedMats = new Set<THREE.Material>([skLineMat, skFixedMat, skHoverMat, skSelMat, skConstrMat, dimMat, pointsMat]);

function applyTheme(): void {
  skLineMat.color.set(cssv('--sketch')); skConstrMat.color.set(cssv('--plane')); skFixedMat.color.set(cssv('--sk-fixed'));
  skHoverMat.color.set(cssv('--accent-fill')); skSelMat.color.set(cssv('--select')); dimMat.color.set(cssv('--text-2'));
  toolMat.color.set(cssv('--accent-fill')); trimMat.color.set(cssv('--cut'));
  ribbonMat.color.set(cssv('--select')); dotsMat.color.set(cssv('--select')); hoverMat.color.set(cssv('--accent-fill'));
  refreshProfiles();
  feats('sketch').forEach(refreshSketchStyles);
}
on('theme', applyTheme);

interface SketchVis {
  group: THREE.Group;
  points: THREE.Points | null;
  pointIds: string[];
  dimObj: THREE.LineSegments | null;
  dimK: number;
  fills: Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>;
}
const visOf = new Map<string, SketchVis>();
export const liveSketchIds = (): string[] => [...visOf.keys()];

// ---- screen helpers ----
export const tw = (f: Frame, x: number, y: number, z = 0): V3 => v3(toWorld(f, x, y, z));
export const worldPerPixel = (p: V3): number => (2 * camera.position.distanceTo(p) * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, vp.clientHeight);
export function toScreen(w: V3): { x: number; y: number; behind: boolean } {
  const v = w.clone().project(camera);
  return { x: ((v.x + 1) / 2) * vp.clientWidth, y: ((1 - v.y) / 2) * vp.clientHeight, behind: v.z > 1 };
}
/** Where the cursor ray meets a sketch plane. */
export function planeHit(fr: Frame): V3 | null {
  const pl = new THREE.Plane().setFromNormalAndCoplanarPoint(v3(fr.n), v3(fr.o)), pt = new V3();
  return ray.ray.intersectPlane(pl, pt) ? pt : null;
}
export function sketchCenter(sk: SketchFeature): V3 {
  if (!sk.frame) return new V3();
  const c = sketchBoundsCenter(sk);
  if (c) return tw(sk.frame, c[0], c[1]);
  const e = sk.frame.ext;
  return tw(sk.frame, (e[0] + e[1]) / 2, (e[2] + e[3]) / 2);
}
/** Sketch units per screen pixel at the sketch. */
export const skScale = (sk: SketchFeature): number => worldPerPixel(sketchCenter(sk));
export function sketchWorldPoints(sk: SketchFeature): V3[] {
  const out: V3[] = [];
  if (!sk.frame) return out;
  sk.curves.forEach((c) => curvePts(sk, c).forEach(([x, y]) => out.push(tw(sk.frame!, x, y))));
  return out;
}
/** Every curve of a sketch as world-space segments (for highlights and picking). */
export function sketchWorldSegs(sk: SketchFeature, only?: Set<string>): [V3, V3][] {
  const out: [V3, V3][] = [];
  if (!sk.frame) return out;
  sk.curves.forEach((c) => {
    if (only && !only.has(c.id)) return;
    const P = curvePts(sk, c).map((p) => tw(sk.frame!, p[0], p[1]));
    for (let i = 0; i + 1 < P.length; i++) out.push([P[i], P[i + 1]]);
    if (c.type === 'circle') out.push([P[P.length - 1], P[0]]);
  });
  return out;
}

// ---- building ----
function loopPath<T extends THREE.Path>(L: Loop, s: T): T {
  if (L.kind === 'circle') s.absarc(L.c![0], L.c![1], L.r!, 0, Math.PI * 2, false);
  else { s.moveTo(L.pts[0][0], L.pts[0][1]); for (let i = 1; i < L.pts.length; i++) s.lineTo(L.pts[i][0], L.pts[i][1]); s.closePath(); }
  return s;
}
function profileShape(pr: Profile): THREE.Shape {
  const s = loopPath(pr.loop, new THREE.Shape());
  pr.holes.forEach((h) => s.holes.push(loopPath(h, new THREE.Path())));
  return s;
}

export function removeSketchVisual(id: string): void {
  const v = visOf.get(id);
  if (!v) return;
  scene.remove(v.group);
  v.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | undefined;
    if (mat && !sharedMats.has(mat)) mat.dispose();
  });
  visOf.delete(id);
}

export const sketchGroupVisible = (sk: SketchFeature): boolean => (sk.visible !== false || state.sketch === sk || state.treeSel === sk.id) && state.viewMode !== 'render';

export function buildSketchVisual(sk: SketchFeature): void {
  removeSketchVisual(sk.id);
  sk.profiles = [];
  if (!sk.frame) return;
  const editing = state.sketch === sk;
  const g = new THREE.Group(), M = frameMatrix(sk.frame);
  const vis: SketchVis = { group: g, points: null, pointIds: [], dimObj: null, dimK: 0, fills: new Map() };
  sk.curves.forEach((c) => {
    const geo = new THREE.BufferGeometry().setFromPoints(curvePts(sk, c).map(([x, y]) => new V3(x, y, 0.06)));
    geo.applyMatrix4(M);
    const obj = c.type === 'circle' ? new THREE.LineLoop(geo, skLineMat) : new THREE.Line(geo, skLineMat);
    obj.userData.curve = c.id;
    if (c.construction) { obj.computeLineDistances(); obj.userData.constr = true; }
    obj.renderOrder = 6;
    g.add(obj);
  });
  if (editing) {
    const ids = [...usedPoints(sk)];
    if (ids.length) {
      const geo = new THREE.BufferGeometry().setFromPoints(ids.map((id) => new V3(sk.pts[id].x, sk.pts[id].y, 0.08)));
      geo.applyMatrix4(M);
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(ids.length * 3).fill(0), 3));
      const pts = new THREE.Points(geo, pointsMat);
      pts.renderOrder = 13;
      g.add(pts);
      vis.points = pts; vis.pointIds = ids;
    }
  }
  sk.profiles = sketchProfiles(sk);
  sk.profiles.forEach((pr) => {
    const geo = new THREE.ShapeGeometry(profileShape(pr), 48);
    const idx = geo.index, pos = geo.attributes.position;
    // a point safely inside the region (first triangle's center), and a spot for the drag arrow
    if (idx && idx.count >= 3) { const i0 = idx.getX(0), i1 = idx.getX(1), i2 = idx.getX(2); pr.inner = [(pos.getX(i0) + pos.getX(i1) + pos.getX(i2)) / 3, (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3]; }
    else pr.inner = pr.loop.kind === 'circle' ? [pr.loop.c![0], pr.loop.c![1]] : [pr.loop.pts[0][0], pr.loop.pts[0][1]];
    const cp = pr.loop.pts;
    pr.centroid = pr.loop.kind === 'circle' ? [pr.loop.c![0], pr.loop.c![1]] : [cp.reduce((s, p) => s + p[0], 0) / cp.length, cp.reduce((s, p) => s + p[1], 0) / cp.length];
    if (pr.holes.length || !pip(pr.centroid, pr.loop.poly)) pr.centroid = [pr.inner[0], pr.inner[1]];
    geo.translate(0, 0, 0.03);
    geo.applyMatrix4(M);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.userData.profile = { sketchId: sk.id, key: pr.key };
    m.renderOrder = 1;
    g.add(m);
    vis.fills.set(pr.key, m);
  });
  g.visible = sketchGroupVisible(sk);
  scene.add(g);
  visOf.set(sk.id, vis);
  if (editing) buildDimLines(sk);
  refreshSketchStyles(sk);
}

/** Region fills that can be clicked right now. */
export function profileFills(): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  visOf.forEach((v) => { if (v.group.visible) v.fills.forEach((m) => out.push(m)); });
  return out;
}

export function refreshProfiles(): void {
  const skc = new THREE.Color(cssv('--sketch')), sel = new THREE.Color(cssv('--select')), hovc = new THREE.Color(cssv('--accent-fill'));
  const P = state.active ? state.active.params : null;
  const act = P && 'sketchId' in P && P.sketchId ? { sketchId: P.sketchId as string, key: P.key as string } : null;
  visOf.forEach((v, sketchId) => v.fills.forEach((m, key) => {
    const id = { sketchId, key };
    const isSel = state.active ? sameSel(act, id) : sameSel(state.selected, id);
    const isHov = !isSel && sameSel(state.hovered, id);
    m.material.color.copy(isSel ? sel : isHov ? hovc : skc);
    m.material.opacity = isSel ? 0.42 : isHov ? 0.26 : state.sketch && state.sketch.id === sketchId ? 0.13 : 0.08;
  }));
}

export function setSketchOnTop(on: boolean): void {
  [skLineMat, skFixedMat, skHoverMat, skSelMat, skConstrMat].forEach((m) => { m.depthTest = !on; m.transparent = true; m.needsUpdate = true; });
}

// ---- selection inside the sketch being edited: bold blue band under curves, big dots on points ----
function selSets(sk: SketchFeature): { curves: Set<string>; points: Set<string> } {
  const curves = new Set<string>(), points = new Set<string>(), sel = state.skSel;
  if (sel && sel.kind === 'con') { const c = sk.cons.find((x) => x.id === sel.id); if (c) { conCurves(c).forEach((id) => curves.add(id)); conPoints(c).forEach((id) => points.add(id)); } }
  const T = state.tool;
  [state.skSels, T && T.picks, T && T.sel].forEach((list) => (list || []).forEach((p) => { if (p.kind === 'curve') curves.add(p.id); else if (p.kind === 'point') points.add(p.id); }));
  return { curves, points };
}

/** A flat band along curves, hw sketch units to each side (sized from the zoom so it stays ~5 px wide). */
function ribbonGeometry(sk: SketchFeature, ids: Set<string> | null, hw: number): THREE.BufferGeometry {
  const pos: number[] = [], f = sk.frame!;
  const W = (x: number, y: number): void => { const w = toWorld(f, x, y, 0.07); pos.push(w[0], w[1], w[2]); };
  sk.curves.forEach((c) => {
    if (ids && !ids.has(c.id)) return;
    const P = curvePts(sk, c);
    if (c.type === 'circle') P.push(P[0]);
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, nx = (-dy / L) * hw, ny = (dx / L) * hw, ex = (dx / L) * hw * 0.5, ey = (dy / L) * hw * 0.5;
      const A1: P2 = [a[0] + nx - ex, a[1] + ny - ey], A2: P2 = [a[0] - nx - ex, a[1] - ny - ey], B1: P2 = [b[0] + nx + ex, b[1] + ny + ey], B2: P2 = [b[0] - nx + ex, b[1] - ny + ey];
      W(...A1); W(...A2); W(...B2); W(...A1); W(...B2); W(...B1);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

const selRibbon = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMat);
selRibbon.renderOrder = 5; selRibbon.visible = false; scene.add(selRibbon);
const selDots = new THREE.Points(new THREE.BufferGeometry(), dotsMat);
selDots.renderOrder = 14; selDots.visible = false; scene.add(selDots);
let selRibbonK = 0;

export function drawSketchSelection(sk: SketchFeature | null): void {
  if (!sk || state.sketch !== sk || !sk.frame) { selRibbon.visible = false; selDots.visible = false; return; }
  const { curves, points } = selSets(sk), k = skScale(sk);
  selRibbonK = k;
  selRibbon.geometry.dispose();
  selRibbon.geometry = ribbonGeometry(sk, curves, 2.5 * k);
  selRibbon.visible = curves.size > 0 && selRibbon.geometry.attributes.position.count > 0;
  const dots = [...points].filter((id) => sk.pts[id]).map((id) => tw(sk.frame!, sk.pts[id].x, sk.pts[id].y, 0.09));
  selDots.geometry.dispose();
  selDots.geometry = new THREE.BufferGeometry().setFromPoints(dots);
  selDots.visible = dots.length > 0;
}

export function refreshSketchStyles(sk: SketchFeature | null): void {
  const vis = sk && visOf.get(sk.id);
  if (!sk || !vis) return;
  const editing = state.sketch === sk;
  if (editing) drawSketchSelection(sk);
  const st = sk.status, { curves: selC, points: selP } = selSets(sk), hov = state.skHover;
  const hovC = new Set<string>(), hovP = new Set<string>();
  if (editing && hov) (hov.kind === 'curve' ? hovC : hovP).add(hov.id);
  if (editing && state.skHoverCon) { const c = sk.cons.find((x) => x.id === state.skHoverCon); if (c) { conCurves(c).forEach((id) => hovC.add(id)); conPoints(c).forEach((id) => hovP.add(id)); } }
  vis.group.children.forEach((o) => {
    const id = o.userData.curve as string | undefined;
    if (!id) return;
    (o as THREE.Line).material = editing && selC.has(id) ? skSelMat : editing && hovC.has(id) ? skHoverMat : o.userData.constr ? skConstrMat : st && st.curveFixed.has(id) ? skFixedMat : skLineMat;
  });
  if (editing && vis.points) {
    const col = vis.points.geometry.attributes.color as THREE.BufferAttribute;
    const cSel = new THREE.Color(cssv('--select')), cHov = new THREE.Color(cssv('--accent-fill')), cFix = new THREE.Color(cssv('--sk-fixed')), cFree = new THREE.Color(cssv('--sketch'));
    vis.pointIds.forEach((id, i) => { const c = selP.has(id) ? cSel : hovP.has(id) ? cHov : st && st.ptFixed.has(id) ? cFix : cFree; col.setXYZ(i, c.r, c.g, c.b); });
    col.needsUpdate = true;
  }
}

export function buildDimLines(sk: SketchFeature): void {
  const vis = visOf.get(sk.id);
  if (!vis) return;
  if (vis.dimObj) { vis.group.remove(vis.dimObj); vis.dimObj.geometry.dispose(); vis.dimObj = null; }
  if (state.sketch !== sk || !sk.frame) return;
  const k = skScale(sk);
  vis.dimK = k;
  if (!state.showDims) return;
  const M = cmap(sk), segs: V3[] = [];
  sk.cons.filter(shownDim).forEach((c) => dimGeom(sk, c, M, k).segs.forEach(([a, b]) => segs.push(new V3(a[0], a[1], 0.1), new V3(b[0], b[1], 0.1))));
  if (!segs.length) return;
  const geo = new THREE.BufferGeometry().setFromPoints(segs);
  geo.applyMatrix4(frameMatrix(sk.frame));
  const ls = new THREE.LineSegments(geo, dimMat);
  ls.renderOrder = 12;
  vis.group.add(ls);
  vis.dimObj = ls;
}

// ---- a whole sketch outside sketch editing: hover = orange lines, selected = bold blue band ----
const hoverLines = new THREE.LineSegments(new THREE.BufferGeometry(), hoverMat);
hoverLines.renderOrder = 19; hoverLines.visible = false; scene.add(hoverLines);
let hoverLinesKey: string | null = null;
export function showHoverLines(key: string, segs: [V3, V3][]): void {
  if (key === hoverLinesKey) return;
  hoverLinesKey = key;
  hoverLines.geometry.dispose();
  hoverLines.geometry = new THREE.BufferGeometry().setFromPoints(segs.flat());
  hoverLines.visible = true;
}
export function clearHoverLines(): void {
  if (hoverLinesKey === null) return;
  hoverLinesKey = null;
  hoverLines.visible = false;
}

const treeRibbon = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMat);
treeRibbon.renderOrder = 5; treeRibbon.visible = false; scene.add(treeRibbon);
let treeRibbonK = 0, treeRibbonFor = '';
export function drawSketchObjectSelection(): void {
  const sk = state.treeSel && !state.sketch ? feats('sketch').find((s) => s.id === state.treeSel) : null;
  if (!sk || !sk.frame || state.viewMode === 'render') { treeRibbon.visible = false; treeRibbonFor = ''; return; }
  treeRibbonK = skScale(sk);
  treeRibbonFor = sk.id;
  treeRibbon.geometry.dispose();
  treeRibbon.geometry = ribbonGeometry(sk, null, 2.5 * treeRibbonK);
  treeRibbon.visible = treeRibbon.geometry.attributes.position.count > 0;
}

export function syncSketchVisibility(): void {
  feats('sketch').forEach((s) => { const v = visOf.get(s.id); if (v) v.group.visible = sketchGroupVisible(s); });
  drawSketchObjectSelection();
}
on('select', () => { syncSketchVisibility(); refreshProfiles(); });

// keep screen-sized things the right size as the user zooms
onFrame(() => {
  const sk = state.sketch;
  if (sk) {
    const vis = visOf.get(sk.id), k = skScale(sk);
    if (vis && state.showDims && (!vis.dimK || Math.abs(k / vis.dimK - 1) > 0.05)) buildDimLines(sk);
    if ((selRibbon.visible || selDots.visible) && Math.abs(k / selRibbonK - 1) > 0.05) drawSketchSelection(sk);
  } else if (treeRibbon.visible) {
    const s = feats('sketch').find((x) => x.id === treeRibbonFor);
    if (s && Math.abs(skScale(s) / treeRibbonK - 1) > 0.05) drawSketchObjectSelection();
  }
});

