// Sketch editing session: starting, entering and finishing a sketch, the on-screen overlay
// (dimension labels, constraint badges, the sketch bar) and editing dimension values.
import { $, esc } from '../core/dom';
import { fmtLen, fmtU, fromUser, getUnit } from '../core/units';
import { fmt } from '../core/format';
import { parseExpr } from '../core/expr';
import { icon } from '../core/icons';
import { emit, on } from '../app/hub';
import { markDirty, regenerate } from '../app/regenerate';
import { shownBodies } from '../app/solids';
import { feats, state } from '../app/state';
import { faceSnaps } from './facesnaps';
import { pushUndo } from '../app/undo';
import type { PlaneRef, SketchFeature } from '../model/types';
import { cancelDialog } from '../tools/dialog';
import { endPick, planeName, selectedPlaneRef, setPointer, startPick } from '../tools/pick';
import { message } from '../ui/message';
import { openMenu, type MenuItem } from '../ui/menu';
import { v3 } from '../view/planes';
import { cam, camera, onFrame, V3 } from '../view/scene';
import { animateTo, fitView, frameAngles, isAnimating } from '../view/views';
import { toLocal } from '../model/frames';
import { dimGeom, dimText, moveDim } from './dimgeom';
import { cmap, isDim, restore, shownDim, snapshot, type Constraint } from './model';
import { analyze, solveSketch, updateDriven } from './solver';
import { deleteSketchSel, describeSel, exitTool, setTool } from './tools';
import { buildDimLines, buildSketchVisual, planeHit, refreshProfiles, refreshSketchStyles, setSketchOnTop, skScale, sketchWorldPoints, toScreen, tw, drawSketchSelection } from './visuals';

export const dofText = (sk: SketchFeature): string => { const d = sk.status ? sk.status.dof : 0; return d === 0 ? 'fully constrained' : `${d} degree${d === 1 ? '' : 's'} of freedom left`; };
export const DofSentence = (sk: SketchFeature): string => { const t = dofText(sk); return t[0].toUpperCase() + t.slice(1); };
export function pushHist(sk: SketchFeature, snap?: string): void { sk.hist.push(snap || snapshot(sk)); if (sk.hist.length > 150) sk.hist.shift(); }

export function createSketch(ref: PlaneRef): SketchFeature {
  const n = ++state.counters.sketch;
  const f: SketchFeature = { id: 's' + n, type: 'sketch', name: 'Sketch' + n, params: { ref }, pts: { O: { x: 0, y: 0 } }, curves: [], cons: [], nid: 0, hist: [], visible: true };
  state.features.push(f);
  f.status = analyze(f);
  regenerate();
  enterSketch(f, true);
  return f;
}

/** Square the view to a sketch and fit it. */
export function lookAtSketch(sk?: SketchFeature | null): void {
  sk = sk || state.sketch;
  if (!sk || !sk.frame) return;
  const fr = sk.frame, a = frameAngles(v3(fr.n));
  let pts = sketchWorldPoints(sk);
  if (!pts.length) { // an empty sketch opens with room to draw (the plane itself is drawn small)
    const e = fr.ext, w = Math.max(60, e[1] - e[0]), h = Math.max(60, e[3] - e[2]); pts = ([[e[0], e[2]], [e[0] + w, e[2] + h]] as const).map(([x, y]) => tw(fr, x, y)); }
  animateTo({ theta: a.theta, phi: a.phi, ...fitView(pts, a.theta, a.phi, 1.25) });
}

export function enterSketch(sk: SketchFeature, isNew?: boolean): void {
  state.treeSel = null;
  state.selection = [];
  state.hoverKey = null;
  if (state.active) cancelDialog(true);
  if (state.pick) endPick();
  if (state.mode === 'sketch' && state.sketch !== sk) finishSketch(true);
  if (sk.error) { message(`${sk.name} lost its plane. Delete it or edit what it was built on.`, 'warn'); return; }
  state.mode = 'sketch';
  state.sketch = sk;
  state.selected = null; state.skSel = null; state.skSels = []; state.skHover = null;
  // on a body face: bodies stay solid and the face's corners, midpoints and centers become snap points
  const fs = sk.frame ? faceSnaps(sk.frame, shownBodies(), !!sk.params.ref && sk.params.ref.kind === 'face') : { onFace: false, ext: [] };
  sk.onFace = fs.onFace; sk.ext = fs.ext;
  sk.status = analyze(sk);
  setSketchOnTop(true);
  buildSketchVisual(sk);
  rebuildOverlay();
  lookAtSketch(sk);
  emit('mode', 'doc', 'select');
  refreshProfiles();
  message(isNew ? `${sk.name} started on ${planeName(sk.params.ref)}. Type l, rec or c to draw.` : `Editing ${sk.name}. Double-click a dimension to change it, or drag points and lines.`);
}

export function finishSketch(quiet?: boolean): void {
  const sk = state.sketch;
  if (!sk) return;
  exitTool(true);
  closeDimEdit(true);
  state.sketch = null;
  state.mode = 'solid';
  setSketchOnTop(false);
  drawSketchSelection(null);
  state.skSel = null; state.skSels = []; state.skHover = null; state.skHoverCon = null;
  state.lastSketchId = sk.id;
  rebuildOverlay();
  regenerate();
  emit('mode', 'select');
  const n = sk.profiles ? sk.profiles.length : 0;
  if (!quiet) pushUndo({ kind: 'sketch', id: sk.id });
  if (!quiet) message(`Finished ${sk.name}: ${n === 1 ? '1 profile' : n + ' profiles'}, ${dofText(sk)}. Type ex to extrude.`, 'ok');
}

/** Everything that must refresh after the sketch being edited changed. */
export function skChanged(sk: SketchFeature): void {
  markDirty();
  updateDriven(sk);
  sk.status = analyze(sk);
  buildSketchVisual(sk);
  rebuildOverlay();
  refreshProfiles();
  emit('mode');
}

/** SK, or a draw command typed outside a sketch: pick a plane, then start sketching (optionally with a tool). */
export function startSketchPick(tool?: string | null): void {
  if (state.mode === 'sketch') finishSketch(true);
  if (state.active) cancelDialog(true);
  const go = (ref: PlaneRef): void => { createSketch(ref); if (tool) setTool(tool); };
  const pre = selectedPlaneRef();
  if (pre) { go(pre); return; }
  startPick({ title: 'Create sketch', prompt: 'Select a plane or planar face', onPick: go });
}

/** Select a whole sketch outside sketch editing (click it in the viewport or the Browser). */
export function selectSketch(id: string | null): void {
  state.treeSel = id;
  state.selected = null;
  state.selection = [];
  emit('select', 'doc');
}

// ---- overlay: dimension labels, constraint badges, sketch bar ----
const skOv = $('#skOverlay');
type OvItem = { type: 'dim'; id: string; el?: HTMLElement } | { type: 'glyph'; an: { p?: string; cv?: string }; idx: number; el?: HTMLElement } | { type: 'bar'; el?: HTMLElement };
let ovItems: OvItem[] = [];
const GLYPH: Record<string, string> = { align: '↕', horizontal: 'H', vertical: 'V', perp: '⊥', par: '∥', equal: '=', fix: 'lock', tangent: 'T', midpt: 'M', ponl: 'C', ponc: 'C' };
const GLYPH_T: Record<string, string> = { align: 'Aligned with a tracked point', horizontal: 'Horizontal', vertical: 'Vertical', perp: 'Perpendicular', par: 'Parallel', equal: 'Equal', fix: 'Fixed', tangent: 'Tangent', midpt: 'Midpoint', ponl: 'Point on curve', ponc: 'Point on curve' };

const camDir = new V3();
/** True when the camera looks straight at the sketch from its front side. */
function sketchSquare(): boolean {
  const sk = state.sketch;
  if (!sk || !sk.frame) return true;
  camDir.copy(camera.position).sub(cam.target).normalize();
  return camDir.dot(v3(sk.frame.n)) > 0.9995;
}

export function rebuildOverlay(): void {
  ovItems = [];
  const sk = state.sketch;
  if (!sk || !sk.frame) { skOv.innerHTML = ''; return; }
  let html = '';
  const sel = state.skSel && state.skSel.kind === 'con' ? state.skSel.id : null;
  if (state.showDims) sk.cons.filter(shownDim).forEach((c) => {
    const tip = c.driven ? 'Reference dimension: measures only' : 'Drag to move, double-click to change' + (c.expr ? ` (= ${c.expr})` : '');
    html += `<button class="dimlbl${sel === c.id ? ' sel' : ''}${c.driven ? ' driven' : ''}" data-con="${c.id}" title="${esc(tip)}">${dimText(c)}</button>`;
    ovItems.push({ type: 'dim', id: c.id });
  });
  const per: Record<string, number> = {};
  if (state.showCons) sk.cons.forEach((c) => {
    if (!GLYPH[c.type] || c.quiet) return;
    if (c.type === 'ponc') { const cc = sk.curves.find((x) => x.id === c.c); if (cc && cc.construction) return; }
    const anchors: { p?: string; cv?: string }[] = c.type === 'fix' || c.type === 'midpt' || c.type === 'ponl' || c.type === 'ponc' || c.type === 'align' ? [{ p: c.p }] : c.l ? [{ cv: c.l }] : [{ cv: c.a }, { cv: c.b }];
    anchors.forEach((an) => {
      const key = (an.p || an.cv)!;
      const idx = (per[key] = per[key] === undefined ? 0 : per[key] + 1);
      const txt = c.type === 'fix' ? icon('fix') : c.type === 'align' ? (c.axis === 'x' ? '↕' : '↔') : GLYPH[c.type];
      html += `<button class="cglyph${sel === c.id ? ' sel' : ''}" data-con="${c.id}" title="${GLYPH_T[c.type]}. Click to select, Delete removes it">${txt}</button>`;
      ovItems.push({ type: 'glyph', an, idx });
    });
  });
  html += `<div class="skbar"><button class="sktog look" data-act="look" title="Square the view to this sketch and fit it (LA)"${sketchSquare() ? ' hidden' : ''}>${icon('look')}Sketch view</button>`
    + `<button class="sktog" data-tog="dims" aria-pressed="${state.showDims}" title="Show or hide dimensions">Dimensions</button>`
    + `<button class="sktog" data-tog="cons" aria-pressed="${state.showCons}" title="Show or hide constraint badges">Constraints</button>`
    + `<button class="sktog skfinish" data-act="finish" title="Finish sketch (FS)">${icon('finish')}Finish sketch</button></div>`;
  ovItems.push({ type: 'bar' });
  skOv.innerHTML = html;
  const els = skOv.children;
  ovItems.forEach((it, i) => { it.el = els[i] as HTMLElement; });
}

function positionOverlay(): void {
  const sk = state.sketch;
  if (!sk || !sk.frame) return;
  const M = cmap(sk), fr = sk.frame, k = skScale(sk);
  const consById = new Map(sk.cons.map((c) => [c.id, c]));
  const place = (el: HTMLElement, x: number, y: number): void => { el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%,-50%)`; };
  ovItems.forEach((it) => {
    let x: number, y: number;
    if (it.type === 'dim') {
      const c = consById.get(it.id);
      if (!c) return;
      const lb = dimGeom(sk, c, M, k).label, s = toScreen(tw(fr, lb[0], lb[1]));
      x = s.x; y = s.y;
      if (dimEditing && dimEditing.id === it.id) place(dimEdit, x, y);
    } else if (it.type === 'glyph') {
      if (it.an.p) {
        const p = sk.pts[it.an.p];
        if (!p) return;
        const s = toScreen(tw(fr, p.x, p.y));
        x = s.x + 13 + it.idx * 18; y = s.y - 13;
      } else {
        const cv = M.get(it.an.cv!);
        if (!cv) return;
        if (cv.type === 'line') {
          const a = toScreen(tw(fr, sk.pts[cv.p1].x, sk.pts[cv.p1].y)), b = toScreen(tw(fr, sk.pts[cv.p2].x, sk.pts[cv.p2].y));
          let dx = b.x - a.x, dy = b.y - a.y;
          const L = Math.hypot(dx, dy) || 1;
          dx /= L; dy /= L;
          let nx = -dy, ny = dx;
          if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }
          x = (a.x + b.x) / 2 + nx * 14 + dx * (it.idx * 18 + 14); y = (a.y + b.y) / 2 + ny * 14 + dy * (it.idx * 18 + 14);
        } else { const c = sk.pts[cv.c]; const s = toScreen(tw(fr, c.x, c.y + cv.r)); x = s.x + it.idx * 18 + 12; y = s.y - 12; }
      }
    } else return;
    place(it.el!, x, y);
  });
}

onFrame(() => {
  if (!state.sketch) return;
  positionOverlay();
  // "Sketch view" only shows while the view is not square to the sketch
  const b = skOv.querySelector<HTMLElement>('[data-act="look"]');
  if (b) { const hide = sketchSquare() || isAnimating(); if (b.hidden !== hide) b.hidden = hide; }
});

export function setOverlaySel(): void {
  const sel = state.skSel && state.skSel.kind === 'con' ? state.skSel.id : null;
  skOv.querySelectorAll<HTMLElement>('[data-con]').forEach((el) => el.classList.toggle('sel', el.dataset.con === sel));
}

// ---- editing a dimension value ----
const dimEdit = $('#dimEdit'), dimInput = $<HTMLInputElement>('#dimInput');
let dimEditing: { id: string; snap: string } | null = null;
export const isDimEditing = (): boolean => !!dimEditing;
const validDimValue = (c: Constraint, v: number): boolean => { const a = Math.abs(v); return a > 1e-6 && !(c.type === 'angle' && a >= 180); };

export function startDimEdit(id: string): void {
  const sk = state.sketch;
  if (!sk) return;
  const c = sk.cons.find((x) => x.id === id);
  if (!c) return;
  if (c.driven) { message("That's a reference dimension: it measures the sketch but doesn't drive it. Delete a conflicting dimension or constraint to control this size.", 'warn'); return; }
  if (!state.showDims) { state.showDims = true; buildDimLines(sk); rebuildOverlay(); }
  dimEditing = { id, snap: snapshot(sk) };
  state.skSel = { kind: 'con', id }; state.skSels = [];
  refreshSketchStyles(sk); setOverlaySel();
  dimEdit.style.display = 'block';
  dimInput.classList.remove('invalid');
  // a typed expression is kept only in the unit it was typed in
  dimInput.value = c.expr && (c.eu || 'mm') === getUnit() ? c.expr : c.type === 'angle' ? fmt(c.v!) : fmtLen(c.v!);
  positionOverlay();
  dimInput.focus(); dimInput.select();
  message(`Type a new ${c.type === 'angle' ? 'angle in degrees' : 'size'}. The sketch updates as you type. Enter keeps it, Tab goes to the next dimension, Esc cancels.`);
}
const dimIsAngle = (): boolean => { const sk = state.sketch, E = dimEditing, c = sk && E ? sk.cons.find((x) => x.id === E.id) : null; return !!c && c.type === 'angle'; };
function liveDim(): void {
  const E = dimEditing, sk = state.sketch;
  if (!E || !sk) return;
  const c0 = sk.cons.find((x) => x.id === E.id), raw = parseExpr(dimInput.value), v = raw === null || !c0 || c0.type === 'angle' ? raw : fromUser(raw);
  restore(sk, E.snap);
  const c = sk.cons.find((x) => x.id === E.id);
  let ok = !!c && v !== null && validDimValue(c, v);
  if (ok) { c!.v = Math.abs(v!); ok = solveSketch(sk); if (!ok) restore(sk, E.snap); }
  dimInput.classList.toggle('invalid', !ok);
  skChanged(sk);
}
export function closeDimEdit(apply: boolean): boolean {
  const E = dimEditing;
  if (!E) return false;
  dimEditing = null;
  dimEdit.style.display = 'none';
  const sk = state.sketch;
  if (!sk) return false;
  const text = dimInput.value.trim(), raw = parseExpr(text);
  restore(sk, E.snap);
  const c = sk.cons.find((x) => x.id === E.id), v = raw === null || !c || c.type === 'angle' ? raw : fromUser(raw);
  if (!apply || !c) { skChanged(sk); return false; }
  if (v === null || !validDimValue(c, v)) { skChanged(sk); message(c.type === 'angle' ? 'Enter an angle between 0 and 180°' : 'Enter a size larger than 0', 'warn'); return false; }
  const expr = /^\s*\d*\.?\d+\s*(mm|in)?\s*$/i.test(text) ? undefined : text;
  if (Math.abs(Math.abs(v) - c.v!) < 1e-9 && expr === c.expr) { skChanged(sk); return true; }
  c.v = Math.abs(v);
  if (expr) { c.expr = expr; c.eu = getUnit(); } else { delete c.expr; delete c.eu; }
  if (!solveSketch(sk)) { restore(sk, E.snap); skChanged(sk); message(`${c.type === 'angle' ? fmt(Math.abs(v)) : fmtU(Math.abs(v))} doesn't fit with the other constraints, so the old size was kept.`, 'warn'); return false; }
  pushHist(sk, E.snap);
  skChanged(sk);
  message(`Dimension set to ${c.type === 'angle' ? fmt(c.v) + '°' : fmtU(c.v)}${expr ? ` (${expr})` : ''}. ${DofSentence(sk)}.`, 'ok');
  return true;
}

export function initSketchSession(): void {
  // inches / millimeters: dimension labels and an open dimension box redraw
  on('units', () => { const sk = state.sketch; if (!sk) return; buildDimLines(sk); rebuildOverlay(); const E = dimEditing; if (E) { const c = sk.cons.find((x) => x.id === E.id); if (c) dimInput.value = c.type === 'angle' ? fmt(c.v!) : fmtLen(c.v!); } });
  let lastLblClick = { id: '', t: 0 };
  let lblDrag: { id: string; x: number; y: number; moved: boolean; snap: string } | null = null, lblDragEnd = 0;

  skOv.addEventListener('click', (e) => {
    const sk = state.sketch, t = e.target as HTMLElement;
    if (!sk) return;
    if (t.closest('[data-act="look"]')) { lookAtSketch(); return; }
    if (t.closest('[data-act="finish"]')) { finishSketch(); return; }
    const tg = t.closest<HTMLElement>('[data-tog]');
    if (tg) {
      const dims = tg.dataset.tog === 'dims';
      if (dims) state.showDims = !state.showDims; else state.showCons = !state.showCons;
      buildDimLines(sk); rebuildOverlay();
      message(`${dims ? 'Dimensions' : 'Constraint badges'} ${(dims ? state.showDims : state.showCons) ? 'shown' : 'hidden'}`);
      return;
    }
    const b = t.closest<HTMLElement>('[data-con]');
    if (!b) return;
    if (lblDragEnd && performance.now() - lblDragEnd < 250) return;
    const id = b.dataset.con!, now = performance.now(), isDimLbl = b.classList.contains('dimlbl');
    // the overlay re-renders on click, so a native dblclick may never arrive: detect the second click here
    if (isDimLbl && lastLblClick.id === id && now - lastLblClick.t < 450) { lastLblClick = { id: '', t: 0 }; startDimEdit(id); return; }
    lastLblClick = { id, t: now };
    state.skSel = { kind: 'con', id }; state.skSels = [];
    refreshSketchStyles(sk); setOverlaySel();
    message(describeSel(sk, state.skSel) + ' selected. Delete removes it' + (isDimLbl ? '; double-click or Enter changes it, drag moves it.' : '.'));
  });
  skOv.addEventListener('dblclick', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.dimlbl'); if (b && !(dimEditing && dimEditing.id === b.dataset.con)) startDimEdit(b.dataset.con!); });
  skOv.addEventListener('contextmenu', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-con]'), sk = state.sketch;
    if (!b || !sk) return;
    e.preventDefault();
    const id = b.dataset.con!, c = sk.cons.find((x) => x.id === id);
    if (!c) return;
    state.skSel = { kind: 'con', id }; state.skSels = [];
    refreshSketchStyles(sk); setOverlaySel();
    const items: MenuItem[] = [];
    if (isDim(c) && !c.driven) items.push({ label: 'Edit dimension', icon: 'dimension', act: () => startDimEdit(id) });
    items.push({ label: isDim(c) ? 'Delete dimension' : 'Delete constraint', icon: 'trash', danger: true, act: () => { state.skSel = { kind: 'con', id }; state.skSels = []; deleteSketchSel(); } });
    openMenu(items, e.clientX, e.clientY, b);
  });
  skOv.addEventListener('keydown', (e) => { const b = (e.target as HTMLElement).closest<HTMLElement>('.dimlbl'); if (b && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); startDimEdit(b.dataset.con!); } });
  // hovering a badge or dimension lights up the geometry it governs
  skOv.addEventListener('pointerover', (e) => {
    if (!state.sketch) return;
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-con]'), id = b ? b.dataset.con! : null;
    if (id !== state.skHoverCon) { state.skHoverCon = id; refreshSketchStyles(state.sketch); }
  });
  skOv.addEventListener('pointerout', (e) => {
    if (!state.sketch || lblDrag) return;
    const to = e.relatedTarget as HTMLElement | null;
    if (!(to && to.closest && to.closest('[data-con]')) && state.skHoverCon) { state.skHoverCon = null; refreshSketchStyles(state.sketch); }
  });
  // drag a dimension label to move its dimension line
  skOv.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.dimlbl');
    if (!b || e.button !== 0 || !state.sketch) return;
    if (dimEditing) closeDimEdit(true);
    lblDrag = { id: b.dataset.con!, x: e.clientX, y: e.clientY, moved: false, snap: snapshot(state.sketch) };
    try { b.setPointerCapture(e.pointerId); } catch { /* label was re-rendered */ }
  });
  skOv.addEventListener('pointermove', (e) => {
    if (!lblDrag) return;
    if (!lblDrag.moved && Math.hypot(e.clientX - lblDrag.x, e.clientY - lblDrag.y) < 3) return;
    lblDrag.moved = true;
    const sk = state.sketch;
    if (!sk || !sk.frame) return;
    setPointer(e);
    const w = planeHit(sk.frame);
    if (!w) return;
    const id = lblDrag.id;
    moveDim(sk, sk.cons.find((c) => c.id === id), toLocal(sk.frame, [w.x, w.y, w.z]));
    buildDimLines(sk);
  });
  skOv.addEventListener('pointerup', () => {
    if (!lblDrag) return;
    const d = lblDrag;
    lblDrag = null;
    if (d.moved && state.sketch) { pushHist(state.sketch, d.snap); lblDragEnd = performance.now(); markDirty(); }
  });

  dimInput.addEventListener('input', liveDim);
  dimInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); closeDimEdit(true); }
    else if (e.key === 'Escape') { e.preventDefault(); closeDimEdit(false); message('Change canceled'); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const sk = state.sketch, id = dimEditing && dimEditing.id;
      closeDimEdit(true);
      const dims = sk ? sk.cons.filter((c) => shownDim(c) && !c.driven) : [];
      if (dims.length) { const i = dims.findIndex((c) => c.id === id); startDimEdit(dims[(i + (e.shiftKey ? -1 : 1) + dims.length) % dims.length].id); }
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const cur = parseExpr(dimInput.value);
      if (cur !== null) { dimInput.value = fmt(cur + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * (getUnit() === 'in' && !dimIsAngle() ? 0.1 : 1)); liveDim(); }
    }
    e.stopPropagation();
  });
  dimInput.addEventListener('blur', () => { if (dimEditing) closeDimEdit(true); });

  on('theme', () => { if (state.sketch) refreshSketchStyles(state.sketch); });
  on('select', () => feats('sketch').forEach((s) => { if (s !== state.sketch) refreshSketchStyles(s); }));
}
