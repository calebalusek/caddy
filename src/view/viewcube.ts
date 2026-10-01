// ViewCube: click a face, edge or corner to look from there; drag to orbit.
import * as THREE from 'three';
import { $ } from '../core/dom';
import { icon } from '../core/icons';
import { message } from '../ui/message';
import { afterFrame, cam, camera, V3 } from './scene';
import { goHome, setViewDir, stopAnimation } from './views';

const VC_NAMES: Record<string, string> = { '0,0,1': 'Top', '0,0,-1': 'Bottom', '0,-1,0': 'Front', '0,1,0': 'Back', '1,0,0': 'Right', '-1,0,0': 'Left' };
type Region = [number, number, number];

export function initViewCube(): void {
  const vcCanvas = $<HTMLCanvasElement>('#vcCanvas');
  const vcR = new THREE.WebGLRenderer({ canvas: vcCanvas, antialias: true, alpha: true });
  vcR.outputColorSpace = THREE.LinearSRGBColorSpace;
  vcR.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  vcR.setSize(112, 112, false);
  const vcScene = new THREE.Scene();
  const vcCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  vcCam.up.set(0, 0, 1);

  const faces: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[] = [];
  const defs: [string, Region, Region][] = [
    ['TOP', [0, 0, 1], [0, 1, 0]], ['BOTTOM', [0, 0, -1], [0, -1, 0]], ['FRONT', [0, -1, 0], [0, 0, 1]],
    ['BACK', [0, 1, 0], [0, 0, 1]], ['RIGHT', [1, 0, 0], [0, 0, 1]], ['LEFT', [-1, 0, 0], [0, 0, 1]],
  ];
  const paintFaces = (): void => {
    defs.forEach(([label], i) => {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const g = c.getContext('2d')!;
      g.fillStyle = '#E8ECF0'; g.fillRect(0, 0, 256, 256);
      g.strokeStyle = '#A6AFB8'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 250);
      g.fillStyle = '#39424C';
      g.font = `600 ${label.length > 5 ? 42 : 50}px Barlow, "Segoe UI", sans-serif`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, 128, 132);
      const tex = new THREE.CanvasTexture(c);
      tex.anisotropy = 4;
      faces[i].material.map?.dispose();
      faces[i].material.map = tex;
      faces[i].material.needsUpdate = true;
    });
  };
  defs.forEach(([, n, up]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial());
    const N = new V3(...n), U = new V3(...up), R = new V3().crossVectors(U, N);
    m.matrixAutoUpdate = false;
    m.matrix.makeBasis(R, U, N).setPosition(N.clone().multiplyScalar(0.5));
    m.updateMatrixWorld(true);
    vcScene.add(m);
    faces.push(m);
  });
  paintFaces();
  // The labels use Barlow; repaint once the font has loaded so they never fall back.
  void document.fonts.load('600 50px Barlow').then(paintFaces);

  vcScene.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.001, 1.001, 1.001)), new THREE.LineBasicMaterial({ color: 0x7a858f })));
  ([[0xd1495b, [1, 0, 0]], [0x3e9e5f, [0, 1, 0]], [0x3f7fe0, [0, 0, 1]]] as [number, Region][]).forEach(([col, d]) => {
    const o = new V3(-0.62, -0.62, -0.62);
    vcScene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([o, o.clone().addScaledVector(new V3(...d), 0.75)]), new THREE.LineBasicMaterial({ color: col })));
  });

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let hover: Region | null = null;
  let ptr: { x: number; y: number; moved: boolean } | null = null;

  function region(e: PointerEvent): Region | null {
    const r = vcCanvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, vcCam);
    const h = ray.intersectObjects(faces, false)[0];
    if (!h) return null;
    const p = h.point, t = 0.5 - 0.19;
    const v = [p.x, p.y, p.z].map((x) => (Math.abs(x) > t ? Math.sign(x) : 0)) as Region;
    return v.some((x) => x) ? v : null;
  }
  function highlight(v: Region | null): void {
    faces.forEach((m) => {
      const n = new V3().setFromMatrixColumn(m.matrix, 2);
      const lit = !!v && ((v[0] && Math.round(n.x) === v[0]) || (v[1] && Math.round(n.y) === v[1]) || (v[2] && Math.round(n.z) === v[2]));
      m.material.color.set(lit ? 0xa9d2ff : 0xffffff);
    });
    vcCanvas.style.cursor = v ? 'pointer' : 'grab';
    vcCanvas.title = v ? (VC_NAMES[v.join(',')] || 'Corner/edge view') + ' view' : 'Click a face, edge or corner. Drag to orbit.';
  }

  vcCanvas.addEventListener('pointermove', (e) => {
    if (ptr) {
      const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
      if (!ptr.moved && Math.hypot(dx, dy) < 3) return;
      ptr.moved = true; ptr.x = e.clientX; ptr.y = e.clientY;
      stopAnimation();
      cam.theta -= dx * 0.012;
      cam.phi = Math.min(Math.PI - 0.001, Math.max(0.001, cam.phi - dy * 0.012));
      return;
    }
    const v = region(e);
    if (String(v) !== String(hover)) { hover = v; highlight(v); }
  });
  vcCanvas.addEventListener('pointerleave', () => { if (!ptr) { hover = null; highlight(null); } });
  vcCanvas.addEventListener('pointerdown', (e) => {
    ptr = { x: e.clientX, y: e.clientY, moved: false };
    vcCanvas.setPointerCapture(e.pointerId);
    vcCanvas.style.cursor = 'grabbing';
  });
  vcCanvas.addEventListener('pointerup', (e) => {
    const p = ptr;
    ptr = null;
    if (!p) return;
    highlight(hover);
    if (p.moved) return;
    const v = region(e);
    if (!v) return;
    setViewDir(new V3(...v));
    message((VC_NAMES[v.join(',')] || 'Angled') + ' view');
  });

  $('#vcHome').innerHTML = icon('home');
  $('#vcHome').addEventListener('click', goHome);

  const dir = new V3();
  afterFrame(() => {
    dir.copy(camera.position).sub(cam.target).normalize();
    vcCam.position.copy(dir).multiplyScalar(3);
    vcCam.up.set(0, 0, 1);
    vcCam.lookAt(0, 0, 0);
    vcR.render(vcScene, vcCam);
  });
}
