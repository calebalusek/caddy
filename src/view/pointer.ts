// Pointer input in the viewport (mouse, finger and Apple Pencil).
//
// Mouse:   left-drag orbits, right-drag (or Shift+drag) pans, wheel zooms.
// Finger:  1 finger drags to orbit (to pan while sketching); 2 fingers pan and pinch to zoom, and twisting turns the
//          model; a quick 2-finger tap is Undo, a quick 3-finger tap fits the model to the screen; touch and hold
//          is a right-click; a double-tap is a double-click.
// Pencil:  precise like a mouse (hover shows snaps), plus in a sketch it draws by dragging: put the pencil
//          down where a shape starts and lift it where it ends. The pencil's side button pans.
// A press that does not move is a click and goes to the interaction code.
import { undo } from '../app/history';
import { state } from '../app/state';
import { sketchClick, sketchDragEnd, sketchDragMove, sketchDragStart, type SketchDrag } from '../sketch/tools';
import { focusPrimary, handleDragMove, handleDragStart, overHandle, type HandleDrag } from '../tools/dialog';
import { setPointer } from '../tools/pick';
import { clickAt, doubleClickAt, hoverLeave, hoverMove, openViewportMenu } from './interaction';
import { cam, camera, canvas, V3 } from './scene';
import { stopAnimation, zoomFit } from './views';

type Ptr =
  | { mode: 'orbit' | 'pan'; x: number; y: number; moved: boolean; button: number }
  | { mode: 'handle'; drag: HandleDrag; x: number; y: number; moved: boolean; button: number }
  | { mode: 'skdrag'; drag: SketchDrag }
  | { mode: 'pendraw'; x: number; y: number; moved: boolean; started: boolean }
  | { mode: 'tooldrag'; data: unknown; x: number; y: number; moved: boolean; button: number };

/** Two or three fingers down at once. */
interface Multi { cx: number; cy: number; dist: number; ang: number; moved: boolean; t0: number; fingers: number; sx: number; sy: number; sdist: number }

const LONG_PRESS_MS = 550, TAP_MS = 350, DOUBLE_TAP_MS = 380;
const DRAWING_TOOLS = new Set(['line', 'rect', 'circle', 'arc', 'polygon', 'slot']);
/** How close to the edge of the viewport (px) a sliding finger starts to zoom the view out. */
const EDGE_ZONE = 90;

/** Pan the camera by a screen movement. */
function panBy(dx: number, dy: number): void {
  const k = cam.r * 0.0016;
  const right = new V3().setFromMatrixColumn(camera.matrix, 0), up = new V3().setFromMatrixColumn(camera.matrix, 1);
  cam.target.addScaledVector(right, -dx * k).addScaledVector(up, dy * k);
}
const clampR = (r: number): number => Math.min(2500, Math.max(25, r));

export function initPointer(): void {
  let ptr: Ptr | null = null;
  const fingers = new Map<number, { x: number; y: number }>();
  let multi: Multi | null = null;
  /** After a 2/3-finger gesture the remaining finger must lift before it can start anything. */
  let ignoreUntilLift = false;
  let longTimer: ReturnType<typeof setTimeout> | undefined;
  let lastTap = { t: 0, x: 0, y: 0 };
  let lastEvent: PointerEvent | null = null;
  let lastTouchUp = 0;

  const cancelLong = (): void => { clearTimeout(longTimer); longTimer = undefined; };
  const two = (): { a: { x: number; y: number }; b: { x: number; y: number } } | null => {
    const v = [...fingers.values()];
    return v.length >= 2 ? { a: v[0], b: v[1] } : null;
  };
  const measure = (): Pick<Multi, 'cx' | 'cy' | 'dist' | 'ang'> | null => {
    const t = two();
    if (!t) return null;
    return { cx: (t.a.x + t.b.x) / 2, cy: (t.a.y + t.b.y) / 2, dist: Math.hypot(t.b.x - t.a.x, t.b.y - t.a.y) || 1, ang: Math.atan2(t.b.y - t.a.y, t.b.x - t.a.x) };
  };

  // While a shape is being drawn by sliding, the view backs away when the finger nears the edge of the viewport,
  // so a shape bigger than the screen can still be sized and let go at the right spot.
  let zoomRaf = 0;
  const stopEdgeZoom = (): void => { cancelAnimationFrame(zoomRaf); zoomRaf = 0; };
  const startEdgeZoom = (): void => {
    stopEdgeZoom();
    const tick = (): void => {
      if (!ptr || ptr.mode !== 'pendraw' || !lastEvent) { zoomRaf = 0; return; }
      const r = canvas.getBoundingClientRect(), x = lastEvent.clientX, y = lastEvent.clientY;
      const near = Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y), zone = EDGE_ZONE * (lastEvent.pointerType === 'touch' ? 1 : 0.6);
      if (near < zone) {
        const k = Math.min(1, Math.max(0, 1 - near / zone)); // 0 at the edge of the zone, 1 right at the screen edge
        cam.r = clampR(cam.r * (1 + 0.02 * k));
        hoverMove(lastEvent); // the point under the finger moves as the view does
      }
      zoomRaf = requestAnimationFrame(tick);
    };
    zoomRaf = requestAnimationFrame(tick);
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* a synthetic pointer has nothing to capture */ }
    stopAnimation();
    setPointer(e);
    lastEvent = e;
    if (e.pointerType === 'touch') {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (fingers.size >= 2) {
        // a second finger turns whatever one finger was doing into a two-finger view gesture
        cancelLong();
        ptr = null;
        const m = measure()!;
        multi = multi ? { ...multi, fingers: Math.max(multi.fingers, fingers.size) } : { ...m, moved: false, t0: performance.now(), fingers: fingers.size, sx: m.cx, sy: m.cy, sdist: m.dist };
        ignoreUntilLift = true;
        return;
      }
      if (ignoreUntilLift) return;
    }
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
    // the pencil and a finger draw in a sketch: down where a shape starts, slide, up where it ends
    if ((e.pointerType === 'pen' || e.pointerType === 'touch') && state.mode === 'sketch' && !state.pick && state.tool && DRAWING_TOOLS.has(state.tool.type) && e.button === 0 && !(e.buttons & 2)) {
      const started = !(state.tool.pts && state.tool.pts.length);
      hoverMove(e); // a pencil or finger that was not hovering still snaps to what it came down on
      if (started) sketchClick(e);
      ptr = { mode: 'pendraw', x: e.clientX, y: e.clientY, moved: false, started };
      return;
    }
    const barrel = e.pointerType === 'pen' && (e.buttons & 2) !== 0; // the pencil's side button pans
    // a finger orbits in the 3D view and pans in a sketch (which stays square-on)
    const mode = e.pointerType === 'touch' ? (state.mode === 'sketch' ? 'pan' : 'orbit') : e.button === 0 && !e.shiftKey && !barrel ? 'orbit' : 'pan';
    ptr = { mode, x: e.clientX, y: e.clientY, moved: false, button: e.button };
    // touch and hold = right-click
    if (e.pointerType === 'touch') {
      cancelLong();
      longTimer = setTimeout(() => {
        longTimer = undefined;
        if (!ptr || ptr.mode === 'handle' || ptr.mode === 'tooldrag' || ptr.mode === 'skdrag' || ptr.mode === 'pendraw' || ptr.moved) return;
        ptr = null;
        ignoreUntilLift = true;
        if (state.mode !== 'sketch' && !state.active && !state.pick && lastEvent) openViewportMenu(lastEvent);
      }, LONG_PRESS_MS);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    setPointer(e);
    lastEvent = e;
    if (e.pointerType === 'touch' && fingers.has(e.pointerId)) {
      fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (multi) {
        const m = measure();
        if (!m) return;
        const dx = m.cx - multi.cx, dy = m.cy - multi.cy;
        let dAng = m.ang - multi.ang;
        while (dAng > Math.PI) dAng -= Math.PI * 2;
        while (dAng < -Math.PI) dAng += Math.PI * 2;
        if (!multi.moved && (Math.hypot(m.cx - multi.sx, m.cy - multi.sy) > 8 || Math.abs(m.dist - multi.sdist) > 8)) multi.moved = true;
        if (multi.moved) {
          panBy(dx, dy); // both fingers drag: pan
          cam.r = clampR((cam.r * multi.dist) / m.dist); // spread: zoom in, pinch: zoom out
          if (state.mode !== 'sketch') cam.theta += dAng; // twist: turn the model
        }
        multi.cx = m.cx; multi.cy = m.cy; multi.dist = m.dist; multi.ang = m.ang;
        return;
      }
    }
    if (!ptr) {
      if (e.pointerType !== 'touch') {
        hoverMove(e); // the mouse and a hovering pencil show what a click would pick
        if (overHandle()) canvas.style.cursor = 'grab';
      }
      return;
    }
    if (ptr.mode === 'skdrag') { sketchDragMove(e, ptr.drag); return; }
    if (ptr.mode === 'pendraw') {
      if (!ptr.moved && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > 6) {
        ptr.moved = true;
        // sliding a finger: put the number pad away so it does not cover the shape
        if (e.pointerType === 'touch' && document.activeElement instanceof HTMLElement) document.activeElement.blur();
        startEdgeZoom();
      }
      hoverMove(e); // the shape stretches to follow the pencil or finger
      return;
    }
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
    if (!ptr.moved && Math.hypot(dx, dy) < (e.pointerType === 'touch' ? 8 : 4)) return;
    if (!ptr.moved) cancelLong();
    ptr.moved = true; ptr.x = e.clientX; ptr.y = e.clientY;
    if (ptr.mode === 'orbit') {
      cam.theta -= dx * 0.008;
      cam.phi = Math.min(Math.PI - 0.001, Math.max(0.001, cam.phi - dy * 0.008));
    } else panBy(dx, dy);
  });

  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hoverLeave(); });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') {
      const had = fingers.delete(e.pointerId);
      lastTouchUp = performance.now();
      cancelLong();
      if (multi) {
        if (!fingers.size) {
          // all fingers are up: a quick tap with 2 or 3 fingers is a command
          const g = multi;
          multi = null;
          ignoreUntilLift = false;
          if (!g.moved && performance.now() - g.t0 < TAP_MS) {
            if (g.fingers === 2) { undo(); }
            else if (g.fingers >= 3) zoomFit();
          }
        }
        ptr = null;
        return;
      }
      if (ignoreUntilLift) { if (!fingers.size) ignoreUntilLift = false; ptr = null; return; }
      if (!had) return;
    }
    if (!ptr) return;
    const was = ptr;
    ptr = null;
    canvas.style.cursor = '';
    if (was.mode === 'handle' && was.moved) { focusPrimary(); return; }
    if (was.mode === 'skdrag') { sketchDragEnd(was.drag); return; }
    if (was.mode === 'tooldrag' && was.moved) { const A = state.active; if (A && A.def.dragEnd) A.def.dragEnd(A, was.data); return; }
    if (was.mode === 'pendraw') {
      setPointer(e);
      hoverMove(e);
      // lifted away from where it went down: that is the end of the shape; a tap places a point as usual
      if (was.moved || !was.started) sketchClick(e);
      return;
    }
    if (was.moved) return;
    setPointer(e);
    if (e.pointerType !== 'mouse') hoverMove(e); // a finger or pencil tap has no hover first: find what is under it now
    // right-click (without dragging) opens the menu for whatever is under the cursor
    if (was.button === 2) { if (state.mode !== 'sketch' && !state.active && !state.pick) openViewportMenu(e); return; }
    clickAt(e);
    // two quick taps in the same spot are a double-click (a finger does not make a dblclick event of its own)
    if (e.pointerType === 'touch') {
      const now = performance.now();
      if (now - lastTap.t < DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 28) { lastTap = { t: 0, x: 0, y: 0 }; doubleClickAt(); }
      else lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    if (!state.tool && e.pointerType !== 'touch') hoverMove(e);
  });

  canvas.addEventListener('pointercancel', (e) => {
    if (e.pointerType === 'touch') { fingers.delete(e.pointerId); if (!fingers.size) { multi = null; ignoreUntilLift = false; } }
    cancelLong();
    ptr = null;
    canvas.style.cursor = '';
  });
  canvas.addEventListener('dblclick', (e) => { if (performance.now() - lastTouchUp < 700) return; setPointer(e); doubleClickAt(); }); // a finger's double-tap is handled above
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    stopAnimation();
    cam.r = clampR(cam.r * Math.exp(e.deltaY * 0.0012));
  }, { passive: false });
}
