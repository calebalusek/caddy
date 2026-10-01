// Tool menus: docked flush to the right edge below the ViewCube, draggable by the title bar,
// position remembered for every tool, double-click the title bar to re-dock (standing rule 4).
import { storage } from '../core/dom';
import { vp } from '../view/scene';
import { message } from './message';

const KEY = 'caddy-panel-pos';
const panels = new Set<HTMLElement>();

function savedPos(): { right: number; top: number } | null {
  try {
    const p = JSON.parse(storage.get(KEY) || 'null');
    return p && isFinite(p.right) && isFinite(p.top) ? p : null;
  } catch {
    return null;
  }
}

function apply(el: HTMLElement, right: number, top: number): void {
  const vh = vp.clientHeight;
  el.style.right = right + 'px';
  el.style.top = top + 'px';
  el.style.maxHeight = vh - top - 6 + 'px';
  el.classList.toggle('dock-r', right <= 0.5);
  el.classList.toggle('dock-t', top <= 0.5);
}

/** Put a menu at its remembered spot, or docked right under the ViewCube. Never lets it leave the viewport. */
export function placePanel(el: HTMLElement | null): void {
  if (!el || !el.isConnected || el.hidden) return;
  const vh = vp.clientHeight, vw = vp.clientWidth, w = el.offsetWidth || 300;
  const saved = savedPos();
  let right: number, top: number;
  if (saved) { right = saved.right; top = saved.top; }
  else {
    right = 0;
    // Short window: move up beside the ViewCube to get more height.
    const need = Math.min(el.scrollHeight, 460);
    top = vh - 132 >= need ? 124 : Math.max(0, vh - need - 8);
  }
  right = Math.max(0, Math.min(right, vw - w));
  top = Math.max(0, Math.min(top, vh - 44));
  apply(el, right, top);
}

export function makeMovable(el: HTMLElement): void {
  panels.add(el);
  let drag: { x: number; y: number; right: number; top: number } | null = null;
  el.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    const head = t.closest<HTMLElement>('.dhead');
    if (!head || t.closest('button, input') || e.button !== 0) return;
    const r = el.getBoundingClientRect(), vr = vp.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, right: vr.right - r.right, top: r.top - vr.top };
    head.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
    e.preventDefault();
  });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const vw = vp.clientWidth, vh = vp.clientHeight, w = el.offsetWidth;
    let right = drag.right - (e.clientX - drag.x), top = drag.top + (e.clientY - drag.y);
    if (right < 12) right = 0; // snap to the edges
    if (top < 12) top = 0;
    if (vw - w - right < 12) right = vw - w;
    if (vh - 44 - top < 12) top = vh - 44;
    right = Math.max(0, Math.min(right, vw - w));
    top = Math.max(0, Math.min(top, vh - 44));
    apply(el, right, top);
  });
  const end = (): void => {
    if (!drag) return;
    drag = null;
    el.classList.remove('dragging');
    storage.set(KEY, JSON.stringify({ right: parseFloat(el.style.right) || 0, top: parseFloat(el.style.top) || 0 }));
    message('Menu position saved. Double-click its title bar to dock it back on the right.');
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('dblclick', (e) => {
    const t = e.target as HTMLElement;
    if (!t.closest('.dhead') || t.closest('button')) return;
    storage.remove(KEY);
    panels.forEach(placePanel);
    message('Menu docked back on the right');
  });
}

new ResizeObserver(() => panels.forEach(placePanel)).observe(vp);
