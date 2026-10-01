// The Render view (RV): studio lighting, soft shadows, a floor, and each body made of a real-looking
// material. Design view stays the matte working view. Also the Materials panel (AP).
import * as THREE from 'three';
import { emit, on } from '../app/hub';
import { markDirty } from '../app/regenerate';
import { bodyById, state } from '../app/state';
import { $, esc } from '../core/dom';
import { finishSketch } from '../sketch/session';
import { syncSketchVisibility } from '../sketch/visuals';
import { cancelDialog } from '../tools/dialog';
import { message } from '../ui/message';
import { makeMovable, placePanel } from '../ui/panel';
import { allBodyVis, setRenderMaterialProvider } from './bodies';
import { faceAtCursor } from './hit';
import { DEFAULT_LOOK, FILAMENT_COLORS, MAT_LIB, cleanLook, makeMaterial, matDef, swatchStyle, type Look } from './materials';
import { ambient, applyGridVisibility, applySceneTheme, fill, ground, hemi, keyLight, renderer, scene, sun, V3 } from './scene';

const LEGACY = Math.PI;

// ---- the studio: a dark room with softboxes and strip lights, so metals and gloss have something to reflect ----
let envTex: THREE.Texture | null = null;
function getEnv(): THREE.Texture {
  if (envTex) return envTex;
  const pm = new THREE.PMREMGenerator(renderer), sc = new THREE.Scene();
  sc.add(new THREE.Mesh(new THREE.BoxGeometry(40, 40, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.21, 0.23), side: THREE.BackSide })));
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.08, 0.08, 0.085) }));
  floor.position.z = -19.5;
  sc.add(floor);
  const panel = (w: number, h: number, pos: [number, number, number], k: number, tint?: [number, number, number]): void => {
    const c = new THREE.Color(k, k, k);
    if (tint) c.multiply(new THREE.Color(...tint));
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(0, 0, 0);
    sc.add(m);
  };
  panel(20, 20, [0, 0, 19.5], 9); // big overhead softbox
  panel(3, 34, [-19.5, -8, 4], 14, [1, 0.97, 0.92]); // warm strip, front-left
  panel(3, 34, [19.5, -6, 4], 12, [0.92, 0.96, 1]); // cool strip, front-right
  panel(30, 3, [0, 19.5, 12], 10); // rim strip behind
  panel(14, 10, [-10, -19.5, 8], 5); // key panel in front
  panel(24, 2.5, [0, -19.5, -2], 6); // low front kicker for the bottom edges
  envTex = pm.fromScene(sc, 0.02).texture;
  pm.dispose();
  sc.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose(); if (m.material) (m.material as THREE.Material).dispose(); });
  return envTex;
}

// ---- one material per body, rebuilt only when its look changes ----
const mats = new Map<string, { key: string; mat: THREE.Material }>();
const lookOf = (id: string): Look => { const b = bodyById(id); return b && b.appearance ? cleanLook(b.appearance) : DEFAULT_LOOK; };
setRenderMaterialProvider((id) => {
  const look = lookOf(id), key = JSON.stringify(look), c = mats.get(id);
  if (c && c.key === key) return c.mat;
  if (c) c.mat.dispose();
  const mat = makeMaterial(look);
  mats.set(id, { key, mat });
  return mat;
});

/** The floor and the sun's shadow window follow the model. */
function fitRenderStage(): void {
  const box = new THREE.Box3();
  allBodyVis().forEach((v) => { if (v.group.visible) box.union(v.box); });
  if (box.isEmpty() || state.viewMode !== 'render') { ground.visible = false; return; }
  const c = box.getCenter(new V3()), s = box.getSize(new V3()), R = Math.max(s.x, s.y, s.z) * 0.75 + 10;
  ground.position.set(c.x, c.y, box.min.z - 0.02);
  ground.scale.set(R * 8, R * 8, 1);
  ground.visible = true;
  sun.position.set(c.x + R * 1.1, c.y - R * 1.5, c.z + R * 2.6);
  sun.target.position.copy(c);
  sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera;
  sc.left = -R * 1.7; sc.right = R * 1.7; sc.top = R * 1.7; sc.bottom = -R * 1.7; sc.near = 0.1; sc.far = R * 9;
  sc.updateProjectionMatrix();
}

export function setViewMode(m: 'design' | 'render', quiet = false): void {
  if (m === 'render' && state.mode === 'sketch') { message('Finish the sketch (fs) to see the render view', 'warn'); return; }
  const R = m === 'render';
  if (state.viewMode !== m) {
    state.viewMode = m;
    renderer.toneMapping = R ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = R ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace;
    scene.environment = R ? getEnv() : null;
    scene.environmentIntensity = 0.32; // r128's reflections were weaker than today's, so the prototype's look needs less
    hemi.intensity = (R ? 0.06 : 0.3) * LEGACY;
    sun.intensity = (R ? 0.7 : 0) * LEGACY;
    sun.castShadow = R;
    fill.intensity = (R ? 0.2 : 0.12) * LEGACY;
    keyLight.visible = !R;
    ambient.visible = !R;
    applyGridVisibility();
    applySceneTheme();
    scene.traverse((o) => { const mm = (o as THREE.Mesh).material; if (mm) ([] as THREE.Material[]).concat(mm).forEach((x) => { x.needsUpdate = true; }); });
    emit('view', 'select');
    fitRenderStage();
    if (!quiet) message(R ? 'Render view: realistic materials and lighting. Open Materials to change what each body is made of.' : 'Design view: matte, with every edge shown');
  }
  if (!R) closeMatPanel();
  updateModeBar();
}

// ---- the mode switch at the top ----
function updateModeBar(): void {
  const bar = $('#rmode');
  bar.classList.toggle('render', state.viewMode === 'render');
  bar.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.m === state.viewMode)));
  const eb = bar.querySelector('[data-r="edges"]'), mb = bar.querySelector('[data-r="mat"]');
  if (eb) eb.setAttribute('aria-pressed', String(state.renderEdges));
  if (mb) mb.setAttribute('aria-pressed', String(matPanelOpen));
}

// ---- the Materials panel ----
let matPanelOpen = false, matTarget: string | 'all' | null = null;
const matPanel = $('#matPanel');
const targetBodies = (): { id: string; name: string; appearance?: unknown }[] => (matTarget === 'all' ? state.bodies.slice() : state.bodies.filter((b) => b.id === matTarget));
export const materialsOpen = (): boolean => matPanelOpen;

function renderMatPanel(): void {
  const tb = targetBodies(), cur = tb.length && tb[0].appearance ? cleanLook(tb[0].appearance) : DEFAULT_LOOK, def = matDef(cur.id);
  $('#mpTarget').innerHTML = tb.length ? `<span class="dot"></span>${matTarget === 'all' ? 'All bodies' : esc(tb[0].name)}` : 'Click a body in the view';
  $('#mpTarget').className = 'selchip' + (tb.length ? ' set' : '');
  const groups = ['Plastic', 'Metal', 'Wood', 'Other'] as const;
  $('#mpBody').innerHTML = groups.map((g) => `<div class="mp-group"><h3>${g}</h3><div class="mp-grid">${MAT_LIB.filter((m) => m.group === g).map((m) => {
    const on = tb.length > 0 && m.id === cur.id;
    return `<button class="mp-sw${on ? ' on' : ''}" data-mat="${m.id}" aria-pressed="${on}" title="${esc(m.name)}"><span class="sw" style="${swatchStyle(m, m.tint && cur.id === m.id ? cur.color || null : null)}"></span><span class="mp-name">${esc(m.name)}</span></button>`;
  }).join('')}</div>${g === 'Plastic' ? `<div class="mp-colors" aria-label="Filament color">${FILAMENT_COLORS.map(([c, n]) => `<button class="mp-col${def.tint && cur.color && cur.color.toLowerCase() === c.toLowerCase() ? ' on' : ''}" data-col="${c}" title="${n}" aria-label="${n}" style="background:${c}"></button>`).join('')}<label class="mp-col custom" title="Custom color"><input type="color" id="mpCustom" value="${def.tint && cur.color ? cur.color : def.color}" aria-label="Custom color"></label></div>` : ''}</div>`).join('');
}

function applyLook(look: Look): void {
  const tb = targetBodies();
  if (!tb.length) { message('Click a body in the view to choose what to paint', 'warn'); return; }
  tb.forEach((b) => { const real = bodyById(b.id); if (real) real.appearance = { ...look }; });
  emit('view');
  markDirty();
  renderMatPanel();
  message(`${matTarget === 'all' ? 'All bodies' : tb[0].name}: ${matDef(look.id).name}`, 'ok');
}

export function openMatPanel(): void {
  if (state.mode === 'sketch') finishSketch(true);
  if (state.active) cancelDialog(true);
  if (!state.bodies.length) { message('Make a body first (sketch, then extrude). Then you can pick its material.'); return; }
  const sel = state.selection.find((s) => s.kind === 'face' || s.kind === 'edge') as { bodyId: string } | undefined;
  setViewMode('render', true);
  if (sel) matTarget = sel.bodyId;
  if (!matTarget || (matTarget !== 'all' && !bodyById(matTarget))) matTarget = state.bodies[0].id;
  matPanelOpen = true;
  matPanel.hidden = false;
  renderMatPanel();
  updateModeBar();
  placePanel(matPanel);
  message('Pick a material. Click a body in the view to choose which one gets it.');
}
export function closeMatPanel(): void {
  if (!matPanelOpen) return;
  matPanelOpen = false;
  matPanel.hidden = true;
  updateModeBar();
}

/** A click in the viewport while the panel is open chooses which body gets the material. */
export function materialsPick(): boolean {
  if (!matPanelOpen) return false;
  const fh = faceAtCursor();
  if (!fh) return false;
  matTarget = fh.bodyId;
  renderMatPanel();
  message(`${bodyById(fh.bodyId)?.name || 'Body'} selected. Pick a material for it.`);
  return true;
}

export function initRender(): void {
  makeMovable(matPanel);
  $('#rmode').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.m) setViewMode(b.dataset.m as 'design' | 'render');
    else if (b.dataset.r === 'edges') { state.renderEdges = !state.renderEdges; emit('view'); updateModeBar(); message(state.renderEdges ? 'Edges shown' : 'Edges hidden'); }
    else if (b.dataset.r === 'mat') { if (matPanelOpen) closeMatPanel(); else openMatPanel(); }
  });
  matPanel.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button');
    if (!b) return;
    if (b.dataset.mp === 'close') { closeMatPanel(); return; }
    if (b.dataset.mp === 'all') { matTarget = 'all'; renderMatPanel(); return; }
    const tb = targetBodies(), cur = tb.length && tb[0].appearance ? cleanLook(tb[0].appearance) : DEFAULT_LOOK;
    if (b.dataset.mat) {
      const def = matDef(b.dataset.mat);
      applyLook({ id: def.id, ...(def.tint ? { color: matDef(cur.id).tint && cur.color ? cur.color : def.color } : {}) });
    } else if (b.dataset.col) applyLook({ id: matDef(cur.id).tint ? cur.id : 'pla', color: b.dataset.col });
  });
  matPanel.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id !== 'mpCustom') return;
    const tb = targetBodies(), cur = tb.length && tb[0].appearance ? cleanLook(tb[0].appearance) : DEFAULT_LOOK;
    applyLook({ id: matDef(cur.id).tint ? cur.id : 'pla', color: t.value });
  });
  matPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMatPanel(); } });
  // the floor follows the model; sketching is a Design-view job
  on('view', syncSketchVisibility);
  on('built', fitRenderStage);
  on('view', fitRenderStage);
  on('mode', () => {
    $('#rmode').hidden = state.mode === 'sketch';
    if (state.mode === 'sketch') { closeMatPanel(); if (state.viewMode === 'render') setViewMode('design', true); }
  });
  on('theme', () => { if (state.viewMode === 'render') applySceneTheme(); if (matPanelOpen) renderMatPanel(); });
  updateModeBar();
}
