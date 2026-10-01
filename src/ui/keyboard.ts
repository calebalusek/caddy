// Global keyboard: type anywhere to start a command, Enter/Space repeats the last one, Esc backs out.
import { runCommand } from '../app/commands';
import { undo } from '../app/history';
import { state } from '../app/state';
import { isLibraryOpen } from '../files/project';
import { isDim } from '../sketch/model';
import { selectSketch, setOverlaySel, startDimEdit } from '../sketch/session';
import { advanceSelect, deleteSketchSel, exitTool, hudEnter, hudShown, toolBusy, typeIntoHud } from '../sketch/tools';
import { refreshSketchStyles } from '../sketch/visuals';
import { commitDialog, escapeDialog, typeIntoDialog } from '../tools/dialog';
import { cancelPick, clearSelection } from '../tools/pick';
import { deleteSelectedFaces } from '../view/interaction';
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
      // in a tool menu that Ctrl+Z reopened, Ctrl+Z again steps back out of it (elsewhere in a text box it undoes typing)
      const reopened = !!state.active && !!state.active.undoBefore && !!t.closest('section.dialog');
      if (k === 'z') { if (!inField || reopened || (isCommandInput(t) && commandInputEmpty()) || t.closest('.hud')) { e.preventDefault(); undo(); } return; }
    }
    if (isLibraryOpen()) return; // the library screen handles its own keys
    if (inField || e.ctrlKey || e.metaKey || e.altKey) return;
    const onButton = !!t.matches && t.matches('button, summary, a');
    if (state.active) {
      if (e.key === 'Escape') { escapeDialog(); return; }
      if (e.key === 'Enter' && !onButton) { e.preventDefault(); commitDialog(); return; }
      if (e.key.length === 1 && /[0-9.\-+*/()]/.test(e.key) && typeIntoDialog(e.key)) e.preventDefault();
      return;
    }
    if (state.pick && e.key === 'Escape') { cancelPick(); return; }
    if (state.mode === 'sketch' && state.sketch) {
      const T = state.tool, sk = state.sketch;
      if (e.key === 'Escape') {
        if (T) { exitTool(); message('Back to select. Click to pick, Shift+click for more, drag to move.'); }
        else if (state.skSel || state.skSels.length) { state.skSel = null; state.skSels = []; refreshSketchStyles(sk); setOverlaySel(); message('Selection cleared'); }
        else message('Type fs or press Finish sketch to leave the sketch');
        return;
      }
      const busy = toolBusy();
      if ((e.key === 'Delete' || e.key === 'Backspace') && state.skSel && !busy) { e.preventDefault(); deleteSketchSel(); return; }
      if ((e.key === 'Enter' || e.key === 'F2') && !busy && state.skSel && state.skSel.kind === 'con' && !onButton) {
        const id = state.skSel.id, c = sk.cons.find((x) => x.id === id);
        if (c && isDim(c)) { e.preventDefault(); startDimEdit(c.id); return; }
      }
      if (T && hudShown()) {
        // numbers typed over the viewport go straight into the tool's value box
        if (/^[0-9.\-+*/()]$/.test(e.key)) { e.preventDefault(); typeIntoHud(e.key); return; }
        if (e.key === 'Enter') { e.preventDefault(); hudEnter(); return; }
      }
      if (T && (T.type === 'offset' || T.type === 'move') && T.phase === 'select' && (e.key === 'Enter' || e.key === ' ') && !onButton) { e.preventDefault(); advanceSelect(); return; }
      if (T && (e.key === ' ' || e.key === 'Enter') && !onButton) { e.preventDefault(); return; }
    } else if (e.key === 'Escape') {
      const had = state.selection.length > 0 || !!state.treeSel || !!state.selected;
      state.selected = null;
      if (state.treeSel) selectSketch(null);
      clearSelection();
      if (had) message('Selection cleared');
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.mode !== 'sketch' && state.selection.some((s) => s.kind === 'face')) { e.preventDefault(); deleteSelectedFaces(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      if (onButton) return;
      if (state.last) { e.preventDefault(); runCommand(state.last); }
      return;
    }
    if (e.key.length === 1 && /\S/.test(e.key) && state.device !== 'tablet') { e.preventDefault(); typeIntoCommand(e.key); } // no command line on the iPad
  });
}
