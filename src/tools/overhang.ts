// Overhang check (OV): paints the parts of the model that hang over empty space and would need
// support when printed. A view, not a feature: nothing is added to the History.
// Red = a flat ceiling, yellow = just past the limit. The limit is the printer's overhang angle.
import * as THREE from 'three';
import { baseBodies } from '../app/solids';
import { state } from '../app/state';
import { cssv } from '../core/dom';
import { fmt } from '../core/format';
import { vsc } from '../model/frames';
import { analyzeOverhang } from '../model/overhang';
import type { Vec3 } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace } from '../view/bodies';
import { faceAtCursor } from '../view/hit';
import { hideInThumbnails, scene } from '../view/scene';
import { focusPrimary, registerTool, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';

interface OverhangParams { angle: number; /** The outward direction of the face that sits on the build plate, if one was chosen. */ bed: Vec3 | null }
type Dlg = ActiveDialog<OverhangParams> & { picking?: boolean };

const overlay = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
);
overlay.renderOrder = 7;
overlay.visible = false;
scene.add(overlay);
hideInThumbnails(overlay);

const upOf = (P: OverhangParams): Vec3 => (P.bed ? vsc(P.bed, -1) : [0, 0, 1]);

/** Paint the overhangs and say how much there is. */
function show(A: Dlg | null): void {
  overlay.geometry.dispose();
  if (!A) { overlay.visible = false; return; }
  const meshes = baseBodies().filter((b) => state.bodies.find((x) => x.id === b.id)?.visible !== false).map((b) => b.mesh);
  const o = analyzeOverhang(meshes, upOf(A.params), A.params.angle);
  const g = new THREE.BufferGeometry(), col: number[] = [], yellow = new THREE.Color('#F2C14E'), red = new THREE.Color(cssv('--cut') || '#D4453B');
  o.severity.forEach((s) => { const c = yellow.clone().lerp(red, s); for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b); });
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.tris, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  overlay.geometry = g;
  overlay.visible = o.tris.length > 0;
  const pct = o.total > 0 ? (100 * o.area) / o.total : 0;
  setHint('h-angle', !meshes.length ? 'Make a body first' : o.area < 0.01 ? 'Nothing needs support at this angle' : `${fmt(Math.round(o.area * 10) / 10)} mm² need support (${fmt(Math.round(pct * 10) / 10)} % of the surface)`);
}

function pickBed(): void {
  const A = state.active as Dlg | null;
  if (!A) return;
  A.picking = true;
  updateChips();
  message('Click the flat face that sits on the print bed (click it again to go back to the model\'s own bottom)');
}

registerTool<OverhangParams>({
  type: 'overhang',
  title: 'Overhang check',
  icon: 'overhang',
  gc: 'g-print',
  prompt: 'Set the printer\'s overhang angle: red parts need support',
  noFeature: true,
  fields: [
    { key: 'angle', kind: 'length', label: 'Overhang angle (from vertical)', unit: '°', primary: true },
    { key: 'bed', kind: 'chip', label: 'Face on the print bed', chipId: 'bedChip', act: 'pickBed', note: 'Most printers manage 45°. A flat ceiling is 90°. Pick a different bottom face to test another way of laying the part down.' },
  ],
  defaults: () => ({ angle: 45, bed: null }),
  chips: (A: Dlg) => ({ bedChip: { picking: !!A.picking, set: !!A.params.bed, text: A.picking ? 'Click a flat face…' : A.params.bed ? 'A chosen face' : 'The model\'s own bottom (Z = 0)' } }),
  onAct: () => pickBed(),
  onEscape: (A: Dlg) => { if (A.picking) { A.picking = false; updateChips(); focusPrimary(); return true; } return false; },
  preview: (A: Dlg) => { show(A); return { ok: true }; },
  onBuilt: (A: Dlg) => show(A),
  hover: (A: Dlg) => {
    if (!A.picking) return false;
    const fh = faceAtCursor();
    if (fh && fh.face.planar) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return false;
  },
  click: (A: Dlg) => {
    if (!A.picking) { focusPrimary(); return; }
    const fh = faceAtCursor();
    if (!fh) return;
    if (!fh.face.planar) { message('Pick a flat face', 'warn'); return; }
    const same = A.params.bed && A.params.bed.every((v, i) => Math.abs(v - fh.face.n[i]) < 1e-6);
    A.params.bed = same ? null : fh.face.n;
    A.picking = false;
    setHoverFace(null);
    updateChips(); updatePreview(); focusPrimary();
  },
  onClose: () => { show(null); setHoverFace(null); },
  commit: () => { message('Overhang check closed', 'ok'); return true; },
});
