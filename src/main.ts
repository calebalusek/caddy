// Step 0: prove the pipeline end to end — kernel in a worker → tessellated B-rep → three.js.
// The real app shell replaces this page in step 1.
import '@fontsource/barlow/400.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import './style.css';
import * as THREE from 'three';
import { Kernel } from './kernel/client';
import type { BodyMesh } from './kernel/protocol';

const dark = matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
const COLORS = dark
  ? { bg: 0x343a41, body: 0xa3a9b0, edge: 0x0a0c0f }
  : { bg: 0xd8dde2, body: 0x66625a, edge: 0x141414 };

const canvas = document.querySelector<HTMLCanvasElement>('#viewport')!;
const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const loadingEl = document.querySelector<HTMLDivElement>('#loading')!;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(COLORS.bg);
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
camera.up.set(0, 0, 1);

// Design-view lighting (SPEC §2): even ambient + sky/ground + a headlight that follows the camera.
scene.add(new THREE.AmbientLight(0xffffff, 0.42 * Math.PI));
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8478, 0.3 * Math.PI));
const headlight = new THREE.DirectionalLight(0xffffff, 0.5 * Math.PI);
scene.add(headlight);

function bodyObject(m: BodyMesh): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(m.positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(m.normals, 3));
  geo.setIndex(new THREE.BufferAttribute(m.indices, 1));
  const mat = new THREE.MeshStandardMaterial({ color: COLORS.body, roughness: 0.68, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  g.add(new THREE.Mesh(geo, mat));
  const egeo = new THREE.BufferGeometry();
  egeo.setAttribute('position', new THREE.BufferAttribute(m.edgeLines, 3));
  g.add(new THREE.LineSegments(egeo, new THREE.LineBasicMaterial({ color: COLORS.edge })));
  return g;
}

function render(): void {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  headlight.position.copy(camera.position).add(new THREE.Vector3(-0.3, 0, 0.4).multiplyScalar(camera.position.length()));
  renderer.render(scene, camera);
}
addEventListener('resize', render);

async function start(): Promise<void> {
  const kernel = new Kernel();
  const t0 = performance.now();
  try {
    await kernel.call('ping');
    const mesh = await kernel.call('testBox', 40, 30, 20);
    scene.add(bodyObject(mesh));
    camera.position.set(95, -75, 70);
    camera.lookAt(20, 15, 10);
    render();
    statusEl.textContent = `Geometry engine ready in ${((performance.now() - t0) / 1000).toFixed(1)} s · test box 40 × 30 × 20 · volume ${mesh.volume.toFixed(1)} mm³`;
    statusEl.dataset.volume = String(mesh.volume);
  } catch (err) {
    statusEl.classList.add('warn');
    statusEl.textContent = `The geometry engine could not start: ${err instanceof Error ? err.message : err}`;
  }
  loadingEl.classList.add('done');
}
void start();
