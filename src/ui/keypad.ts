// iPad mode: a number pad that appears whenever a size box is being edited, so there is no need for the system
// keyboard (which has no Tab, Enter or math signs on its number page). Tool menu boxes, dimension boxes and the
// value boxes that follow the cursor in a sketch all use it. Words (the Text tool) still use the normal keyboard.
import { state } from '../app/state';
import { $ } from '../core/dom';

const NUMERIC = '.dialog .len-input, #dimInput, #hud input';

const KEYS: [string, string, string?][] = [
  ['7', '7'], ['8', '8'], ['9', '9'], ['÷', '/'], ['⌫', 'back'],
  ['4', '4'], ['5', '5'], ['6', '6'], ['×', '*'], ['(', '('],
  ['1', '1'], ['2', '2'], ['3', '3'], ['−', '-'], [')', ')'],
  ['0', '0'], ['.', '.'], ['±', 'sign'], ['+', '+'], ['✕', 'esc', 'cancel'],
];

export function initKeypad(): void {
  const vp = $('#viewport');
  const pad = document.createElement('div');
  pad.className = 'keypad';
  pad.hidden = true;
  pad.setAttribute('role', 'group');
  pad.setAttribute('aria-label', 'Number pad');
  pad.innerHTML = KEYS.map(([label, k, cls]) => `<button type="button" class="kp${cls ? ' ' + cls : ''}" data-k="${k}" aria-label="${label}">${label}</button>`).join('')
    + '<button type="button" class="kp wide" data-k="next">Next</button><button type="button" class="kp wide ok" data-k="done">Done</button>';
  vp.appendChild(pad);

  let target: HTMLInputElement | null = null;
  const tablet = (): boolean => state.device === 'tablet';

  const send = (key: string): void => {
    if (!target) return;
    const el = target;
    el.focus({ preventScroll: true });
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? s;
    const changed = (): void => { el.dispatchEvent(new Event('input', { bubbles: true })); };
    if (key === 'back') {
      if (s !== e) el.setRangeText('', s, e, 'end');
      else if (s > 0) el.setRangeText('', s - 1, s, 'end');
      changed();
    } else if (key === 'sign') {
      el.value = el.value.startsWith('-') ? el.value.slice(1) : '-' + el.value;
      changed();
    } else if (key === 'next') {
      const box = el.closest('.dialog, #hud, #dimEdit') || document;
      const all = [...box.querySelectorAll<HTMLInputElement>(NUMERIC)].filter((i) => i.offsetParent !== null);
      const nx = all[(all.indexOf(el) + 1) % all.length];
      if (nx) { nx.focus({ preventScroll: true }); nx.select(); }
    } else if (key === 'done') {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    } else if (key === 'esc') {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    } else {
      el.setRangeText(key, s, e, 'end');
      changed();
    }
  };

  // taps on the pad must not take the focus away from the box being edited
  pad.addEventListener('pointerdown', (e) => e.preventDefault());
  pad.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-k]');
    if (b) send(b.dataset.k!);
  });

  document.addEventListener('focusin', (e) => {
    const t = e.target as HTMLElement;
    if (!tablet() || !t.matches || !t.matches(NUMERIC)) return;
    target = t as HTMLInputElement;
    target.inputMode = 'none'; // no system keyboard: the pad is the keyboard
    pad.hidden = false;
  });
  document.addEventListener('focusout', () => {
    setTimeout(() => {
      const a = document.activeElement as HTMLElement | null;
      if (a && a.matches && a.matches(NUMERIC) && tablet()) return;
      target = null;
      pad.hidden = true;
    }, 150);
  });
  // leaving iPad mode puts the pad away
  document.addEventListener('visibilitychange', () => { if (document.hidden) pad.hidden = true; });
}
