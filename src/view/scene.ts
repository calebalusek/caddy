// The 3D viewport: renderer, camera, lights, grid, origin and shared materials.
import * as THREE from 'three';
import { $, cssv } from '../core/dom';
import { on } from '../app/hub';
import { state } from '../app/state';

// The Design view was tuned in the prototype on three.js r128, which lit and output colors without
// color-space conversion. Keeping that pipeline here reproduces the approved look exactly.
THREE.ColorManagement.enabled = false;
/** r128 light intensities → current three.js units. */
const LEGACY = Math.PI;

export const V3 = THREE.Vector3;
export type V3 = THREE.Vector3;
export const ZAX = new V3(0, 0, 1);

export const vp = $('#viewport');
export const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
vp.prepend(renderer.domElement);
export const canvas = renderer.domElement;
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(38, 1, 0.5, 6000);
camera.up.set(0, 0, 1);

/** Orbit camera: looks at target from distance r, angle theta around Z and phi down from +Z. */
export const cam = { target: new V3(15, 10, 8), r: 230, theta: -1.0, phi: 1.02 };
export function updateCamera(): void {
  const { r, theta, phi, target } = cam;
  camera.position.set(target.x + r * Math.sin(phi) * Math.cos(theta), target.y + r * Math.sin(phi) * Math.sin(theta), target.z + r * Math.cos(phi));
  camera.lookAt(target);
}

// Design-view lighting: even ambient + sky/ground, a headlight that follows the camera, a small fixed fill.
const hemi = new THREE.HemisphereLight(0xffffff, 0x8a8782, 0.3 * LEGACY);
hemi.position.set(0, 0, 1);
scene.add(hemi);
scene.add(new THREE.AmbientLight(0xffffff, 0.42 * LEGACY));
export const keyLight = new THREE.DirectionalLight(0xffffff, 0.5 * LEGACY);
scene.add(keyLight, keyLight.target);
const fill = new THREE.DirectionalLight(0xffffff, 0.12 * LEGACY);
fill.position.set(-160, 120, 60);
scene.add(fill);

function gridGeo(step: number, extent: number, skip: number): THREE.BufferGeometry {
  const p: number[] = [];
  for (let v = -extent; v <= extent + 1e-6; v += step) {
    if (skip && Math.abs(v % skip) < 1e-6) continue;
    if (Math.abs(v) < 1e-6) continue;
    p.push(-extent, v, 0, extent, v, 0, v, -extent, 0, v, extent, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}
export const gridGroup = new THREE.Group();
gridGroup.position.z = -0.06;
const gridMinorMat = new THREE.LineBasicMaterial(), gridMajorMat = new THREE.LineBasicMaterial();
gridGroup.add(new THREE.LineSegments(gridGeo(10, 150, 50), gridMinorMat));
gridGroup.add(new THREE.LineSegments(gridGeo(50, 150, 0), gridMajorMat));
scene.add(gridGroup);

export const originGroup = new THREE.Group();
scene.add(originGroup);
function axisLine(a: V3, b: V3, color: number): THREE.Line {
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color }));
  l.renderOrder = 4;
  return l;
}
originGroup.add(axisLine(new V3(-150, 0, 0.02), new V3(150, 0, 0.02), 0xd1495b));
originGroup.add(axisLine(new V3(0, -150, 0.02), new V3(0, 150, 0.02), 0x3e9e5f));
originGroup.add(axisLine(new V3(0, 0, 0), new V3(0, 0, 70), 0x3f7fe0));
{
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.beginPath(); g.arc(32, 32, 21, 0, Math.PI * 2); g.fillStyle = '#ffffff'; g.fill(); g.lineWidth = 7; g.strokeStyle = '#3a4048'; g.stroke();
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, sizeAttenuation: false, transparent: true }));
  spr.scale.set(0.028, 0.028, 1);
  spr.renderOrder = 11;
  originGroup.add(spr);
}

// Shared materials (never disposed with the objects that use them).
const sharedSet = new WeakSet<THREE.Material>();
const S = <T extends THREE.Material>(m: T): T => { sharedSet.add(m); return m; };
export const planeEdgeMat = S(new THREE.LineBasicMaterial());
export const bodyMat = S(new THREE.MeshStandardMaterial({ roughness: 0.68, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
export const edgeMat = S(new THREE.LineBasicMaterial({ toneMapped: false }));
export const previewMat = S(new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.5, depthWrite: false, roughness: 0.5, side: THREE.DoubleSide }));
export const previewEdgeMat = S(new THREE.LineBasicMaterial({ transparent: true }));
export const arrowMat = S(new THREE.MeshBasicMaterial({ depthTest: false, transparent: true, opacity: 0.92 }));

export function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    mats.forEach((mat) => { if (!sharedSet.has(mat)) mat.dispose(); });
  });
}

// Live preview of the tool being used (translucent orange, red for cuts).
export const previewGroup = new THREE.Group();
previewGroup.visible = false;
scene.add(previewGroup);
export const previewMesh = new THREE.Mesh(new THREE.BufferGeometry(), previewMat);
export const previewEdges = new THREE.LineSegments(new THREE.BufferGeometry(), previewEdgeMat);
previewMesh.renderOrder = previewEdges.renderOrder = 3;
previewGroup.add(previewMesh, previewEdges);

export function applySceneTheme(): void {
  scene.background = new THREE.Color(cssv('--vp-bg'));
  gridMinorMat.color.set(cssv('--grid-minor'));
  gridMajorMat.color.set(cssv('--grid-major'));
  bodyMat.color.set(cssv('--body'));
  edgeMat.color.set(cssv('--edge'));
  planeEdgeMat.color.set(cssv('--plane'));
  previewMat.color.set(cssv('--accent-fill'));
  previewEdgeMat.color.set(cssv('--accent-fill'));
  arrowMat.color.set(cssv('--accent-fill'));
}
on('theme', applySceneTheme);

export function applyGridVisibility(): void {
  gridGroup.visible = state.gridOn && state.viewMode !== 'render';
}

function resize(): void {
  const w = vp.clientWidth, h = vp.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(vp);

const frameHooks: Array<(now: number) => void> = [];
const afterHooks: Array<() => void> = [];
/** Run before each frame is drawn (camera animation, screen-space overlays). */
export const onFrame = (fn: (now: number) => void): void => { frameHooks.push(fn); };
/** Run after each frame is drawn (ViewCube, thumbnails). */
export const afterFrame = (fn: () => void): void => { afterHooks.push(fn); };

const up = new V3(), right = new V3();
function frame(now: number): void {
  requestAnimationFrame(frame);
  frameHooks.forEach((fn) => fn(now));
  updateCamera();
  camera.updateMatrixWorld();
  const r = camera.position.distanceTo(cam.target);
  up.setFromMatrixColumn(camera.matrixWorld, 1);
  right.setFromMatrixColumn(camera.matrixWorld, 0);
  keyLight.position.copy(camera.position).addScaledVector(up, r * 0.55).addScaledVector(right, -r * 0.35);
  keyLight.target.position.copy(cam.target);
  keyLight.target.updateMatrixWorld();
  renderer.render(scene, camera);
  afterHooks.forEach((fn) => fn());
}

export function startScene(): void {
  applySceneTheme();
  resize();
  updateCamera();
  requestAnimationFrame(frame);
}
