// Ctrl+Z steps back ONE step, it does not throw work away:
//   - right after a tool (extrude, fillet, plane…): the tool's menu reopens with its values, ready
//     to change. Ctrl+Z again there takes the feature back out.
//   - right after finishing a sketch: back into the sketch (where Ctrl+Z undoes drawing steps).
//   - right after a delete: the deleted things come back.
// The memory is short (the last few steps) and lasts for this session only.
import { parseProject, serializeProject } from '../files/format';
import { emit } from './hub';
import { regenerate } from './regenerate';
import { featById, state } from './state';

export type UndoEntry =
  | { kind: 'feature'; id: string; before: string }
  | { kind: 'doc'; before: string; label: string }
  | { kind: 'sketch'; id: string };

const KEEP = 20;
let stack: UndoEntry[] = [];

/** The whole timeline as text, to come back to later. */
export const snapshotDoc = (): string => JSON.stringify(serializeProject(state.doc, state, null));

export function restoreDoc(snap: string): void {
  const c = parseProject(JSON.parse(snap));
  state.features = c.features;
  state.bodies = c.bodies;
  state.counters = c.counters;
  state.selection = [];
  state.treeSel = null;
  state.selected = null;
  state.hoverKey = null;
  regenerate();
  emit('mode', 'select', 'doc');
}

export function pushUndo(e: UndoEntry): void {
  stack.push(e);
  if (stack.length > KEEP) stack.shift();
}
export const clearUndo = (): void => { stack = []; };

/** The most recent step that can still be stepped back from (features that no longer exist are skipped). */
export function popUndo(): UndoEntry | null {
  while (stack.length) {
    const e = stack.pop()!;
    if (e.kind === 'doc' || featById(e.id)) return e;
  }
  return null;
}
