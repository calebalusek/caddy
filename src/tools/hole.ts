// Hole (HO): simple, counterbore or countersink holes on flat faces or sketch points.
// Each hole shows a marker (ring + crosshair, blue; orange on hover) that can be dragged along its face.
import * as THREE from 'three';
import { emit, on } from '../app/hub';
import { markDirty } from '../app/regenerate';
import { baseBody, whenBuilt } from '../app/solids';
import { feats, state } from '../app/state';
import { cssv } from '../core/dom';
import { fmt } from '../core/format';
import type { BuildStep } from '../kernel/protocol';
import { vadd, vcross, vdot, vnorm, vsc, vsub } from '../model/frames';
import { holeSpot, type HoleRef } from '../model/steps';
import type { OtherFeature, Vec3 } from '../model/types';
import { usedPoints } from '../sketch/model';
import { sketchGroupVisible, toScreen, tw, worldPerPixel } from '../sketch/visuals';
import { message } from '../ui/message';
import { setHoverFace } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { v3 } from '../view/planes';
import { hideInThumbnails, scene, V3 } from '../view/scene';
import { focusPrimary, registerTool, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';
import { mouse } from './pick';

interface HoleParams {
  pts: HoleRef[];
  d: number;
  extent: 'Through all' | 'Distance';
  depth: number;
  type: 'Simple' | 'Counterbore' | 'Countersink';
  cbD: number;
  cbDepth: number;
  csD: number;
}
type Dlg = ActiveDialog<HoleParams> & { hoverHole?: number };

/** Where a hole sits right now and which way is "out" of the surface. */
function placement(ref: HoleRef): { c: Vec3; n: Vec3 } | null {
  if (ref.kind === 'spt') { const s = holeSpot(state.features, ref); return s && 'c' in s ? { c: s.c, n: vsc(s.dir, -1) } : null; }
  const b = baseBody(ref.bodyId), n = vnorm(ref.n);
  let w = ref.w;
  if (b) {
    // follow the face if it moved along its normal
    let best: { sc: number; w: number } | null = null;
    b.faces.forEach((f) => { if (!f.planar || vdot(f.n, n) < 0.9999) return; const fw = vdot(n, f.p), sc = (f.surf === ref.surf ? 0 : 1e6) + Math.abs(fw - ref.w); if (!best || sc < best.sc) best = { sc, w: fw }; });
    if (best) w = (best as { w: number }).w;
  }
  return { c: vadd(ref.p, vsc(n, w - ref.w)), n };
}

// ---- markers ----
const marks = new THREE.Group();
marks.renderOrder = 17;
scene.add(marks);
hideInThumbnails(marks);
function drawMarkers(A: Dlg | null): void {
  while (marks.children.length) { const c = marks.children[0] as THREE.Mesh; marks.remove(c); c.geometry.dispose(); (c.material as THREE.Material).dispose(); }
  if (!A) return;
  const P = A.params;
  P.pts.forEach((ref, k) => {
    const pl = placement(ref);
    if (!pl) return;
    const { c, n } = pl, u = vnorm(Math.abs(n[2]) < 0.9 ? vcross(n, [0, 0, 1]) : vcross(n, [1, 0, 0])), v = vcross(n, u);
    const px = worldPerPixel(v3(c)), R = Math.max((P.d || 0) / 2, 5 * px), lift = vsc(n, 0.03), cx = 7 * px;
    const hot = k === A.hoverHole, col = cssv(hot ? '--accent-fill' : '--select');
    const ring: V3[] = [];
    for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2; ring.push(v3(vadd(vadd(c, lift), vadd(vsc(u, R * Math.cos(t)), vsc(v, R * Math.sin(t)))))); }
    const line = (): THREE.LineBasicMaterial => new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: 0.95 });
    const L = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ring), line());
    L.renderOrder = 18;
    const cross = [vsub(c, vsc(u, cx)), vadd(c, vsc(u, cx)), vsub(c, vsc(v, cx)), vadd(c, vsc(v, cx))].map((p) => v3(vadd(p, lift)));
    const X = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(cross), line());
    X.renderOrder = 18;
    // soft fill so the spot reads as a hole, not a dot
    const fill = [v3(vadd(c, lift)), ...ring], idx: number[] = [];
    for (let i = 1; i < ring.length; i++) idx.push(0, i, i + 1);
    const fg = new THREE.BufferGeometry().setFromPoints(fill);
    fg.setIndex(idx);
    const F = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: hot ? 0.22 : 0.14, depthTest: false, side: THREE.DoubleSide }));
    F.renderOrder = 17;
    marks.add(F, L, X);
  });
}
on('theme', () => { if (state.active && state.active.type === 'hole') drawMarkers(state.active as Dlg); });

/** The hole marker under the cursor. */
function markerAt(A: Dlg): number {
  let best = -1, bd = Infinity;
  A.params.pts.forEach((r, k) => {
    const pl = placement(r);
    if (!pl) return;
    const s = toScreen(v3(pl.c));
    if (s.behind) return;
    const rpx = Math.max(10, (A.params.d || 0) / 2 / worldPerPixel(v3(pl.c)) + 4), d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
    if (d < rpx && d < bd) { bd = d; best = k; }
  });
  return best;
}
/** A sketch point near the cursor (holes placed on it follow the sketch). */
function sketchPointAtCursor(): { ref: HoleRef; w: V3 } | null {
  let best: { ref: HoleRef; w: V3 } | null = null, bd = 11;
  feats('sketch').forEach((s) => {
    if (!s.frame || !sketchGroupVisible(s)) return;
    usedPoints(s).forEach((id) => {
      const w = tw(s.frame!, s.pts[id].x, s.pts[id].y), sp = toScreen(w), d = Math.hypot(sp.x - mouse.x, sp.y - mouse.y);
      if (d < bd) { bd = d; best = { ref: { kind: 'spt', sketchId: s.id, pointId: id }, w }; }
    });
  });
  return best;
}
const hovPoint = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ size: 11 * Math.min(devicePixelRatio || 1, 2), sizeAttenuation: false, depthTest: false, transparent: true }));
hovPoint.renderOrder = 19; hovPoint.visible = false;
scene.add(hovPoint);
function showHoverPoint(w: V3 | null): void {
  hovPoint.visible = !!w;
  if (!w) return;
  (hovPoint.material as THREE.PointsMaterial).color.set(cssv('--accent-fill'));
  hovPoint.geometry.dispose();
  hovPoint.geometry = new THREE.BufferGeometry().setFromPoints([w]);
}

const step = (A: Dlg): BuildStep | null => {
  const P = A.params;
  if (!P.pts.length || !(P.d > 0)) return null;
  return { kind: 'hole', id: A.edit ? A.edit.id : 'draft', at: P.pts.map((r) => holeSpot(state.features, r)), d: P.d, through: P.extent !== 'Distance', depth: P.depth || 0, type: P.type, cbD: P.cbD || 0, cbDepth: P.cbDepth || 0, csD: P.csD || 0 };
};

registerTool<HoleParams>({
  type: 'hole',
  title: 'Hole',
  icon: 'hole',
  gc: 'g-create',
  prompt: 'Click flat faces or sketch points to place holes',
  fields: [
    { key: 'pts', kind: 'chip', label: 'Placement', chipId: 'holeChip', note: 'Click again on a hole to remove it, or drag it along its face. Snaps to sketch points.' },
    { key: 'd', kind: 'length', label: 'Diameter', primary: true },
    { key: 'extent', kind: 'choice', label: 'Extent', options: ['Through all', 'Distance'] },
    { key: 'depth', kind: 'length', label: 'Depth', showIf: (P) => P.extent === 'Distance' },
    { key: 'type', kind: 'choice', label: 'Type', options: ['Simple', 'Counterbore', 'Countersink'], hintId: 'holeHint' },
    { key: 'cbD', kind: 'length', label: 'Counterbore diameter', showIf: (P) => P.type === 'Counterbore' },
    { key: 'cbDepth', kind: 'length', label: 'Counterbore depth', showIf: (P) => P.type === 'Counterbore' },
    { key: 'csD', kind: 'length', label: 'Countersink diameter (90°)', showIf: (P) => P.type === 'Countersink' },
  ],
  defaults: () => ({ pts: [], d: 0, extent: 'Through all', depth: 0, type: 'Simple', cbD: 0, cbDepth: 0, csD: 0 }),
  chips: (A) => { const n = A.params.pts.length; return { holeChip: { set: n > 0, text: n ? `${n} hole${n > 1 ? 's' : ''} placed` : 'Click a flat face or sketch point' } }; },
  draftStep: step,
  preview: (A: Dlg) => { drawMarkers(A); return { ok: A.params.pts.length > 0 && A.params.d > 0 }; },
  onBuilt: (A: Dlg) => { drawMarkers(A); setHint('holeHint', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : ''); },
  hover: (A: Dlg) => {
    const k = markerAt(A);
    if (k !== (A.hoverHole ?? -1)) { A.hoverHole = k; drawMarkers(A); }
    if (k >= 0) { showHoverPoint(null); setHoverFace(null); return true; }
    const sp = sketchPointAtCursor();
    showHoverPoint(sp ? sp.w : null);
    if (sp) { setHoverFace(null); return true; }
    const fh = faceAtCursor();
    if (fh && fh.face.planar) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return false;
  },
  click: (A: Dlg) => {
    const P = A.params, k = markerAt(A);
    // clicking a hole removes it
    if (k >= 0) { P.pts.splice(k, 1); A.hoverHole = -1; message('Hole removed'); }
    else {
      const sp = sketchPointAtCursor(), fh = sp ? null : faceAtCursor();
      if (sp) { P.pts.push(sp.ref); message('Hole placed on a sketch point (it follows that point)', 'ok'); }
      else if (fh && fh.face.planar) {
        const p: Vec3 = [fh.point.x, fh.point.y, fh.point.z];
        P.pts.push({ kind: 'face', bodyId: fh.bodyId, surf: fh.face.surf, n: fh.face.n, w: vdot(fh.face.n, p), p });
        message('Hole placed. Click more spots to add holes, drag one to move it, or type the diameter.', 'ok');
      } else { message(fh ? 'Holes go on flat faces' : 'Click a flat face or a sketch point', 'warn'); focusPrimary(); return; }
    }
    showHoverPoint(null); setHoverFace(null);
    updateChips(); updatePreview(); focusPrimary();
  },
  // drag a marker to slide its hole anywhere on the same face
  dragStart: (A: Dlg) => { const k = markerAt(A); return k >= 0 ? { k } : null; },
  dragMove: (A: Dlg, d: { k: number }) => {
    const r = A.params.pts[d.k];
    if (!r || r.kind !== 'face') return;
    const fh = faceAtCursor();
    if (!fh || !fh.face.planar || fh.bodyId !== r.bodyId || vdot(fh.face.n, vnorm(r.n)) < 0.9999) return;
    const p: Vec3 = [fh.point.x, fh.point.y, fh.point.z], pl = placement(r);
    if (!pl || Math.abs(vdot(vnorm(r.n), vsub(p, pl.c))) > 1e-3) return; // stays on its own face
    r.p = vadd(p, vsc(vnorm(r.n), r.w - vdot(vnorm(r.n), p)));
    A.hoverHole = d.k;
    drawMarkers(A);
  },
  dragEnd: (A: Dlg, d: { k: number }) => {
    const r = A.params.pts[d.k];
    if (r && r.kind !== 'face') message('That hole sits on a sketch point, so it moves with the sketch', 'warn');
    else message('Hole moved. Drag again to adjust, or click it to remove it.', 'ok');
    updatePreview(); focusPrimary();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'sketch') return false;
    const s = feats('sketch').find((x) => x.id === id), P = A.params;
    if (!s) return false;
    // a sketch's circle centers are where its holes go; with no circles, its points
    let pts = s.curves.filter((c) => c.type === 'circle' && !c.construction).map((c) => (c as { c: string }).c);
    const circles = pts.length > 0;
    if (!pts.length) pts = Object.keys(s.pts).filter((pid) => pid !== 'O' && !s.curves.some((c: any) => c.construction && (c.p1 === pid || c.p2 === pid || c.c === pid)));
    pts = [...new Set(pts)].filter((pid) => !P.pts.some((r) => r.kind === 'spt' && r.sketchId === id && r.pointId === pid));
    if (!pts.length) { message(`${s.name} has no points to put holes on`, 'warn'); return true; }
    pts.forEach((pid) => P.pts.push({ kind: 'spt', sketchId: id, pointId: pid }));
    updateChips(); updatePreview(); focusPrimary();
    message(`${pts.length} hole${pts.length > 1 ? 's' : ''} placed on ${s.name}${circles ? "'s circle centers" : ''}`, 'ok');
    return true;
  },
  onClose: () => { drawMarkers(null); showHoverPoint(null); setHoverFace(null); },
  commit: (A: Dlg, P) => {
    if (!P.pts.length) { message('Place the hole: click a flat face or a sketch point', 'warn'); return false; }
    if (!(P.d > 0)) { message('Give the hole a diameter', 'warn'); focusPrimary(); return false; }
    if (P.extent === 'Distance' && !(P.depth > 0)) { message('Give the hole a depth, or choose Through all', 'warn'); return false; }
    if (P.type === 'Counterbore' && (!(P.cbD > P.d) || !(P.cbDepth > 0))) { message('Counterbore needs a larger diameter than the hole, and a depth', 'warn'); return false; }
    if (P.type === 'Countersink' && !(P.csD > P.d)) { message('Countersink needs a larger diameter than the hole', 'warn'); return false; }
    let f = A.edit as OtherFeature | null;
    if (f) f.params = P as unknown as Record<string, unknown>;
    else { const n = ++state.counters.hole; f = { id: 'h' + n, type: 'hole', name: 'Hole' + n, params: P as unknown as Record<string, unknown> }; state.features.push(f); }
    state.selection = [];
    markDirty();
    const feat = f;
    message(`${feat.name}: ${P.pts.length} × Ø${fmt(P.d)} mm ${P.type.toLowerCase()} ${P.extent === 'Through all' ? 'through all' : fmt(P.depth) + ' mm deep'}`, 'ok');
    setTimeout(() => void whenBuilt().then(() => { if (feat.error) { message(`${feat.name} needs attention: ${feat.note}`, 'warn'); emit('doc'); } }), 0);
    return true;
  },
});

