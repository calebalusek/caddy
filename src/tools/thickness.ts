// Wall-thickness check (WT): paints the parts of the model whose wall is thinner than the limit you type.
// A view, not a feature: nothing is added to the History. Red = much too thin, yellow = just under the limit.
import * as THREE from 'three';
import { fmtArea, fmtU } from '../core/units';
import { baseBodies } from '../app/solids';
import { state } from '../app/state';
import { cssv } from '../core/dom';
import { fmt } from '../core/format';
import { analyzeThickness } from '../model/thickness';
import { hideInThumbnails, scene } from '../view/scene';
import { registerTool, setHint, type ActiveDialog } from './dialog';

interface ThicknessParams { min: number }
type Dlg = ActiveDialog<ThicknessParams>;

const overlay = new THREE.Mesh(
  new THREE.BufferGeometry(),
  new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.88, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
);
overlay.renderOrder = 7;
overlay.visible = false;
scene.add(overlay);
hideInThumbnails(overlay);

/** Paint the thin walls and say what the thinnest one is. */
function show(A: Dlg | null): void {
  overlay.geometry.dispose();
  if (!A) { overlay.visible = false; return; }
  const meshes = baseBodies().filter((b) => state.bodies.find((x) => x.id === b.id)?.visible !== false).map((b) => b.mesh);
  const t = analyzeThickness(meshes, A.params.min);
  const g = new THREE.BufferGeometry(), col: number[] = [], yellow = new THREE.Color('#F2C14E'), red = new THREE.Color(cssv('--cut') || '#D4453B');
  t.severity.forEach((s) => { const c = yellow.clone().lerp(red, s); for (let k = 0; k < 3; k++) col.push(c.r, c.g, c.b); });
  g.setAttribute('position', new THREE.Float32BufferAttribute(t.tris, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  overlay.geometry = g;
  overlay.visible = t.tris.length > 0;
  const thin = isFinite(t.thinnest) ? `Thinnest wall: ${fmtU(Math.round(t.thinnest * 100) / 100)}. ` : '';
  const pct = t.total > 0 ? (100 * t.area) / t.total : 0;
  setHint('h-min', !meshes.length ? 'Make a body first' : !(A.params.min > 0) ? thin + 'Type the thinnest wall your printer handles (about 1.2 mm is typical) to see where it is too thin.' : t.area < 0.01 ? thin + 'No wall is thinner than that.' : `${thin}${fmtArea(t.area)} too thin (${fmt(Math.round(pct * 10) / 10)} % of the surface).`);
}

registerTool<ThicknessParams>({
  type: 'thickness',
  title: 'Wall thickness check',
  icon: 'thickness',
  gc: 'g-print',
  prompt: 'Type the thinnest wall you want: red parts are thinner',
  noFeature: true,
  fields: [{ key: 'min', kind: 'length', label: 'Thinnest wall allowed', primary: true }],
  defaults: () => ({ min: 0 }),
  preview: (A: Dlg) => { show(A); return { ok: true }; },
  onBuilt: (A: Dlg) => show(A),
  onClose: () => show(null),
  commit: () => { return true; },
});
