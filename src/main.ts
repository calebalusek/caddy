import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles/app.css';

import { runCommand } from './app/commands';
import { emit, on } from './app/hub';
import { undo } from './app/history';
import { flushSave, importFile, initProjects, newProject, projectFile } from './files/project';
import { initLibrary } from './ui/library';
import { regenerate } from './app/regenerate';
import { feats, state } from './app/state';
import { $ } from './core/dom';
import { baseBodies, isBuilding, kernel, previewBodies, whenBuilt } from './app/solids';
import { bodyFitPoints } from './view/bodies';
import { toWorld } from './model/frames';
import { initDialogs, openDialog } from './tools/dialog';
import './tools/plane';
import './tools/extrude';
import './tools/fillet';
import './tools/revolve';
import './tools/hole';
import './tools/sweep';
import './tools/shell';
import './tools/pattern';
import './tools/mirror';
import './tools/combine';
import './tools/transform';
import './tools/split';
import './tools/offsetbody';
import './tools/overhang';
import './tools/thickness';
import './tools/measure';
import './tools/text';
import './tools/thread';
import { initChrome } from './ui/chrome';
import { initCommandBar } from './ui/cmdbar';
import { initKeyboard } from './ui/keyboard';
import { initKeypad } from './ui/keypad';
import { initScrub } from './ui/scrub';
import { initTouchbar } from './ui/touchbar';
import { initMenu } from './ui/menu';
import { message } from './ui/message';
import { initTree } from './ui/tree';
import { initPointer } from './view/pointer';
import { initRender, setViewMode } from './view/render';
import type * as THREE from 'three';
import { applyGridVisibility, gridGroup, cam, camera, canvas, startScene, updateCamera, V3 } from './view/scene';
import { initViewCube } from './view/viewcube';
import { addFitSource, initViewsBar } from './view/views';
import { initSketchSession } from './sketch/session';
import { initSketchTools } from './sketch/tools';
import { sketchGroupVisible, sketchWorldPoints } from './sketch/visuals';

// The geometry engine loads in the background; the UI is usable straight away.
const kernelState = $('#kernelState');
kernelState.textContent = 'Loading geometry engine…';
kernelState.hidden = false;
const kernelReady = kernel.call('ping').then(
  () => { kernelState.hidden = true; return true; },
  (err: Error) => {
    kernelState.classList.add('warn');
    kernelState.textContent = 'Geometry engine failed to load';
    kernelState.title = err.message;
    message('The geometry engine could not start. Reload the page to try again.', 'warn');
    return false;
  },
);

// Say so when a rebuild takes long enough to notice.
let busyTimer: ReturnType<typeof setTimeout> | undefined;
on('doc', () => {
  if (kernelState.classList.contains('warn')) return;
  if (!isBuilding()) { clearTimeout(busyTimer); busyTimer = undefined; if (kernelState.textContent === 'Updating the model…') kernelState.hidden = true; return; }
  if (busyTimer || !kernelState.hidden) return;
  busyTimer = setTimeout(() => { busyTimer = undefined; if (isBuilding()) { kernelState.textContent = 'Updating the model…'; kernelState.hidden = false; } }, 350);
});

initMenu();
initChrome();
initDialogs();
initSketchSession();
initSketchTools();
addFitSource(() => feats('sketch').filter(sketchGroupVisible).flatMap(sketchWorldPoints));
addFitSource(bodyFitPoints);
initCommandBar();
initRender();
initTree();
initViewsBar();
initViewCube();
initPointer();
initKeyboard();
initKeypad();
initScrub();
initTouchbar();
applyGridVisibility();
startScene();
regenerate();
emit('theme');
message('New part. Type sk or click Sketch, then pick a plane to start drawing.');
initLibrary();
void initProjects();

// Offline: once the files are saved on this device, CADDY opens with no internet. A new version waits
// until CADDY is closed and reopened, so nothing changes under the user's feet while they work.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // a new version took over: reload into it once (autosave keeps the project)
  const had = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!had || reloaded) return;
    reloaded = true;
    void flushSave().finally(() => location.reload());
  });
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    const tell = (): void => message('A new version of CADDY is ready. Close and reopen it to use it.');
    if (reg.waiting && navigator.serviceWorker.controller) tell();
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) tell(); });
    });
  }).catch(() => { /* offline support is a bonus; the app works without it */ });
}

// Test hooks (not used by the UI).
declare global {
  interface Window { __caddy: Record<string, unknown> }
}
/** Where a world point lands on the page, in client pixels. */
function screenOf(p: [number, number, number]): { x: number; y: number } {
  updateCamera();
  camera.updateMatrixWorld();
  const v = new V3(...p).project(camera), r = canvas.getBoundingClientRect();
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}
/** Where a point of the sketch being edited lands on the page. */
function sketchScreen(x: number, y: number): { x: number; y: number } | null {
  const sk = state.sketch;
  return sk && sk.frame ? screenOf(toWorld(sk.frame, x, y)) : null;
}
let builtCount = 0;
on('built', () => { builtCount++; });
/** How far the thin grid lines reach (test hook). */
function gridReach(): number { const g = gridGroup.children[0] as THREE.LineSegments; g.geometry.computeBoundingBox(); return g.geometry.boundingBox!.max.x; }
window.__caddy = { gridReach, setViewMode, builtCount: () => builtCount, state, cam, kernel, kernelReady, runCommand, openDialog, regenerate, undo, newProject, screenOf, sketchScreen, whenBuilt, shownBodies: () => previewBodies().map((b) => ({ ...b, faces: (baseBodies().find((x) => x.id === b.id) || { faces: [] }).faces })), baseBodies, projectFile, importFile, flushSave };
