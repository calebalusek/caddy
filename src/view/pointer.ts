// Mouse in the viewport: left-drag orbits, right-drag (or Shift+drag) pans, wheel zooms.
// A press that does not move is a click and goes to the picking code.
import { handleDragMove, handleDragStart, overHandle, type HandleDrag } from '../tools/dialog';
import { clickAt, hoverLeave, hoverMove, setPointer } from '../tools/pick';
import { cam, camera, canvas, V3 } from './scene';
import { stopAnimation } from './views';

type Ptr =
  | { mode: 'orbit' | 'pan'; x: number; y: number; moved: boolean }
  | { mode: 'handle'; drag: HandleDrag };

export function initPointer(): void {
  let ptr: Ptr | null = null;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    stopAnimation();
    setPointer(e);
    const drag = handleDragStart(e);
    if (drag) { ptr = { mode: 'handle', drag }; canvas.style.cursor = 'grabbing'; return; }
    ptr = { mode: e.button === 0 && !e.shiftKey ? 'orbit' : 'pan', x: e.clientX, y: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    setPointer(e);
    if (!ptr) {
      hoverMove();
      if (overHandle()) canvas.style.cursor = 'grab';
      return;
    }
    if (ptr.mode === 'handle') { handleDragMove(e, ptr.drag, cam.r); return; }
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
    if (was.mode === 'handle' || was.moved) return;
    setPointer(e);
    clickAt(e);
    hoverMove();
  });
  canvas.addEventListener('pointercancel', () => { ptr = null; canvas.style.cursor = ''; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopAnimation();
    cam.r = Math.min(2500, Math.max(25, cam.r * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });
}
