// Bodies in the viewport: the lit satin mesh with crisp edge lines, plus the highlights for
// faces and edges (hover = orange, selected = bold blue).
import * as THREE from 'three';
import { cssv } from '../core/dom';
import { on } from '../app/hub';
import { state } from '../app/state';
import type { BodyResult, EdgeInfo, FaceInfo } from '../kernel/protocol';
import type { Vec3 } from '../model/types';
import { bodyMat, camera, cam, edgeMat, onFrame, scene, V3, vp } from './scene';

const ghostMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const ghostEdgeMat = new THREE.LineBasicMaterial({ transparent: true, opacity: 0.35, depthWrite: false });
/** Both sides, for "is this point inside the body" ray tests. */
const testMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
const faceHovMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const faceSelMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const edgeHovMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true });
const ribbonMat = new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.9, side: THREE.DoubleSide });

export interface BodyVis {
  id: string;
  data: BodyResult;
  group: THREE.Group;
  mesh: THREE.Mesh;
  testMesh: THREE.Mesh;
  lines: THREE.LineSegments;
  box: THREE.Box3;
  faceById: Map<number, FaceInfo>;
  edgeById: Map<number, EdgeInfo>;
}
const visById = new Map<string, BodyVis>();
export const bodyVis = (id: string): BodyVis | undefined => visById.get(id);
export const allBodyVis = (): BodyVis[] => [...visById.values()];
const isVisible = (id: string): boolean => { const b = state.bodies.find((x) => x.id === id); return !b || b.visible !== false; };
export const visibleBodies = (): BodyVis[] => allBodyVis().filter((v) => isVisible(v.id));

function applyLook(v: BodyVis): void {
  // other sketches ghost the bodies; a sketch on a body face keeps them solid
  const ghost = state.mode === 'sketch' && !(state.sketch && state.sketch.onFace);
  v.mesh.material = ghost ? ghostMat : bodyMat;
  v.lines.material = ghost ? ghostEdgeMat : edgeMat;
  v.group.visible = isVisible(v.id);
}
export function refreshBodyLooks(): void { visById.forEach(applyLook); }
on('mode', refreshBodyLooks);

/** Replace what is shown with a fresh build result. */
export function showBodies(results: BodyResult[]): void {
  visById.forEach((v) => { scene.remove(v.group); v.mesh.geometry.dispose(); v.lines.geometry.dispose(); });
  visById.clear();
  results.forEach((data) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.mesh.positions, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.mesh.normals, 3));
    geo.setIndex(new THREE.BufferAttribute(data.mesh.indices, 1));
    const mesh = new THREE.Mesh(geo, bodyMat);
    mesh.userData.bodyId = data.id;
    const lgeo = new THREE.BufferGeometry();
    lgeo.setAttribute('position', new THREE.BufferAttribute(data.mesh.edgeLines, 3));
    const lines = new THREE.LineSegments(lgeo, edgeMat);
    const group = new THREE.Group();
    group.add(mesh, lines);
    scene.add(group);
    const testMesh = new THREE.Mesh(geo, testMat);
    const box = new THREE.Box3(new V3(...data.box[0]), new V3(...data.box[1]));
    const v: BodyVis = { id: data.id, data, group, mesh, testMesh, lines, box, faceById: new Map(data.faces.map((f) => [f.id, f])), edgeById: new Map(data.edges.map((e) => [e.id, e])) };
    visById.set(data.id, v);
    applyLook(v);
  });
  ribbonKey = '';
}

function applyTheme(): void {
  ghostMat.color.set(cssv('--body')); ghostEdgeMat.color.set(cssv('--edge'));
  faceHovMat.color.set(cssv('--accent-fill'));
  faceSelMat.color.set(cssv('--select')).multiplyScalar(0.62); // darker blue fill
  edgeHovMat.color.set(cssv('--accent-fill'));
  ribbonMat.color.set(cssv('--select'));
}
on('theme', applyTheme);

// ---- looking things up from a mesh hit ----
/** Which B-rep face a triangle of the body mesh belongs to. */
export function faceOfTriangle(v: BodyVis, triangle: number): FaceInfo | null {
  const i = triangle * 3, groups = v.data.mesh.faceGroups;
  let lo = 0, hi = groups.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1, g = groups[m];
    if (i < g.start) hi = m - 1; else if (i >= g.start + g.count) lo = m + 1; else return v.faceById.get(g.faceId) || null;
  }
  return null;
}
/** One face's triangles as their own geometry, lifted a hair off the surface. */
export function faceGeometry(v: BodyVis, faceId: number): THREE.BufferGeometry {
  const g = v.data.mesh.faceGroups.find((x) => x.faceId === faceId), out: number[] = [];
  if (g) {
    const P = v.data.mesh.positions, N = v.data.mesh.normals, I = v.data.mesh.indices;
    for (let k = g.start; k < g.start + g.count; k++) { const i = I[k] * 3; out.push(P[i] + N[i] * 0.04, P[i + 1] + N[i + 1] * 0.04, P[i + 2] + N[i + 2] * 0.04); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return geo;
}
/** The drawn segments of one edge, as point pairs. */
export function edgeSegments(data: BodyResult, edgeId: number): [Vec3, Vec3][] {
  const g = data.mesh.edgeGroups.find((x) => x.edgeId === edgeId), out: [Vec3, Vec3][] = [];
  if (!g) return out;
  const L = data.mesh.edgeLines;
  for (let k = g.start; k + 1 < g.start + g.count; k += 2) out.push([[L[k * 3], L[k * 3 + 1], L[k * 3 + 2]], [L[k * 3 + 3], L[k * 3 + 4], L[k * 3 + 5]]]);
  return out;
}
/** Edges that border a face. */
export const edgesOfFace = (data: BodyResult, faceId: number): EdgeInfo[] => data.edges.filter((e) => e.faces.includes(faceId));

// ---- inside test (for picking Join / Cut automatically) ----
const testRay = new THREE.Raycaster(), testDir = new V3(0.5773, 0.5901, 0.5643).normalize();
export function insideAnyBody(pt: V3): boolean {
  return visibleBodies().some((v) => {
    if (!v.box.containsPoint(pt)) return false;
    testRay.set(pt, testDir);
    const hits = testRay.intersectObject(v.testMesh, false);
    let n = 0, last = -1;
    hits.forEach((h) => { if (h.distance - last > 1e-5) { n++; last = h.distance; } });
    return n % 2 === 1;
  });
}

/**
 * The same test against the model without any open tool's live preview (the bodies as the timeline
 * built them), so a tool that previews on the real body does not see its own preview when it picks Join or Cut.
 */
const baseMeshes = new WeakMap<BodyResult, THREE.Mesh>();
export function insideBase(pt: V3, bodies: BodyResult[]): boolean {
  return bodies.some((b) => {
    if (!isVisible(b.id) || !new THREE.Box3(new V3(...b.box[0]), new V3(...b.box[1])).containsPoint(pt)) return false;
    let m = baseMeshes.get(b);
    if (!m) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(b.mesh.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(b.mesh.indices, 1));
      m = new THREE.Mesh(geo, testMat);
      baseMeshes.set(b, m);
    }
    testRay.set(pt, testDir);
    let n = 0, last = -1;
    testRay.intersectObject(m, false).forEach((h) => { if (h.distance - last > 1e-5) { n++; last = h.distance; } });
    return n % 2 === 1;
  });
}

// ---- highlights ----
const hovFace = new THREE.Mesh(new THREE.BufferGeometry(), faceHovMat);
hovFace.renderOrder = 6; hovFace.visible = false; scene.add(hovFace);
const selFaces = new THREE.Group();
scene.add(selFaces);
const hovEdge = new THREE.LineSegments(new THREE.BufferGeometry(), edgeHovMat);
hovEdge.renderOrder = 16; hovEdge.visible = false; scene.add(hovEdge);
const ribbon = new THREE.Mesh(new THREE.BufferGeometry(), ribbonMat);
ribbon.renderOrder = 17; ribbon.visible = false; scene.add(ribbon);
let ribbonSegs: [Vec3, Vec3][] = [], ribbonKey = '';

let hovFaceKey = '';
export function setHoverFace(bodyId: string | null, faceId?: number): void {
  const key = bodyId ? bodyId + ':' + faceId : '';
  if (key === hovFaceKey) return;
  hovFaceKey = key;
  const v = bodyId ? visById.get(bodyId) : null;
  hovFace.geometry.dispose();
  hovFace.geometry = v ? faceGeometry(v, faceId!) : new THREE.BufferGeometry();
  hovFace.visible = !!v;
}
let hovEdgeKey = '';
export function setHoverEdge(segs: [Vec3, Vec3][] | null, key = ''): void {
  if (key === hovEdgeKey && !!segs === hovEdge.visible) return;
  hovEdgeKey = key;
  hovEdge.geometry.dispose();
  hovEdge.geometry = new THREE.BufferGeometry().setFromPoints((segs || []).flatMap(([a, b]) => [new V3(...a), new V3(...b)]));
  hovEdge.visible = !!segs && segs.length > 0;
}
/** Selected faces get a darker blue fill; selected edges a bold blue band that always faces the camera. */
export function setSelectedFaces(list: { bodyId: string; faceId: number }[]): void {
  while (selFaces.children.length) { const c = selFaces.children[0] as THREE.Mesh; selFaces.remove(c); c.geometry.dispose(); }
  list.forEach((s) => { const v = visById.get(s.bodyId); if (!v) return; const m = new THREE.Mesh(faceGeometry(v, s.faceId), faceSelMat); m.renderOrder = 5; selFaces.add(m); });
}
export function setBoldSegments(segs: [Vec3, Vec3][]): void { ribbonSegs = segs; ribbonKey = ''; if (!segs.length) ribbon.visible = false; }

const worldPerPixel = (p: V3): number => (2 * camera.position.distanceTo(p) * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, vp.clientHeight);
onFrame(() => {
  if (!ribbonSegs.length) return;
  const cp = camera.position, key = [cp.x, cp.y, cp.z, cam.target.x, cam.target.y, cam.target.z, vp.clientWidth, vp.clientHeight].map((n) => n.toFixed(3)).join(',');
  if (key === ribbonKey && ribbon.visible) return;
  ribbonKey = key;
  const pos: number[] = [], a = new V3(), b = new V3(), m = new V3(), d = new V3(), s = new V3(), e = new V3();
  ribbonSegs.forEach(([pa, pb]) => {
    a.set(...pa); b.set(...pb); m.addVectors(a, b).multiplyScalar(0.5);
    const hw = 2.5 * worldPerPixel(m);
    d.subVectors(b, a).normalize();
    s.crossVectors(d, e.subVectors(cp, m).normalize());
    const L = s.length();
    if (L < 1e-9) return;
    s.multiplyScalar(hw / L);
    e.copy(d).multiplyScalar(hw * 0.5);
    const A1 = a.clone().sub(e).add(s), A2 = a.clone().sub(e).sub(s), B1 = b.clone().add(e).add(s), B2 = b.clone().add(e).sub(s);
    [A1, A2, B2, A1, B2, B1].forEach((p) => pos.push(p.x, p.y, p.z));
  });
  ribbon.geometry.dispose();
  ribbon.geometry = new THREE.BufferGeometry();
  ribbon.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ribbon.visible = pos.length > 0;
});

export function clearBodyHighlights(): void {
  setHoverFace(null); setHoverEdge(null); setSelectedFaces([]); setBoldSegments([]);
}

/** Corner points of visible bodies, for zoom-to-fit. */
export function bodyFitPoints(): V3[] {
  const pts: V3[] = [];
  visibleBodies().forEach((v) => { const x = v.box; for (let i = 0; i < 8; i++) pts.push(new V3(i & 1 ? x.max.x : x.min.x, i & 2 ? x.max.y : x.min.y, i & 4 ? x.max.z : x.min.z)); });
  return pts;
}
