// Changing the timeline: delete, undo, show/hide, new project.
import type { Body, Feature } from '../model/types';
import { newCounters } from '../model/types';
import { closeDimEdit, enterSketch, finishSketch, isDimEditing, rebuildOverlay } from '../sketch/session';
import { clearTracking, exitTool, sketchUndo, toolBusy } from '../sketch/tools';
import { clearHoverLines, drawSketchSelection, setSketchOnTop } from '../sketch/visuals';
import { cancelDialog, hasTool, openDialog } from '../tools/dialog';
import { clearUndo, popUndo, pushUndo, restoreDoc, snapshotDoc } from './undo';
import { cancelPick, endPick } from '../tools/pick';
import { message } from '../ui/message';
import { applyGridVisibility } from '../view/scene';
import { emit } from './hub';
import { markDirty, regenerate } from './regenerate';
import { bodyById, featById, state } from './state';

const bodyIdsOf = (f: Feature): string[] => (f.type === 'plane' || f.type === 'sketch' ? [] : ([f.bodyId] as (string | undefined)[]).concat(f.bodyIds || []).filter((x): x is string => !!x));

/** A feature plus everything built on it. */
export function collectWithDependents(roots: Feature[]): Feature[] {
  const ids = new Set(roots.map((f) => f.id)), list = roots.slice();
  state.features.forEach((g) => {
    if (ids.has(g.id)) return;
    const p = g.params as any;
    const r = p && p.ref;
    const usesSketch = p && (ids.has(p.sketchId) || (p.path && ids.has(p.path.sketchId)) || (p.axis && ids.has(p.axis.sketchId)) || (Array.isArray(p.pts) && p.pts.some((q: any) => q.sketchId && ids.has(q.sketchId))));
    if (g.type === 'pattern' && (p.feats || []).some((id: string) => ids.has(id))) { ids.add(g.id); list.push(g); return; }
    if (((g.type === 'extrude' || g.type === 'revolve' || g.type === 'hole' || g.type === 'sweep') && usesSketch) || (r && r.kind === 'plane' && ids.has(r.id))) { ids.add(g.id); list.push(g); }
  });
  return list;
}

/** Leave sketch editing without the usual "finished" steps (the sketch is going away). */
function dropSketchSession(): void {
  exitTool(true);
  closeDimEdit(false);
  state.mode = 'solid';
  state.sketch = null;
  state.skSel = null; state.skSels = []; state.skHover = null; state.skHoverCon = null;
  setSketchOnTop(false);
  drawSketchSelection(null);
  rebuildOverlay();
}

function removeFeatures(list: Feature[]): void {
  const ids = new Set(list.map((f) => f.id));
  if (state.active && state.active.edit && ids.has(state.active.edit.id)) cancelDialog(true);
  if (state.sketch && ids.has(state.sketch.id)) dropSketchSession();
  state.features = state.features.filter((f) => !ids.has(f.id));
  state.bodies = state.bodies.filter((b) => state.features.some((f) => bodyIdsOf(f).includes(b.id)));
  state.selection = state.selection.filter((s) => !(s.kind === 'plane' && s.ref.kind === 'plane' && ids.has(s.ref.id)));
  if (state.treeSel && ids.has(state.treeSel)) state.treeSel = null;
  if (state.selected && ids.has(state.selected.sketchId)) state.selected = null;
  clearHoverLines();
  state.hoverKey = null;
  regenerate();
  emit('mode', 'select');
}

export function deleteFeature(f: Feature): void {
  pushUndo({ kind: 'doc', before: snapshotDoc(), label: `Brought back ${f.name}` });
  const list = collectWithDependents([f]), extra = list.slice(1).map((x) => x.name);
  removeFeatures(list);
  message(`Deleted ${f.name}${extra.length ? ' and what was built on it: ' + extra.join(', ') : ''}`, extra.length ? 'warn' : undefined);
}

export function deleteBody(b: Body): void {
  pushUndo({ kind: 'doc', before: snapshotDoc(), label: `Brought back ${b.name}` });
  removeFeatures(collectWithDependents(state.features.filter((f) => bodyIdsOf(f)[0] === b.id)));
  message(`Deleted ${b.name}`);
}

export function undo(): void {
  if (state.pick && !state.active) { cancelPick(); return; }
  const A = state.active;
  if (A) {
    // a menu that Ctrl+Z reopened: Ctrl+Z again takes the step itself back
    if (A.undoBefore) {
      const before = A.undoBefore, name = A.edit ? A.edit.name : A.def.title;
      A.undoBefore = undefined;
      cancelDialog(true);
      restoreDoc(before);
      message(`Undid ${name}`);
    } else cancelDialog();
    return;
  }
  if (state.mode === 'sketch' && state.sketch) {
    const sk = state.sketch;
    // an empty sketch with nothing left to undo: step back out of it
    if (!sk.hist.length && !sk.curves.length && !toolBusy() && !isDimEditing()) { removeFeatures([sk]); message(`Removed ${sk.name}`); return; }
    sketchUndo();
    return;
  }
  const e = popUndo();
  if (!e) { message('Nothing to undo'); return; }
  if (e.kind === 'doc') { restoreDoc(e.before); message(e.label); return; }
  const f = featById(e.id)!;
  if (e.kind === 'sketch' && f.type === 'sketch') { enterSketch(f); message(`Back in ${f.name}. Ctrl+Z undoes drawing steps; fs finishes.`); return; }
  if (e.kind !== 'feature') return;
  const tool = f.type === 'fillet' ? String((f.params as { kind?: string }).kind || 'fillet') : f.type;
  if (!hasTool(tool)) { restoreDoc(e.before); message(`Undid ${f.name}`); return; }
  openDialog(tool, f);
  if (state.active) state.active.undoBefore = e.before;
  message(`Back in ${f.name}: change it and press Enter, or press Ctrl+Z again to take it out.`);
}

/** ref is "origin", "body:<id>" or "<type>:<id>". */
export function toggleVis(ref: string): void {
  const [kind, id] = ref.split(':');
  if (kind === 'origin') state.originPlanesVisible = !state.originPlanesVisible;
  else if (kind === 'body') { const b = bodyById(id); if (!b) return; b.visible = !b.visible; }
  else { const f = featById(id); if (!f) return; f.visible = f.visible === false; }
  regenerate();
  emit('select');
}

/** Clear the document and every selection, highlight and preview that belonged to it (standing rule 7). */
export function resetScene(): void {
  if (state.active) cancelDialog(true);
  if (state.pick) endPick();
  if (state.sketch) dropSketchSession();
  clearTracking();
  clearHoverLines();
  clearUndo();
  state.mode = 'solid';
  state.features = [];
  state.bodies = [];
  state.counters = newCounters();
  state.selection = [];
  state.treeSel = null;
  state.selected = null;
  state.hovered = null;
  state.hoverKey = null;
  state.last = null;
  state.lastSketchId = null;
  state.originPlanesVisible = false;
  applyGridVisibility();
}

export { finishSketch, markDirty };
