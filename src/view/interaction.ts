// What the mouse does in the viewport when it is not orbiting: hover highlights (orange),
// click selection (bold blue) and handing clicks to whichever tool is asking for something.
import { runCommand } from '../app/commands';
import { emit, on } from '../app/hub';
import { pushUndo, snapshotDoc } from '../app/undo';
import { baseBody, rebuildSolids, shownBodies } from '../app/solids';
import { feats, featById, state, type Selection } from '../app/state';
import { edgeToRef, refIs } from '../kernel/match';
import type { EdgeRef } from '../kernel/protocol';
import { frameFromFace } from '../model/frames';
import type { PlaneRef, SketchFeature } from '../model/types';
import { curvePts } from '../sketch/model';
import { enterSketch, selectSketch } from '../sketch/session';
import { sketchClick, sketchMove } from '../sketch/tools';
import { clearHoverLines, showHoverLines, sketchCenter, sketchGroupVisible, sketchWorldSegs, toScreen, tw } from '../sketch/visuals';
import { clearSelection, endPick, hidePickTip, mouse, planeUnderCursor, showPickTip } from '../tools/pick';
import { message } from '../ui/message';
import { openMenu, type MenuItem } from '../ui/menu';
import { edgeSegments, edgesOfFace, setBoldSegments, setHoverEdge, setHoverFace, setSelectedFaces } from './bodies';
import { edgeAtCursor, faceAtCursor, profileAtCursor } from './hit';
import type { PlaneVis } from './planes';
import { camera, canvas } from './scene';
import { goHome, zoomFit } from './views';

type Hit =
  | { kind: 'sketch'; id: string; key: string }
  | { kind: 'plane'; vis: PlaneVis; key: string }
  | { kind: 'face'; key: string; sel: Extract<Selection, { kind: 'face' }> }
  | { kind: 'edge'; key: string; sel: Extract<Selection, { kind: 'edge' }>; segs: ReturnType<typeof edgeSegments> };

/** A click near any curve of a visible sketch picks that sketch. */
function sketchLineAt(): { id: string; d: number } | null {
  let best: SketchFeature | null = null, bd = 7;
  feats('sketch').forEach((s) => {
    if (!s.frame || !sketchGroupVisible(s)) return;
    s.curves.forEach((c) => {
      const P = curvePts(s, c).map((p) => toScreen(tw(s.frame!, p[0], p[1]))), n = P.length + (c.type === 'circle' ? 1 : 0);
      for (let i = 0; i + 1 < n; i++) {
        const a = P[i], b = P[(i + 1) % P.length];
        if (a.behind || b.behind) continue;
        const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
        let t = L2 ? ((mouse.x - a.x) * dx + (mouse.y - a.y) * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(mouse.x - a.x - dx * t, mouse.y - a.y - dy * t);
        if (d < bd) { bd = d; best = s; }
      }
    });
  });
  if (!best) return null;
  const s = best as SketchFeature;
  return { id: s.id, d: camera.position.distanceTo(sketchCenter(s)) };
}

/** What a click would select right now, outside any tool. Edges first, then whatever is nearest. */
function solidHit(): Hit | null {
  const eh = edgeAtCursor(shownBodies());
  if (eh) return { kind: 'edge', key: 'e' + eh.bodyId + ':' + eh.edge.id, sel: { kind: 'edge', key: 'e' + eh.bodyId + ':' + eh.edge.id, bodyId: eh.bodyId, edgeId: eh.edge.id }, segs: eh.segs };
  let best: { d: number; r: Hit } | null = null;
  const ph = profileAtCursor();
  if (ph) best = { d: ph.distance - 0.05, r: { kind: 'sketch', id: ph.sel.sketchId, key: 'sk:' + ph.sel.sketchId } };
  else { const sl = sketchLineAt(); if (sl) best = { d: sl.d, r: { kind: 'sketch', id: sl.id, key: 'sk:' + sl.id } }; }
  const fh = faceAtCursor();
  if (fh && (!best || fh.distance < best.d)) {
    const f = fh.face, key = 'f' + fh.bodyId + ':' + f.id;
    best = { d: fh.distance, r: { kind: 'face', key, sel: { kind: 'face', key, bodyId: fh.bodyId, faceId: f.id, planar: f.planar, n: f.n, p: [fh.point.x, fh.point.y, fh.point.z], surf: f.surf } } };
  }
  const pl = planeUnderCursor();
  if (pl && (!best || pl.distance < best.d - 0.01)) best = { d: pl.distance, r: { kind: 'plane', vis: pl.vis, key: pl.vis.key } };
  return best ? best.r : null;
}

/** While a tool asks for a plane: the plane or body face under the cursor (curved faces are reported so the tip can say why not). */
function pickTarget(): { kind: 'plane'; vis: PlaneVis } | { kind: 'face'; sel: Extract<Selection, { kind: 'face' }> } | { kind: 'curved' } | null {
  const pl = planeUnderCursor(), fh = faceAtCursor();
  // a solid body under the cursor wins over the see-through planes around it (those can still be picked beside the body, or in the Browser)
  if (fh) {
    if (!fh.face.planar) return { kind: 'curved' };
    const f = fh.face, key = 'f' + fh.bodyId + ':' + f.id;
    return { kind: 'face', sel: { kind: 'face', key, bodyId: fh.bodyId, faceId: f.id, planar: true, n: f.n, p: [fh.point.x, fh.point.y, fh.point.z], surf: f.surf } };
  }
  return pl ? { kind: 'plane', vis: pl.vis } : null;
}

function setHover(h: Hit | null): void {
  const key = h ? h.key : null;
  if (key === state.hoverKey) return;
  state.hoverKey = key;
  if (h && h.kind === 'sketch') showHoverLines(h.key, sketchWorldSegs(featById(h.id) as SketchFeature)); else clearHoverLines();
  if (h && h.kind === 'face') setHoverFace(h.sel.bodyId, h.sel.faceId); else setHoverFace(null);
  setHoverEdge(h && h.kind === 'edge' ? h.segs : null, key || '');
  emit('select');
}
/** Drop every hover highlight (a tool took over, or the mouse left). */
export function clearHover(): void {
  state.hoverKey = null;
  clearHoverLines(); setHoverFace(null); setHoverEdge(null);
}

export function hoverMove(e: PointerEvent): void {
  if (state.pick) {
    // a tool is asking for a plane: planes and flat body faces can be picked, whichever is in front
    const t = pickTarget();
    setHover(t && t.kind === 'plane' ? { kind: 'plane', vis: t.vis, key: t.vis.key } : t && t.kind === 'face' ? { kind: 'face', key: t.sel.key, sel: t.sel } : null);
    canvas.style.cursor = t && t.kind !== 'curved' ? 'pointer' : '';
    showPickTip(t && t.kind === 'curved' ? 'Curved face: pick a flat face or a plane' : undefined);
    return;
  }
  if (state.mode === 'sketch') { sketchMove(e); return; }
  const A = state.active;
  if (A) {
    if (state.hoverKey) { state.hoverKey = null; emit('select'); }
    canvas.style.cursor = A.def.hover && A.def.hover(A) ? 'pointer' : '';
    return;
  }
  const h = solidHit();
  setHover(h);
  canvas.style.cursor = h ? 'pointer' : '';
}

export function hoverLeave(): void {
  hidePickTip();
  if (state.mode !== 'sketch' && !state.active) setHover(null);
}

// ---- selection ----
function drawSelection(): void {
  const free = !state.active && state.mode !== 'sketch' && !state.pick;
  setSelectedFaces(free ? state.selection.flatMap((s) => (s.kind === 'face' ? [{ bodyId: s.bodyId, faceId: s.faceId }] : [])) : []);
  if (!state.active) {
    const shown = shownBodies();
    setBoldSegments(free ? state.selection.flatMap((s) => { if (s.kind !== 'edge') return []; const b = shown.find((x) => x.id === s.bodyId); return b ? edgeSegments(b, s.edgeId) : []; }) : []);
  }
}
on('select', drawSelection);
on('mode', drawSelection);

function selMessage(): string {
  const s = state.selection, e = s.filter((x) => x.kind === 'edge').length, f = s.filter((x) => x.kind === 'face').length, p = s.filter((x) => x.kind === 'plane').length;
  if (!s.length) return '';
  const parts: string[] = [];
  if (e) parts.push(`${e} edge${e > 1 ? 's' : ''}`);
  if (f) parts.push(`${f} face${f > 1 ? 's' : ''}`);
  if (p) parts.push(`${p} plane${p > 1 ? 's' : ''}`);
  const fs = s.filter((x) => x.kind === 'face'), filletFace = fs.some((x) => x.kind === 'face' && /^F:/.test(x.surf)), flat = fs.some((x) => x.kind === 'face' && x.planar);
  const tips = filletFace ? 'Delete removes that fillet or chamfer, f or cha works on its edges'
    : f || p ? (flat || p ? (flat ? 'ex extrudes it, ' : '') + 'sk sketches on it, pl makes an offset plane' + (f ? ', ' : '') : '') + (f ? 'f or cha works on its edges' : '')
    : 'f fillets, cha chamfers';
  return `${parts.join(' and ')} selected. ${tips[0].toUpperCase() + tips.slice(1)}. Shift+click adds more, right-click for options.`;
}

function toggleSelection(sel: Selection, shift: boolean): void {
  const i = state.selection.findIndex((s) => s.key === sel.key);
  if (shift) { if (i >= 0) state.selection.splice(i, 1); else state.selection.push(sel); }
  else state.selection = i >= 0 && state.selection.length === 1 ? [] : [sel];
  emit('select');
}

/** A click in the viewport that was not a drag. */
export function clickAt(e: PointerEvent): void {
  if (e.button !== 0) return;
  if (state.pick) {
    const t = pickTarget();
    if (!t) return;
    if (t.kind === 'curved') { message('That face is curved. Pick a flat face or a plane.', 'warn'); return; }
    const p = state.pick;
    let ref: PlaneRef;
    if (t.kind === 'plane') ref = t.vis.ref;
    else { const id = t.sel.bodyId, b = state.bodies.find((x) => x.id === id); ref = { kind: 'face', frame: frameFromFace(t.sel.n, t.sel.p), bodyName: b ? b.name : 'body' }; }
    endPick();
    clearHover();
    p.onPick(ref);
    return;
  }
  if (state.mode === 'sketch') { sketchClick(e); return; }
  const A = state.active;
  if (A) { if (A.def.click) A.def.click(A, e); return; }
  const h = solidHit();
  if (!h) {
    if (state.treeSel) selectSketch(null);
    if (!e.shiftKey && (state.selection.length || state.selected)) { state.selected = null; clearSelection(); message('Selection cleared'); }
    return;
  }
  if (h.kind === 'sketch') {
    const f = featById(h.id)!;
    selectSketch(state.treeSel === h.id ? null : h.id);
    if (state.treeSel) message(`${f.name} selected. Double-click to edit it, or type ex, rev or sw to use its profile.`);
    return;
  }
  if (state.treeSel) selectSketch(null);
  state.selected = null;
  toggleSelection(h.kind === 'plane' ? { kind: 'plane', key: h.vis.key, ref: h.vis.ref } : h.sel, e.shiftKey);
  message(selMessage() || 'Selection cleared');
}

/** Double-click a sketch in the viewport to edit it. */
export function doubleClickAt(): void {
  if (state.mode === 'sketch' || state.active || state.pick) return;
  const h = solidHit();
  if (h && h.kind === 'sketch') { clearHover(); enterSketch(featById(h.id) as SketchFeature); }
}

// ---- what tools take from the selection (select first, then tool) ----
/** Edges selected directly, plus every edge of each selected face. */
export function selectedEdgeRefs(): EdgeRef[] {
  const out: EdgeRef[] = [];
  const add = (bodyId: string, edgeId: number): void => {
    const b = baseBody(bodyId), e = b && b.edges.find((x) => x.id === edgeId);
    if (!e || e.kind === 'other') return;
    if (!out.some((r) => refIs(e, bodyId, r))) out.push(edgeToRef(e, bodyId));
  };
  state.selection.forEach((s) => {
    if (s.kind === 'edge') add(s.bodyId, s.edgeId);
    else if (s.kind === 'face') { const b = baseBody(s.bodyId); if (b) edgesOfFace(b, s.faceId).forEach((e) => add(s.bodyId, e.id)); }
  });
  return out;
}
/** A selected flat face (for press-pull, sketch on face, offset plane). */
export function selectedFlatFace(): Extract<Selection, { kind: 'face' }> | null {
  const s = state.selection.find((x) => x.kind === 'face' && x.planar);
  return s && s.kind === 'face' ? s : null;
}
/** Delete on a selected fillet or chamfer face removes just that edge from its feature. */
export function deleteSelectedFaces(): boolean {
  const faces = state.selection.filter((s): s is Extract<Selection, { kind: 'face' }> => s.kind === 'face');
  if (!faces.length) return false;
  const byF = new Map<string, Set<number>>();
  let other: string | null = null;
  faces.forEach((s) => {
    const m = /^F:([^:]+):(\d+)$/.exec(s.surf);
    if (m && featById(m[1])) { if (!byF.has(m[1])) byF.set(m[1], new Set()); byF.get(m[1])!.add(+m[2]); }
    else other = s.surf;
  });
  if (!byF.size) {
    const src = other ? featById(String(other).split(':')[0]) : null;
    message(src ? `That face comes from ${src.name}. To change it, edit ${src.name} (double-click it in the History) or delete it there.` : "That face can't be deleted on its own", 'warn');
    return true;
  }
  pushUndo({ kind: 'doc', before: snapshotDoc(), label: 'Brought the fillet back' });
  const done: string[] = [];
  byF.forEach((idx, fid) => {
    const f = featById(fid)!, P = f.params as { edges: EdgeRef[] }, keep = P.edges.filter((_e, i) => !idx.has(i));
    if (!keep.length) { state.features = state.features.filter((x) => x !== f); done.push(`${f.name} (removed)`); }
    else { P.edges = keep; done.push(`${idx.size} edge${idx.size > 1 ? 's' : ''} from ${f.name}`); }
  });
  state.selection = [];
  void rebuildSolids();
  emit('doc', 'select');
  message(`Deleted ${done.join(', ')}. The edge${done.length > 1 ? 's are' : ' is'} sharp again.`, 'ok');
  return true;
}

/** Right-click in the viewport: what can be done with the thing under the cursor. */
export function openViewportMenu(e: PointerEvent): void {
  const h = solidHit(), items: MenuItem[] = [];
  const cmd = (id: string) => () => runCommand(id);
  if (h && (h.kind === 'face' || h.kind === 'edge' || h.kind === 'plane') && !state.selection.some((s) => s.key === h.key)) {
    state.selected = null;
    state.selection = [h.kind === 'plane' ? { kind: 'plane', key: h.vis.key, ref: h.vis.ref } : h.sel];
    emit('select');
  }
  if (h && h.kind === 'sketch') {
    selectSketch(h.id);
    items.push({ label: 'Edit sketch', icon: 'sketch', act: () => enterSketch(featById(h.id) as SketchFeature) }, { label: 'Extrude', icon: 'extrude', act: cmd('extrude') }, { label: 'Revolve', icon: 'revolve', act: cmd('revolve') }, { label: 'Sweep', icon: 'sweep', act: cmd('sweep') });
  }
  const flat = h && h.kind === 'face' && h.sel.planar;
  if (flat) items.push({ label: 'Extrude this face (press-pull)', icon: 'extrude', act: cmd('extrude') });
  if (h && (h.kind === 'plane' || flat)) items.push({ label: `Sketch on this ${h.kind}`, icon: 'sketch', act: cmd('sketch') }, { label: 'Offset plane from it', icon: 'plane', act: cmd('plane') });
  if (h && (h.kind === 'edge' || h.kind === 'face')) items.push({ label: h.kind === 'face' ? 'Fillet its edges' : 'Fillet', icon: 'fillet', act: cmd('fillet') }, { label: h.kind === 'face' ? 'Chamfer its edges' : 'Chamfer', icon: 'chamfer', act: cmd('chamfer') });
  if (h && h.kind === 'face' && /^F:/.test(h.sel.surf)) {
    const f = featById(h.sel.surf.split(':')[1]);
    items.push({ label: 'Delete this ' + ((f && (f.params as any).kind) || 'fillet'), icon: 'trash', danger: true, act: () => { deleteSelectedFaces(); } });
  }
  if (h && (h.kind === 'edge' || h.kind === 'face')) items.push({ sep: true }, { label: 'Material…', icon: 'appearance', act: cmd('appearance') });
  if (!items.length) items.push({ label: 'Home view', icon: 'home', act: goHome }, { label: 'Zoom to fit', icon: 'fit', act: zoomFit });
  openMenu(items, e.clientX, e.clientY, canvas);
}

