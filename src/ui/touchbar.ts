// iPad mode: three buttons for the keys a tablet does not have: Undo, Esc (cancel / back out) and Enter (finish / repeat).
import { undo } from '../app/history';
import { $ } from '../core/dom';

export function initTouchbar(): void {
  const bar = document.createElement('div');
  bar.className = 'touchbar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Undo, Escape and Enter');
  bar.innerHTML = '<button type="button" data-tb="undo" aria-label="Undo" title="Undo (also a quick two-finger tap)">↶ Undo</button>'
    + '<button type="button" data-tb="esc" aria-label="Escape" title="Cancel or back out">Esc</button>'
    + '<button type="button" data-tb="enter" aria-label="Enter" title="Finish, or repeat the last command">Enter ⏎</button>';
  $('#viewport').appendChild(bar);
  const key = (k: string): void => { (document.activeElement && document.activeElement !== document.body ? document.activeElement : document.body).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); };
  bar.addEventListener('pointerdown', (e) => e.preventDefault()); // never takes the focus from a box being edited
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-tb]');
    if (!b) return;
    if (b.dataset.tb === 'undo') undo();
    else if (b.dataset.tb === 'esc') key('Escape');
    else key('Enter');
  });
}
