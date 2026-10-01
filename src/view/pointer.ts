// Mouse in the viewport: left-drag orbits, right-drag (or Shift+drag) pans, wheel zooms.
// A press that does not move is a click and goes to the interaction code.
import { state } from '../app/state';
import { sketchDragEnd, sketchDragMove, sketchDragStart, type SketchDrag } from '../sketch/tools';
import { focusPrimary, handleDragMove, handleDragStart, overHandle, type HandleDrag } from '../tools/dialog';
import { setPointer } from '../tools/pick';
import { clickAt, doubleClickAt, hoverLeave, hoverMove, openViewportMenu } from './interaction';
import { cam, camera, canvas, V3 } from './scene';
import { stopAnimation } from './views';

type Ptr =
  | { mode: 'orbit' | 'pan'; x: number; y: number; moved: boolean; button: number }
  | { mode: 'handle'; drag: HandleDrag; x: number; y: number; moved: boolean; button: number }
  | { mode: 'skdrag'; drag: SketchDrag }
  | { mode: 'tooldrag'; data: unknown; x: number; y: number; moved: boolean; button: number };

export function initPointer(): void {
  let ptr: Ptr | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    stopAnimation();
    setPointer(e);
    const drag = handleDragStart(e);
    if (drag) { ptr = { mode: 'handle', drag, x: e.clientX, y: e.clientY, moved: false, button: e.button }; canvas.style.cursor = 'grabbing'; return; }
    // a tool's own draggable things (hole markers)
    const A = state.active;
    if (A && A.def.dragStart && e.button === 0) {
      const data = A.def.dragStart(A, e);
      if (data) { ptr = { mode: 'tooldrag', data, x: e.clientX, y: e.clientY, moved: false, button: 0 }; return; }
    }
    // with no sketch tool active, pressing on a point, line or circle drags it
    if (state.mode === 'sketch' && !state.pick) {
      const sd = sketchDragStart(e);
      if (sd) { ptr = { mode: 'skdrag', drag: sd }; return; }
    }
    ptr = { mode: e.button === 0 && !e.shiftKey ? 'orbit' : 'pan', x: e.clientX, y: e.clientY, moved: false, button: e.button };
  });
  canvas.addEventListener('pointermove', (e) => {
    setPointer(e);
    if (!ptr) {
      hoverMove(e);
      if (overHandle()) canvas.style.cursor = 'grab';
      return;
    }
    if (ptr.mode === 'skdrag') { sketchDragMove(e, ptr.drag); return; }
    if (ptr.mode === 'tooldrag') {
      if (!ptr.moved && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) < 4) return;
      ptr.moved = true;
      canvas.style.cursor = 'grabbing';
      const A = state.active;
      if (A && A.def.dragMove) A.def.dragMove(A, ptr.data, e);
      return;
    }
    if (ptr.mode === 'handle') {
      // a press on the arrow that does not move is a click on whatever is under it (the arrow can sit on an edge)
      if (!ptr.moved && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) < 4) return;
      ptr.moved = true;
      handleDragMove(e, ptr.drag, cam.r);
      return;
    }
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    if (!ptr.moved && Math.hypot(dx, dy) < 4) return;
    ptr.moved = true; ptr.x = e.clientX; ptr.y = e.clientY;
    if (ptr.mode === 'orbit') {
      cam.theta -= dx * 0.008;
      cam.phi = Math.min(Math.PI - 0.001, Math.max(0.001, cam.phi - dy * 0.008));
    } else {
      const k = cam.r * 0.0016;
      const right = new V3().setFromMatrixColumn(camera.matrix, 0), up = new V3().setFromMatrixColumn(camera.matrix, 1);
      cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
    }
  });
  canvas.addEventListener('pointerleave', hoverLeave);
  canvas.addEventListener('pointerup', (e) => {
    if (!ptr) return;
    const was = ptr;
    ptr = null;
    canvas.style.cursor = '';
    if (was.mode === 'handle' && was.moved) { focusPrimary(); return; }
    if (was.mode === 'skdrag') { sketchDragEnd(was.drag); return; }
    if (was.mode === 'tooldrag' && was.moved) { const A = state.active; if (A && A.def.dragEnd) A.def.dragEnd(A, was.data); return; }
    if (was.moved) return;
    setPointer(e);
    // right-click (without dragging) opens the menu for whatever is under the cursor
    if (was.button === 2) { if (state.mode !== 'sketch' && !state.active && !state.pick) openViewportMenu(e); return; }
    clickAt(e);
    if (!state.tool) hoverMove(e);
  });
  canvas.addEventListener('pointercancel', () => { ptr = null; canvas.style.cursor = ''; });
  canvas.addEventListener('dblclick', (e) => { setPointer(e); doubleClickAt(); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopAnimation();
    cam.r = Math.min(2500, Math.max(25, cam.r * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
}
