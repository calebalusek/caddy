// iPad mode: drag a size's name sideways to change it, like a slider. Farther from the box = finer steps.
// Works with a finger or the Pencil on any length in a tool menu.
import { state } from '../app/state';
import { dragStep, fmtLen, fromUser, toUser } from '../core/units';
import { parseExpr } from '../core/expr';

export function initScrub(): void {
  let drag: { input: HTMLInputElement; startX: number; startY: number; start: number; moved: boolean } | null = null;

  document.addEventListener('pointerdown', (e) => {
    if (state.device !== 'tablet' || e.pointerType === 'mouse') return;
    const label = (e.target as HTMLElement).closest<HTMLElement>('.dialog label[data-scrub]');
    if (!label) return;
    const input = document.getElementById(label.getAttribute('for') || '') as HTMLInputElement | null;
    if (!input || !input.dataset.len) return;
    const v = parseExpr(input.value);
    if (v === null) return;
    drag = { input, startX: e.clientX, startY: e.clientY, start: v, moved: false };
    label.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  document.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX, dy = Math.abs(e.clientY - drag.startY);
    if (!drag.moved && Math.abs(dx) < 6) return;
    drag.moved = true;
    // 3 px per step; 60 px away from the starting height is ten times finer, 120 px a hundred times
    const fine = dy > 120 ? 0.01 : dy > 60 ? 0.1 : 1;
    const step = dragStep(false, false) * fine;
    const v = drag.start + (dx / 3) * step;
    const rounded = Math.round(v / step) * step;
    drag.input.value = fmtLen(fromUser(+rounded.toFixed(6)));
    drag.input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const end = (): void => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.moved) { const v = parseExpr(d.input.value); if (v !== null) d.input.value = fmtLen(fromUser(v)); }
  };
  document.addEventListener('pointerup', end);
  document.addEventListener('pointercancel', end);
  void toUser;
}
