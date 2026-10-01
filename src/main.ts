import '@fontsource/barlow/400.css';
import '@fontsource/barlow/500.css';
import '@fontsource/barlow/600.css';
import '@fontsource/barlow/700.css';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import './styles/app.css';

import { runCommand } from './app/commands';
import { emit } from './app/hub';
import { newProject, undo } from './app/history';
import { regenerate } from './app/regenerate';
import { state } from './app/state';
import { $ } from './core/dom';
import { Kernel } from './kernel/client';
import { initDialogs, openDialog } from './tools/dialog';
import './tools/plane';
import { initChrome } from './ui/chrome';
import { initCommandBar } from './ui/cmdbar';
import { initKeyboard } from './ui/keyboard';
import { initMenu } from './ui/menu';
import { message } from './ui/message';
import { initTree } from './ui/tree';
import { initPointer } from './view/pointer';
import { applyGridVisibility, cam, camera, canvas, startScene, updateCamera, V3 } from './view/scene';
import { initViewCube } from './view/viewcube';
import { initViewsBar } from './view/views';

// The geometry engine loads in the background; the UI is usable straight away.
const kernel = new Kernel();
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

initMenu();
initChrome();
initDialogs();
initCommandBar();
initTree();
initViewsBar();
initViewCube();
initPointer();
initKeyboard();
applyGridVisibility();
startScene();
regenerate();
emit('theme');
message('New part. Type sk or click Sketch, then pick a plane to start drawing.');

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
window.__caddy = { state, cam, kernel, kernelReady, runCommand, openDialog, regenerate, undo, newProject, screenOf };
