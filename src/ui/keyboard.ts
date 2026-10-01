// Global keyboard: type anywhere to start a command, Enter/Space repeats the last one, Esc backs out.
import { runCommand } from '../app/commands';
import { undo } from '../app/history';
import { state } from '../app/state';
import { commitDialog, escapeDialog, typeIntoDialog } from '../tools/dialog';
import { cancelPick, clearSelection } from '../tools/pick';
import { commandInputEmpty, isCommandInput, typeIntoCommand } from './cmdbar';
import { message } from './message';

export function initKeyboard(): void {
  document.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    const inField = !!t.matches && t.matches('input, select, textarea');
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 's') { e.preventDefault(); runCommand('save'); return; }
      if (k === 'o') { e.preventDefault(); runCommand('openfile'); return; }
      if (k === 'z') { if (!inField || (isCommandInput(t) && commandInputEmpty())) { e.preventDefault(); undo(); } return; }
    }
    if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = !!t.matches && t.matches('button, summary, a');
    if (state.active) {
      if (e.key === 'Escape') { escapeDialog(); return; }
      if (e.key === 'Enter' && !onButton) { e.preventDefault(); commitDialog(); return; }
      if (e.key.length === 1 && /[0-9.\-+*/()]/.test(e.key) && typeIntoDialog(e.key)) e.preventDefault();
      return;
    }
    if (state.pick && e.key === 'Escape') { cancelPick(); return; }
    if (e.key === 'Escape') {
      if (state.selection.length) { clearSelection(); message('Selection cleared'); }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (onButton) return;
      if (state.last) { e.preventDefault(); runCommand(state.last); }
      return;
    }
    if (e.key.length === 1 && /\S/.test(e.key)) { e.preventDefault(); typeIntoCommand(e.key); }
  });
}
