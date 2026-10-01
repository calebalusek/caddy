// Right-click / File menus.
import { $ } from '../core/dom';
import { icon } from '../core/icons';

export type MenuItem = { sep: true } | { label: string; icon: string; danger?: boolean; act: () => void };

const ctxEl = $('#ctx');
let items: MenuItem[] = [];
let returnTo: HTMLElement | null = null;

export function openMenu(list: MenuItem[], x: number, y: number, opener?: HTMLElement | null): void {
  if (!list.length) return;
  items = list;
  returnTo = opener || (document.activeElement as HTMLElement | null);
  ctxEl.innerHTML = list
    .map((it, i) => ('sep' in it ? '<hr>' : `<button role="menuitem" tabindex="-1" data-i="${i}" class="${it.danger ? 'danger' : ''}">${icon(it.icon)}<span>${it.label}</span></button>`))
    .join('');
  ctxEl.style.display = 'block';
  const r = ctxEl.getBoundingClientRect();
  ctxEl.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 8)) + 'px';
  ctxEl.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 8)) + 'px';
  ctxEl.querySelector<HTMLElement>('button')!.focus();
}

export function closeMenu(refocus: boolean): void {
  if (ctxEl.style.display !== 'block') return;
  ctxEl.style.display = 'none';
  if (refocus && returnTo && returnTo.focus) returnTo.focus();
}

export function initMenu(): void {
  ctxEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-i]');
    if (!b) return;
    const it = items[+b.dataset.i!];
    closeMenu(false);
    if (!('sep' in it)) it.act();
  });
  ctxEl.addEventListener('keydown', (e) => {
    const btns = [...ctxEl.querySelectorAll<HTMLElement>('button')], i = btns.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(true); }
    e.stopPropagation();
  });
  document.addEventListener('pointerdown', (e) => { if (!ctxEl.contains(e.target as Node)) closeMenu(false); }, true);
}
