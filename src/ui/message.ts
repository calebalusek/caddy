import { $ } from '../core/dom';

/** Short status line above the command bar. */
export function message(text: string, kind?: 'warn' | 'ok'): void {
  const m = $('#msg');
  m.textContent = text;
  m.className = 'msg' + (kind ? ' ' + kind : '');
}
