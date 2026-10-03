// Measure (ME): click two points for the distance and its X / Y / Z parts, click an edge for its length or
// a face for its area, and see what the part weighs for a material and infill. A view, not a feature.
// Points snap to corners, edge middles and circle centers; the first pick is A, the second B, the third starts over.
import * as THREE from 'three';
import { fmtArea, fmtLen, fmtU, unitName } from '../core/units';
import { cssv } from '../core/dom';
import { fmt } from '../core/format';
import { baseBodies } from '../app/solids';
import { bodyById } from '../app/state';
import { MATERIALS, edgeSize, weightGrams } from '../model/measure';
import { vdot, vlen, vsub } from '../model/frames';
import type { Vec3 } from '../model/types';
import { toScreen } from '../sketch/visuals';
import { setHoverFace } from '../view/bodies';
import { edgeAtCursor, faceAtCursor } from '../view/hit';
import { v3 } from '../view/planes';
import { hideInThumbnails, scene } from '../view/scene';
import { registerTool, setHint, updateChips, type ActiveDialog } from './dialog';
import { mouse, pickScale } from './pick';

interface Pick { p: Vec3; /** The flat face it was picked on, if any (to measure between parallel faces). */ plane: { n: Vec3; w: number } | null }
interface MeasureParams { material: string; infill: number; bodies: string[] }
type Dlg = ActiveDialog<MeasureParams> & { a?: Pick | null; b?: Pick | null; item?: string };

const SNAP_PX = 12;

// ---- what is drawn in the view: the two points and the line between them ----
const group = new THREE.Group();
group.renderOrder = 19;
scene.add(group);
hideInThumbnails(group);
const hov = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 11 * Math.min(devicePixelRatio || 1, 2), sizeAttenuation: false, depthTest: false, transparent: true }));
hov.renderOrder = 20; hov.visible = false;
scene.add(hov);
hideInThumbnails(hov);

function draw(A: Dlg | null): void {
  while (group.children.length) { const c = group.children[0] as THREE.Mesh; group.remove(c); c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
  if (!A) return;
  const pts = [A.a, A.b].filter((x): x is Pick => !!x).map((x) => v3(x.p));
  if (!pts.length) return;
  const dots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ size: 13 * Math.min(devicePixelRatio || 1, 2), sizeAttenuation: false, depthTest: false, transparent: true, color: cssv('--select') }));
  dots.renderOrder = 19;
  group.add(dots);
  if (pts.length === 2) {
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: cssv('--select'), depthTest: false, transparent: true, opacity: 0.95 }));
    line.renderOrder = 18;
    group.add(line);
  }
}
const showHover = (w: THREE.Vector3 | null): void => {
  hov.visible = !!w;
  if (!w) return;
  (hov.material as THREE.PointsMaterial).color.set(cssv('--accent-fill'));
  hov.geometry.dispose();
  hov.geometry = new THREE.BufferGeometry().setFromPoints([w]);
};

/** The corner, edge middle or circle center near the cursor on the body under it, or the plain spot on the face. */
function pickPoint(): { pick: Pick; snapped: boolean } | null {
  const fh = faceAtCursor();
  // a click right on a corner can miss every face: the corners themselves still count
  const bodies = fh ? baseBodies().filter((b) => b.id === fh.bodyId) : baseBodies();
  let best: Vec3 | null = null, bd = SNAP_PX * pickScale();
  const cands: Vec3[] = [];
  bodies.forEach((body) => body.edges.forEach((e) => {
    if (e.kind === 'line') cands.push(e.a, e.b, [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2]);
    else if (e.kind === 'round') { if (e.center) cands.push(e.center); if (!e.closed) cands.push(e.a, e.b); }
  }));
  cands.forEach((q) => { const s = toScreen(v3(q)); if (s.behind) return; const d = Math.hypot(s.x - mouse.x, s.y - mouse.y); if (d < bd) { bd = d; best = q; } });
  if (!fh) return best ? { pick: { p: best, plane: null }, snapped: true } : null;
  const plane = fh.face.planar ? { n: fh.face.n, w: vdot(fh.face.n, fh.face.p) } : null;
  return { pick: { p: best || [fh.point.x, fh.point.y, fh.point.z], plane }, snapped: !!best };
}

/** What is selected for the weight: the picked bodies, or all the visible ones. */
function weighed(P: MeasureParams): { volume: number; area: number; n: number } {
  const list = baseBodies().filter((b) => (P.bodies.length ? P.bodies.includes(b.id) : bodyById(b.id)?.visible !== false));
  return { volume: list.reduce((s, b) => s + b.volume, 0), area: list.reduce((s, b) => s + b.faces.reduce((q, f) => q + f.area, 0), 0), n: list.length };
}

function readout(A: Dlg): Record<string, { text: string; set?: boolean; picking?: boolean }> {
  const P = A.params, fmtP = (p: Pick): string => `${fmtLen(p.p[0])}, ${fmtLen(p.p[1])}, ${fmtLen(p.p[2])} ${unitName()}`;
  const w = weighed(P), grams = weightGrams(w.volume, P.material, 100), infilled = weightGrams(w.volume, P.material, P.infill);
  const out: Record<string, { text: string; set?: boolean; picking?: boolean }> = {
    mA: { set: !!A.a, picking: !A.a, text: A.a ? 'A: ' + fmtP(A.a) : 'Click the first point' },
    mB: { set: !!A.b, picking: !!A.a && !A.b, text: A.b ? 'B: ' + fmtP(A.b) : 'Click the second point' },
  };
  if (A.a && A.b) {
    const d = vsub(A.b.p, A.a.p), flat = A.a.plane && A.b.plane && vdot(A.a.plane.n, A.b.plane.n) < -0.9999 ? Math.abs(A.b.plane.w - A.a.plane.w) : A.a.plane && A.b.plane && vdot(A.a.plane.n, A.b.plane.n) > 0.9999 ? Math.abs(A.b.plane.w - A.a.plane.w) : null;
    out.mDist = { set: true, text: `Distance ${fmtU(vlen(d))}` + (flat !== null && flat > 1e-6 ? ` · ${fmtU(flat)} between the two parallel flat faces` : '') };
    out.mDelta = { set: true, text: `ΔX ${fmtLen(Math.abs(d[0]))} · ΔY ${fmtLen(Math.abs(d[1]))} · ΔZ ${fmtLen(Math.abs(d[2]))} ${unitName()}` };
  } else { out.mDist = { text: 'Distance: pick two points' }; out.mDelta = { text: 'ΔX ΔY ΔZ: pick two points' }; }
  out.mItem = { set: !!A.item, text: A.item || 'Click an edge for its length, a face for its area' };
  out.mBody = { set: w.n > 0, text: w.n ? `${w.n} bod${w.n > 1 ? 'ies' : 'y'}: ${fmt(Math.round((w.volume / 1000) * 1000) / 1000)} cm³ · surface ${fmtArea(w.area)}` : 'No bodies yet' };
  out.mWeight = { set: w.n > 0, text: w.n ? `${P.material} ${fmt(Math.round(grams * 10) / 10)} g if solid` + (P.infill < 100 ? ` · about ${fmt(Math.round(infilled * 10) / 10)} g at ${fmt(P.infill)} % infill (walls not counted: a rough guide)` : '') : '' };
  return out;
}

/** Say what the click landed on: an edge's length or a face's area. */
function describeClick(): string {
  const bodies = baseBodies(), eh = edgeAtCursor(bodies, 0.6);
  if (eh) {
    const s = edgeSize(eh.edge);
    if (s) return s.kind === 'line' ? `Edge: ${fmtU(s.length)} long` : s.kind === 'circle' ? `Circle edge: Ø${fmtU(s.diameter!)} · ${fmtU(s.length)} around` : `Arc edge: R${fmtU(s.radius!)} · ${fmtU(s.length)} long`;
  }
  const fh = faceAtCursor();
  return fh ? `${fh.face.planar ? 'Flat' : 'Curved'} face: ${fmtArea(fh.face.area)}` : '';
}

registerTool<MeasureParams>({
  type: 'measure',
  title: 'Measure',
  icon: 'measure',
  gc: 'g-print',
  prompt: 'Click two points to measure the distance between them',
  noFeature: true,
  fields: [
    { key: 'a', kind: 'chip', label: 'Point A', chipId: 'mA', note: 'Snaps to corners, edge middles and circle centers. The third click starts over.' },
    { key: 'b', kind: 'chip', label: 'Point B', chipId: 'mB' },
    { key: 'dist', kind: 'chip', label: 'Distance', chipId: 'mDist' },
    { key: 'delta', kind: 'chip', label: 'Along each axis', chipId: 'mDelta' },
    { key: 'item', kind: 'chip', label: 'Last click', chipId: 'mItem' },
    { key: 'body', kind: 'chip', label: 'Volume', chipId: 'mBody', note: 'All visible bodies. Click a body in the Browser to measure just that one (click it again to go back).' },
    { key: 'material', kind: 'choice', label: 'Material', options: Object.keys(MATERIALS) },
    { key: 'infill', kind: 'length', label: 'Infill', unit: '%', primary: true },
    { key: 'weight', kind: 'chip', label: 'Weight', chipId: 'mWeight' },
  ],
  defaults: () => ({ material: 'PLA', infill: 100, bodies: [] }),
  chips: (A: Dlg) => readout(A),
  preview: (A: Dlg) => { draw(A); updateChips(); setHint('h-infill', 'Percent of the inside that is filled: 100 = solid'); return { ok: true }; },
  onBuilt: (A: Dlg) => { draw(A); updateChips(); },
  hover: (A: Dlg) => {
    const pk = pickPoint();
    if (!pk) { showHover(null); setHoverFace(null); return false; }
    showHover(v3(pk.pick.p));
    void A;
    return true;
  },
  click: (A: Dlg) => {
    const pk = pickPoint();
    if (!pk) return;
    if (A.a && !A.b) A.b = pk.pick;
    else { A.a = pk.pick; A.b = null; }
    A.item = describeClick();
    draw(A); updateChips();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'body') return false;
    const i = A.params.bodies.indexOf(id);
    if (i >= 0) A.params.bodies.splice(i, 1); else A.params.bodies.push(id);
    updateChips();
    return true;
  },
  onClose: () => { draw(null); showHover(null); setHoverFace(null); },
  commit: () => true,
});
