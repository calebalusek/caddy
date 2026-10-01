// Sketch tools: drawing (line, rectangle, circle, arc, polygon), snaps and object-snap tracking,
// constraints and dimensions, offset / move / trim, selection and dragging. Carried over from the
// prototype tool by tool so the behavior is the same.
import * as THREE from 'three';
import { fmtLen, fmtU, fromUser, unitName } from '../core/units';
import { $ } from '../core/dom';
import { fmt } from '../core/format';
import { parseExpr } from '../core/expr';
import { emit, on } from '../app/hub';
import { state, type SketchTool, type SkSel } from '../app/state';
import { toLocal } from '../model/frames';
import type { SketchFeature } from '../model/types';
import { mouse } from '../tools/pick';
import { message } from '../ui/message';
import { canvas, scene, V3, vp } from '../view/scene';
import { dimGeom, dimText } from './dimgeom';
import {
  buildChains, chainOf, closedSide, curveDist, curveOf, nearestOn, objectOf, offsetPolyline, removeOrphans, snapCands, trimPreviewPts, trimTarget,
  type SnapKind, type SnapScope, type TrimTarget,
} from './geom';
import {
  addLine, addPt, circlePts, cmap, conCurves, conPoints, curvePtIds, curvePts, d2, isDim, isEdgeCurve, newId, normAng, PT, restore, segDist, snapshot, usedPoints,
  type ArcCurve, type CircleCurve, type Constraint, type Curve, type LineCurve, type P2,
} from './model';
import { independent, lineInter, lineUnit, solveSketch } from './solver';
import { closeDimEdit, DofSentence, isDimEditing, pushHist, rebuildOverlay, setOverlaySel, skChanged, startDimEdit } from './session';
import { planeHit, refreshSketchStyles, skScale, toolMat, toScreen, trimMat, tw, worldPerPixel } from './visuals';

type Round = ArcCurve | CircleCurve;
/** Where the cursor is for a draw tool: the point, an existing point id if it landed on one, and the snap that put it there. */
interface Snap { p: P2; id: string | null; snapped: boolean; kind?: SnapKind; cv?: string; cv2?: string; invalid?: boolean; aligns?: { axis: 'x' | 'y'; ref: any }[]; from?: P2[]; d?: number }

const hud = $('#hud'), snapEl = $('#snap'), pickTip = $('#pickTip');
const DRAW_TOOLS = new Set(['line', 'rect', 'circle', 'polygon', 'arc']);
type HudField = { k: string; label: string; name: string; unit?: string };
const SIDES_FIELDS: HudField[] = [{ k: 'n', label: 'Sides', name: 'Number of sides', unit: '' }];
const TOOL_FIELDS: Record<string, HudField[]> = {
  arc: [{ k: 'r', label: 'R', name: 'Arc radius' }], polygon: [{ k: 'd', label: 'Ø', name: 'Polygon size' }], offset: [{ k: 'd', label: 'D', name: 'Offset distance' }],
  move: [{ k: 'x', label: 'ΔX', name: 'Move X' }, { k: 'y', label: 'ΔY', name: 'Move Y' }], rect: [{ k: 'w', label: 'W', name: 'Width' }, { k: 'h', label: 'H', name: 'Height' }],
  circle: [{ k: 'd', label: 'Ø', name: 'Diameter' }], line: [{ k: 'l', label: 'L', name: 'Length' }],
};
export const TOOL_NAMES: Record<string, string> = { align: 'Alignment', arc: 'Arc', trim: 'Trim', tangent: 'Tangent', midpt: 'Midpoint', ponl: 'Point on curve', ponc: 'Point on curve', polygon: 'Polygon', offset: 'Offset', move: 'Move', rect: 'Rectangle', circle: 'Circle', line: 'Line', dim: 'Dimension', hv: 'Horizontal/Vertical', perp: 'Perpendicular', par: 'Parallel', equal: 'Equal', fix: 'Fix', coincident: 'Coincident' };

const toolPreview = new THREE.Group();
scene.add(toolPreview);
const updatePrompt = (): void => emit('mode');
const SK = (): SketchFeature => state.sketch!;

// ---- starting and leaving tools ----
export function setTool(type: string): void {
  if (state.mode !== 'sketch' || !state.sketch) return;
  if (state.tool && state.tool.type === type) { exitTool(); return; }
  const pre = state.skSels.slice();
  cancelShape(true);
  closeDimEdit(true);
  const T: SketchTool = (state.tool = { type, pts: [], cur: null, start: null, picks: [], phase: null, inf: null, sel: [] });
  state.skSel = null; state.skSels = [];
  if (type === 'offset' || type === 'move') {
    T.sel = pre.filter((p) => (type === 'move' ? !(p.kind === 'point' && p.id === 'O') : p.kind === 'curve'));
    T.phase = 'select';
    if (T.sel.length) advanceSelect(true);
  }
  if (type === 'polygon') startPolygonSides(T);
  refreshSketchStyles(state.sketch);
  rebuildOverlay();
  canvas.style.cursor = DRAW_TOOLS.has(type) ? 'crosshair' : '';
  updatePrompt();
}
function startPolygonSides(T: SketchTool): void {
  T.phase = 'sides'; T.pts = [];
  showHud(SIDES_FIELDS);
  const inp = hud.querySelector<HTMLInputElement>('[data-k="n"]')!;
  inp.value = ''; inp.placeholder = 'sides'; inp.dataset.locked = '1';
  focusHud();
  updatePrompt();
}
function acceptSides(): boolean {
  const T = state.tool, inp = hud.querySelector<HTMLInputElement>('[data-k="n"]');
  if (!T || !inp) return !!(T && T.sides);
  const v = parseExpr(inp.value), n = v === null ? 0 : Math.round(v);
  if (!inp.value.trim()) { inp.classList.add('invalid'); message('Type how many sides the polygon has (3 to 64), then press Enter', 'warn'); inp.focus(); return false; }
  if (n < 3 || n > 64) { inp.classList.add('invalid'); message('A polygon needs 3 to 64 sides', 'warn'); inp.focus(); inp.select(); return false; }
  T.sides = n; state.polySides = n; T.phase = null;
  hideHud();
  updatePrompt();
  message(`${n} sides. Click the center point.`);
  return true;
}
export function advanceSelect(quiet?: boolean): void {
  const T = state.tool;
  if (!T) return;
  if (!T.sel.length) { message('Pick something first', 'warn'); return; }
  if (T.type === 'offset') { T.phase = 'place'; T.cur = state.skRaw || null; showHud(); focusHud(); updateToolPreview(); }
  else T.phase = 'base';
  if (state.sketch) refreshSketchStyles(state.sketch);
  updatePrompt();
  if (!quiet) message(T.type === 'offset' ? `${T.sel.length} curve${T.sel.length > 1 ? 's' : ''} picked. Move to a side and type a distance.` : 'Specify base point');
}
export function hudEnter(): void {
  const T = state.tool;
  if (!T) return;
  if (T.type === 'polygon' && T.phase === 'sides') { acceptSides(); return; }
  if (T.type === 'offset') { if (T.phase === 'place') commitOffset(); return; }
  if (T.type === 'move') { if (T.phase === 'dest') commitMove(); return; }
  commitShape();
}
export function exitTool(_quiet?: boolean): void {
  clearTracking();
  cancelShape(true);
  state.tool = null;
  snapEl.style.display = 'none';
  canvas.style.cursor = '';
  updatePrompt();
}
/** Hide the tool's on-screen helpers without leaving the tool. */
export function closeToolUi(): void { hideHud(); clearToolPreview(); snapEl.style.display = 'none'; }
export function cancelShape(_quiet?: boolean): void {
  const T = state.tool;
  if (!T) return;
  T.pts = []; T.start = null; T.picks = []; T.inf = null; T.base = null;
  if (T.type === 'offset' || T.type === 'move') { T.sel = []; T.phase = 'select'; }
  else T.phase = null;
  closeToolUi();
  if (!state.pick) { pickTip.style.display = 'none'; pickTip.classList.remove('bad'); }
  if (state.sketch) refreshSketchStyles(state.sketch);
  updatePrompt();
}
/** True while the tool is part-way through something (a shape started, items picked). */
export const toolBusy = (): boolean => { const T = state.tool; return !!T && ((T.pts && T.pts.length > 0) || (T.picks && T.picks.length > 0) || (T.sel && T.sel.length > 0)); };
export const hudShown = (): boolean => hud.classList.contains('show');

// ---- the value boxes that follow the cursor ----
function showHud(fields?: HudField[]): void {
  const T = state.tool!, f = fields || TOOL_FIELDS[T.type];
  hud.innerHTML = f.map((x) => `<label class="hf"><span>${x.label}</span><input data-k="${x.k}" inputmode="decimal"${x.unit === undefined ? ' data-len="1"' : ''} autocomplete="off" spellcheck="false" aria-label="${x.name}">${x.unit === '' ? '' : '<em' + (x.unit === undefined ? ' data-ul="1"' : '') + '>' + (x.unit || unitName()) + '</em>'}</label>`).join('')
    + (T.type === 'polygon' && !fields ? `<button type="button" class="hudtog" data-act="polymode" title="Switch between sizing to the corners or across the flats">${state.polyMode === 'flats' ? 'across flats' : 'to corners'}</button>` : '');
  hud.classList.add('show');
  positionHud();
}
function fillHud(vals: Record<string, number | undefined>): void {
  hud.querySelectorAll<HTMLInputElement>('input').forEach((inp) => {
    if (inp.dataset.locked) return;
    const v = vals[inp.dataset.k!];
    if (v == null || !isFinite(v)) return;
    inp.value = inp.dataset.len ? fmtLen(v) : fmt(v);
    if (document.activeElement === inp) inp.select();
  });
}
function hideHud(): void { hud.classList.remove('show'); hud.innerHTML = ''; }
function positionHud(): void {
  if (!hud.classList.contains('show')) return;
  const x = Math.min(mouse.x + 18, vp.clientWidth - 130), y = Math.min(mouse.y + 18, vp.clientHeight - 70);
  hud.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
function focusHud(): void { const inp = hud.querySelector<HTMLInputElement>('input:not([data-locked])') || hud.querySelector<HTMLInputElement>('input'); if (inp) { inp.focus({ preventScroll: true }); inp.select(); } }
/** A value the user typed (boxes they have not touched just follow the cursor). */
function hudVal(k: string, signed?: boolean): number | null {
  const inp = hud.querySelector<HTMLInputElement>(`[data-k="${k}"]`);
  if (!inp || !inp.dataset.locked) return null;
  const raw = parseExpr(inp.value), v = raw === null || !inp.dataset.len ? raw : fromUser(raw);
  return v === null ? null : signed ? v : Math.abs(v);
}
/** A number typed over the viewport goes into the first free value box. */
export function typeIntoHud(key: string): void {
  const inp = hud.querySelector<HTMLInputElement>('input:not([data-locked])') || hud.querySelector<HTMLInputElement>('input');
  if (!inp) return;
  inp.focus();
  inp.value = key;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
}

// ---- the shape being drawn ----
function toolShape(): any {
  const T = state.tool!, a: P2 = T.pts[0].p, c: P2 = (T.cur || T.pts[0]).p;
  if (T.type === 'rect') {
    let w = c[0] - a[0], h = c[1] - a[1];
    const W = hudVal('w'), H = hudVal('h');
    if (W !== null) w = (w < 0 ? -1 : 1) * W;
    if (H !== null) h = (h < 0 ? -1 : 1) * H;
    return { type: 'rect', a: a.slice(), b: [a[0] + w, a[1] + h], w: Math.abs(w), h: Math.abs(h) };
  }
  if (T.type === 'circle') { let r = d2(a, c); const D = hudVal('d'); if (D !== null) r = D / 2; return { type: 'circle', c: a.slice(), r, d: r * 2 }; }
  if (T.type === 'arc') {
    const s = T.pts[0].p as P2;
    if (T.pts.length < 2) return { type: 'arcline', a: s, b: c };
    const e = T.pts[1].p as P2, m = c, R = hudVal('r'), ch = d2(s, e), mid = [(s[0] + e[0]) / 2, (s[1] + e[1]) / 2];
    const nl = [-(e[1] - s[1]) / ch, (e[0] - s[0]) / ch], side = Math.sign((e[0] - s[0]) * (m[1] - s[1]) - (e[1] - s[1]) * (m[0] - s[0])) || 1;
    let q: P2, r: number, mp: P2;
    if (R !== null) {
      if (R < ch / 2 - 1e-9) return { type: 'arc', bad: true, a: s, b: e };
      const k = Math.sqrt(Math.max(0, R * R - (ch * ch) / 4));
      q = [mid[0] - nl[0] * side * k, mid[1] - nl[1] * side * k]; r = R;
      mp = [mid[0] + nl[0] * side * (R - k), mid[1] + nl[1] * side * (R - k)];
    } else {
      const ax = s[0], ay = s[1], bx = e[0], by = e[1], cx = m[0], cy = m[1], D = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
      if (Math.abs(D) < 1e-9 || d2(m, s) < 1e-6 || d2(m, e) < 1e-6) return { type: 'arc', bad: true, a: s, b: e };
      const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / D, uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / D;
      q = [ux, uy]; r = d2(q, s); mp = m;
    }
    const ang = (p: P2): number => Math.atan2(p[1] - q[1], p[0] - q[0]);
    const swap = normAng(ang(mp) - ang(s)) > normAng(ang(e) - ang(s));
    const from = swap ? e : s, to = swap ? s : e, a1 = ang(from), sw = normAng(ang(to) - a1) || Math.PI * 2, pts: P2[] = [];
    const n = Math.max(8, Math.ceil(sw / (Math.PI / 36)));
    for (let i = 0; i <= n; i++) { const t = a1 + (sw * i) / n; pts.push([q[0] + r * Math.cos(t), q[1] + r * Math.sin(t)]); }
    return { type: 'arc', q, r, swap, pts, a: s, b: e };
  }
  if (T.type === 'polygon') {
    const n = T.sides || state.polySides, flats = state.polyMode === 'flats', cosA = Math.cos(Math.PI / n);
    let rot = Math.atan2(c[1] - a[1], c[0] - a[0]);
    if (!T.free) rot = Math.round(rot / (Math.PI / 12)) * (Math.PI / 12);
    const D = hudVal('d'), dist = d2(a, c);
    const R = D !== null ? (flats ? D / 2 / cosA : D / 2) : flats ? dist / cosA : dist;
    const v0 = flats ? rot + Math.PI / n : rot;
    const pts: P2[] = [];
    for (let i = 0; i < n; i++) { const t = v0 + (i * 2 * Math.PI) / n; pts.push([a[0] + R * Math.cos(t), a[1] + R * Math.sin(t)]); }
    return { type: 'polygon', c: a.slice(), R, n, pts, flats, d: flats ? 2 * R * cosA : 2 * R };
  }
  let b = c.slice() as P2;
  const L = hudVal('l');
  if (L !== null) { const dx = c[0] - a[0], dy = c[1] - a[1], len = Math.hypot(dx, dy); const ux = len > 1e-9 ? dx / len : 1, uy = len > 1e-9 ? dy / len : 0; b = [a[0] + ux * L, a[1] + uy * L]; }
  return { type: 'line', a: a.slice(), b, l: d2(a, b) };
}
function clearToolPreview(): void {
  while (toolPreview.children.length) { const c = toolPreview.children[0] as THREE.Line; toolPreview.remove(c); c.geometry.dispose(); }
}
function previewLines(ptsList: P2[], loop: boolean): void {
  const f = SK().frame!, geo = new THREE.BufferGeometry().setFromPoints(ptsList.map((p) => tw(f, p[0], p[1], 0.09)));
  const obj = loop ? new THREE.LineLoop(geo, toolMat) : new THREE.Line(geo, toolMat);
  obj.renderOrder = 14;
  toolPreview.add(obj);
}
function updateToolPreview(): void {
  clearToolPreview();
  const T = state.tool;
  if (!T) return;
  const sk = SK();
  if (T.type === 'dim') {
    const c = T.picks.length && T.cur && !state.skHover ? pendingDim() : null;
    if (c) {
      const k = skScale(sk), dg = dimGeom(sk, c, cmap(sk), k);
      dg.segs.forEach((s) => previewLines(s, false));
      const s = toScreen(tw(sk.frame!, dg.label[0], dg.label[1]));
      pickTip.classList.remove('bad');
      pickTip.textContent = dimText(c);
      pickTip.style.display = 'block';
      pickTip.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px) translate(-50%,-50%)`;
    } else if (!state.pick) pickTip.style.display = 'none';
    return;
  }
  if (T.type === 'offset') {
    if (T.phase !== 'place') return;
    const plan = offsetPlan();
    if (!plan) return;
    plan.items.forEach((it) => (it.kind === 'circle' ? previewLines(circlePts(it.c, it.r, 72), true) : previewLines(it.pts, it.closed)));
    fillHud({ d: plan.d });
    return;
  }
  if (T.type === 'move') {
    if (T.phase !== 'dest' || !T.cur) return;
    const { dx, dy } = moveDelta(), M = cmap(sk);
    T.sel.forEach((it) => { if (it.kind !== 'curve') return; const c = M.get(it.id); if (!c) return; previewLines(curvePts(sk, c).map((p) => [p[0] + dx, p[1] + dy] as P2), c.type === 'circle'); });
    T.sel.forEach((it) => {
      if (it.kind !== 'point') return;
      const p = PT(sk, it.id), q = [p[0] + dx, p[1] + dy], s = 1.5 * skScale(sk);
      previewLines([[q[0] - s, q[1] - s], [q[0] + s, q[1] + s]], false); previewLines([[q[0] - s, q[1] + s], [q[0] + s, q[1] - s]], false);
    });
    previewLines([T.base, [T.base[0] + dx, T.base[1] + dy]], false);
    fillHud({ x: dx, y: dy });
    return;
  }
  if (!DRAW_TOOLS.has(T.type) || !T.pts.length) return;
  const s = toolShape();
  if (s.type === 'line' || s.type === 'arcline' || (s.type === 'arc' && s.bad)) previewLines([s.a, s.b], false);
  else if (s.type === 'arc') previewLines(s.pts, false);
  else if (s.type === 'rect') previewLines([[s.a[0], s.a[1]], [s.b[0], s.a[1]], [s.b[0], s.b[1]], [s.a[0], s.b[1]]], true);
  else if (s.type === 'polygon') previewLines(s.pts, true);
  else previewLines(circlePts(s.c, s.r, 72), true);
  fillHud({ w: s.w, h: s.h, d: s.d, l: s.l, r: s.r });
}

// ---- adding constraints ----
const CON_NAME: Record<string, string> = { align: 'Alignment', tangent: 'Tangent', midpt: 'Midpoint', ponl: 'Point on curve', ponc: 'Point on curve', horizontal: 'Horizontal', vertical: 'Vertical', perp: 'Perpendicular', par: 'Parallel', equal: 'Equal' };
const conName = (c: Constraint): string => (isDim(c) ? `the ${dimText(c)} dimension` : `the ${CON_NAME[c.type] || c.type} constraint`);
type NewCon = Omit<Constraint, 'id'> & { id?: string };

function rankWith(sk: SketchFeature, cons: Constraint[], con: Constraint): boolean {
  const saved = sk.cons;
  sk.cons = cons;
  const r = independent(sk, con);
  sk.cons = saved;
  return r;
}
/** Existing constraints that already do what a new one would (so the new one is redundant). */
function conflictsWith(sk: SketchFeature, con: Constraint): Constraint[] {
  const touch = new Set(conCurves(con).concat(conPoints(con))), out: Constraint[] = [];
  for (const c of sk.cons) {
    if (c.driven || c.type === 'fix' || c.type === 'fixr') continue;
    if (rankWith(sk, sk.cons.filter((x) => x !== c), con)) out.push(c);
  }
  const score = (c: Constraint): number => conCurves(c).concat(conPoints(c)).filter((id) => touch.has(id)).length;
  return out.sort((a, b) => score(b) - score(a));
}
function explainConflict(sk: SketchFeature, con: Constraint, what: string): void {
  const cs = conflictsWith(sk, con);
  if (!cs.length) { message(`${what} isn't needed: the sketch is already fully set there.`, 'warn'); return; }
  const c = cs[0];
  state.skSel = { kind: 'con', id: c.id }; state.skSels = [];
  refreshSketchStyles(sk); rebuildOverlay();
  const more = cs.length > 1 ? ` (${cs.length - 1} other constraint${cs.length > 2 ? 's' : ''} also fix this)` : '';
  message(`${what} isn't needed: ${conName(c)} already does that${more}. It's selected now; press Delete to remove it, then try again.`, 'warn');
}
/** Add a constraint unless it is redundant. Returns whether it was added. */
function addCon(sk: SketchFeature, con: NewCon, silent: boolean): boolean {
  con.id = newId(sk, 'k');
  if (!independent(sk, con as Constraint)) { if (!silent) explainConflict(sk, con as Constraint, CON_NAME[con.type] || 'That constraint'); return false; }
  sk.cons.push(con as Constraint);
  return true;
}

// Snapping only places the point exactly; it never adds constraints. The user adds those if they want them.
function attachSnap(_pid: string, _sn: Snap | null | undefined): void { /* no automatic constraints */ }
function flushSnaps(_sk: SketchFeature): void { /* no automatic constraints */ }
/** Dimension offset that puts a new length dimension on the outside of a shape. */
function offAway(sk: SketchFeature, lineId: string, center: P2): number {
  const l = curveOf(sk, lineId) as LineCurve, a = PT(sk, l.p1), b = PT(sk, l.p2);
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, n = [-dy / L, dx / L];
  const side = Math.sign((center[0] - a[0]) * n[0] + (center[1] - a[1]) * n[1]) || -1;
  return -side * 26 * skScale(sk);
}

export function commitShape(): void {
  const T = state.tool, sk = state.sketch;
  if (!T || !T.pts.length || !sk) return;
  const s = toolShape(), snap = snapshot(sk), typed = (k: string): boolean => hudVal(k) !== null, cur = T.cur || T.pts[0];
  let label = '', closed = false;
  if (s.type === 'rect') {
    if (s.w < 0.01 || s.h < 0.01) { message('Give the rectangle a width and a height', 'warn'); return; }
    const A = T.pts[0].id || addPt(sk, s.a[0], s.a[1]);
    if (!T.pts[0].id) attachSnap(A, T.pts[0].snap);
    const free = !typed('w') && !typed('h');
    const Cc = free && cur.id && cur.id !== A ? cur.id : addPt(sk, s.b[0], s.b[1]);
    if (free && !cur.id) attachSnap(Cc, cur.snap);
    const B = addPt(sk, s.b[0], s.a[1]), D = addPt(sk, s.a[0], s.b[1]);
    const l1 = addLine(sk, A, B), l2 = addLine(sk, B, Cc), l3 = addLine(sk, Cc, D), l4 = addLine(sk, D, A);
    addCon(sk, { type: 'horizontal', l: l1 }, true); addCon(sk, { type: 'vertical', l: l2 }, true); addCon(sk, { type: 'horizontal', l: l3 }, true); addCon(sk, { type: 'vertical', l: l4 }, true);
    const ctr: P2 = [(s.a[0] + s.b[0]) / 2, (s.a[1] + s.b[1]) / 2];
    if (typed('w')) addCon(sk, { type: 'length', l: l1, v: s.w, off: offAway(sk, l1, ctr) }, true);
    if (typed('h')) addCon(sk, { type: 'length', l: l2, v: s.h, off: offAway(sk, l2, ctr) }, true);
    label = `Rectangle ${fmt(s.w)} × ${fmtU(s.h)}`;
  } else if (s.type === 'circle') {
    if (s.r < 0.01) { message('Give the circle a size', 'warn'); return; }
    const Cn = T.pts[0].id || addPt(sk, s.c[0], s.c[1]);
    if (!T.pts[0].id) attachSnap(Cn, T.pts[0].snap);
    const id = newId(sk, 'c');
    sk.curves.push({ id, type: 'circle', c: Cn, r: s.r });
    if (typed('d')) addCon(sk, { type: 'diameter', c: id, v: s.d, ang: 0.785 }, true);
    label = `Circle Ø${fmtU(s.d)}`;
  } else if (s.type === 'arc' || s.type === 'arcline') {
    if (s.type === 'arcline') return;
    if (s.bad) { message(hudVal('r') !== null ? 'That radius is too small to reach both ends' : 'Move off the straight line to bend the arc', 'warn'); return; }
    const S = T.pts[0].id || addPt(sk, s.a[0], s.a[1]);
    if (!T.pts[0].id) attachSnap(S, T.pts[0].snap);
    const E = T.pts[1].id || addPt(sk, s.b[0], s.b[1]);
    if (!T.pts[1].id) attachSnap(E, T.pts[1].snap);
    const Q = addPt(sk, s.q[0], s.q[1]), id = newId(sk, 'a');
    sk.curves.push({ id, type: 'arc', c: Q, p1: s.swap ? E : S, p2: s.swap ? S : E, r: s.r });
    if (typed('r')) addCon(sk, { type: 'radius', c: id, v: s.r }, true);
    label = `Arc R${fmtU(s.r)}`;
  } else if (s.type === 'polygon') {
    if (s.R < 0.01) { message('Give the polygon a size', 'warn'); return; }
    // built on a construction circle: every corner rides on it and all sides are equal
    const Cn = T.pts[0].id || addPt(sk, s.c[0], s.c[1]), cid = newId(sk, 'c');
    sk.curves.push({ id: cid, type: 'circle', c: Cn, r: s.R, construction: true });
    const vids: string[] = s.pts.map((p: P2) => addPt(sk, p[0], p[1])), lids = vids.map((v, i) => addLine(sk, v, vids[(i + 1) % vids.length]));
    vids.forEach((v) => addCon(sk, { type: 'ponc', p: v, c: cid, quiet: true }, true));
    for (let i = 1; i < lids.length; i++) addCon(sk, { type: 'equal', a: lids[0], b: lids[i], quiet: true }, true);
    if (typed('d')) {
      if (s.flats) { const a = s.pts[0], b = s.pts[1], dx = b[0] - a[0], dy = b[1] - a[1], sd = dx * (s.c[1] - a[1]) - dy * (s.c[0] - a[0]); addCon(sk, { type: 'flats', c: cid, l: lids[0], sgn: Math.sign(sd) || 1, v: s.d }, true); }
      else addCon(sk, { type: 'diameter', c: cid, v: s.d, ang: 0.785 }, true);
    }
    label = `${s.n}-sided polygon, ${fmtU(s.d)} ${s.flats ? 'across flats' : 'across corners'}`;
  } else {
    if (s.l < 0.01) { message('Move away from the start point or type a length', 'warn'); return; }
    const P1 = T.pts[0].id || addPt(sk, s.a[0], s.a[1]);
    if (!T.pts[0].id) attachSnap(P1, T.pts[0].snap);
    const P2_ = !typed('l') && cur.id && cur.id !== P1 ? cur.id : addPt(sk, s.b[0], s.b[1]);
    if (!typed('l') && !cur.id) attachSnap(P2_, cur.snap);
    const l = addLine(sk, P1, P2_);
    if (typed('l')) addCon(sk, { type: 'length', l, v: s.l, off: 26 * skScale(sk) }, true);
    if (!T.start.id) T.start.id = P1;
    closed = P2_ === T.start.id;
    label = `Line ${fmtU(s.l)}`;
    T.lastEnd = P2_;
  }
  flushSnaps(sk);
  pushHist(sk, snap);
  solveSketch(sk);
  skChanged(sk);
  if (s.type === 'line' && !closed) {
    // keep drawing from the end of the line just placed
    const P2_ = T.lastEnd as string;
    T.pts = [{ p: PT(sk, P2_), id: P2_ }]; T.cur = T.pts[0]; T.inf = null;
    showHud(); updateToolPreview(); focusHud();
    message(label + ' added', 'ok');
  } else {
    T.pts = []; T.start = null;
    hideHud(); clearToolPreview();
    message(closed ? 'Closed shape. The line tool is still active.' : label + ' added', 'ok');
    if (T.type === 'polygon') startPolygonSides(T);
  }
  updatePrompt();
}

// ---- snaps ----
const SNAP_INFO: Record<SnapKind, { label: string; pri: number; svg: string }> = {
  end: { label: 'Endpoint', pri: 1, svg: '<rect x="2" y="2" width="10" height="10"/>' },
  center: { label: 'Center', pri: 1, svg: '<circle cx="7" cy="7" r="5"/>' },
  origin: { label: 'Origin', pri: 1, svg: '<circle cx="7" cy="7" r="5"/><path d="M7 1v12M1 7h12"/>' },
  mid: { label: 'Midpoint', pri: 2, svg: '<path d="M7 1.5L12.8 12H1.2z"/>' },
  int: { label: 'Intersection', pri: 3, svg: '<path d="M2 2l10 10M12 2L2 12"/>' },
  quad: { label: 'Quadrant', pri: 4, svg: '<path d="M7 1l6 6-6 6-6-6z"/>' },
  near: { label: 'Nearest', pri: 9, svg: '<path d="M2 2h10L2 12h10z"/>' },
  track: { label: 'Tracking', pri: 8, svg: '<path d="M3 7h8M7 3v8"/>' },
  track2: { label: 'Tracking intersection', pri: 8, svg: '<path d="M3 7h8M7 3v8"/><circle cx="7" cy="7" r="5"/>' },
};
function snapPoint(sk: SketchFeature, raw: P2, e: { shiftKey: boolean } | null, scope?: SnapScope | null): Snap {
  const pxDist = (p: P2): number => { const s = toScreen(tw(sk.frame!, p[0], p[1])); return Math.hypot(s.x - mouse.x, s.y - mouse.y); };
  let best: (Snap & { pri: number; d: number }) | null = null;
  snapCands(sk, scope, sk.ext).forEach((c) => {
    const d = pxDist(c.p);
    if (d > 12) return;
    const pri = SNAP_INFO[c.kind].pri;
    if (!best || pri < best.pri || (pri === best.pri && d < best.d)) best = { p: c.p, id: c.id || null, snapped: true, kind: c.kind, cv: c.cv, cv2: c.cv2, d, pri };
  });
  if (best) { const b = best as Snap; return { p: [b.p[0], b.p[1]], id: b.id || null, snapped: true, kind: b.kind, cv: b.cv, cv2: b.cv2 }; }
  if (!scope && state.track.length) { const tr = trackSnap(sk, raw, e); if (tr) return tr; }
  const n = nearestOn(sk, raw, scope);
  if (n && pxDist(n.p) < (scope ? 14 : 8)) return { p: [n.p[0], n.p[1]], id: null, snapped: true, kind: 'near', cv: n.cv };
  if (scope) return { p: raw, id: null, snapped: false, invalid: true };
  if (e && e.shiftKey) return { p: raw, id: null, snapped: false };
  return { p: [Math.round(raw[0]), Math.round(raw[1])], id: null, snapped: false }; // whole millimeters
}

// ---- object snap tracking (like AutoCAD OTRACK): hover a snap to acquire it, then follow its guides ----
function trackSnap(sk: SketchFeature, raw: P2, e: { shiftKey: boolean } | null): Snap | null {
  const k = skScale(sk), T = state.track;
  let best: Snap | null = null;
  for (let i = 0; i < T.length; i++) for (let j = 0; j < T.length; j++) {
    if (i === j) continue;
    const p: P2 = [T[i].p[0], T[j].p[1]], d = d2(p, raw) / k;
    if (d < 10 && (!best || d < best.d!)) best = { d, p, kind: 'track2', aligns: [{ axis: 'x', ref: T[i].ref }, { axis: 'y', ref: T[j].ref }], from: [T[i].p, T[j].p], id: null, snapped: true };
  }
  if (best) return best;
  const g = (v: number): number => (e && e.shiftKey ? v : Math.round(v));
  T.forEach((t) => {
    const dx = Math.abs(raw[0] - t.p[0]) / k, dy = Math.abs(raw[1] - t.p[1]) / k;
    if (dx < 7 && (!best || dx < best.d!)) best = { d: dx, p: [t.p[0], g(raw[1])], kind: 'track', aligns: [{ axis: 'x', ref: t.ref }], from: [t.p], id: null, snapped: true };
    if (dy < 7 && (!best || dy < best.d!)) best = { d: dy, p: [g(raw[0]), t.p[1]], kind: 'track', aligns: [{ axis: 'y', ref: t.ref }], from: [t.p], id: null, snapped: true };
  });
  return best;
}
const TRACKABLE = new Set<SnapKind | undefined>(['end', 'mid', 'center', 'origin', 'quad', 'int']);
const dwell: { key: string | null; timer: ReturnType<typeof setTimeout> | undefined } = { key: null, timer: undefined };
function trackDwell(sk: SketchFeature, sn: Snap): void {
  const key = sn && sn.snapped && TRACKABLE.has(sn.kind) ? sn.kind + ':' + sn.p.map((v) => v.toFixed(4)).join(',') : null;
  if (key === dwell.key) return;
  clearTimeout(dwell.timer);
  dwell.key = key;
  if (!key) return;
  const snap = Object.assign({}, sn, { p: sn.p.slice() as P2 });
  dwell.timer = setTimeout(() => {
    if (dwell.key !== key || state.sketch !== sk) return;
    const i = state.track.findIndex((t) => t.key === key);
    if (i >= 0) { state.track.splice(i, 1); message('Tracking point released'); }
    else {
      const cv = snap.cv ? sk.curves.find((c) => c.id === snap.cv) : null;
      const ref = snap.id ? { kind: 'pt' as const, id: snap.id } : snap.kind === 'mid' && cv && cv.type === 'line' ? { kind: 'mid' as const, l: cv.id } : null;
      state.track.push({ key, p: snap.p, ref });
      if (state.track.length > 4) state.track.shift();
      message(state.track.length > 1 ? 'Tracking points acquired. Move to where their guides cross (or along one) and click.' : 'Tracking point acquired: move straight across or up/down to follow its guide. Hover another point to add a second guide.');
    }
    drawTracking(sk, null);
  }, 380);
}
const trackGroup = new THREE.Group();
scene.add(trackGroup);
const trackLineMat = new THREE.LineDashedMaterial({ depthTest: false, transparent: true, dashSize: 1.5, gapSize: 1.2, color: 0x1fc46b });
const trackMarkMat = new THREE.LineBasicMaterial({ depthTest: false, transparent: true, color: 0x1fc46b });
function drawTracking(sk: SketchFeature | null, sn: Snap | null): void {
  while (trackGroup.children.length) { const c = trackGroup.children[0] as THREE.Line; trackGroup.remove(c); c.geometry.dispose(); }
  if (!sk || !sk.frame || !state.track.length) return;
  const k = skScale(sk), W = (x: number, y: number): V3 => tw(sk.frame!, x, y, 0.15), s = 5 * k;
  const marks: V3[] = [];
  state.track.forEach((t) => { const [x, y] = t.p; marks.push(W(x - s, y), W(x + s, y), W(x, y - s), W(x, y + s)); });
  const m = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(marks), trackMarkMat);
  m.renderOrder = 18;
  trackGroup.add(m);
  if (sn && sn.from) {
    trackLineMat.dashSize = 6 * k; trackLineMat.gapSize = 4 * k;
    sn.from.forEach((f) => {
      const dx = sn.p[0] - f[0], dy = sn.p[1] - f[1], L = Math.hypot(dx, dy) || 1, ext = 40 * k;
      const a = [f[0] - (dx / L) * ext, f[1] - (dy / L) * ext], b = [sn.p[0] + (dx / L) * ext, sn.p[1] + (dy / L) * ext];
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([W(a[0], a[1]), W(b[0], b[1])]), trackLineMat);
      l.computeLineDistances();
      l.renderOrder = 18;
      trackGroup.add(l);
    });
  }
}
export function clearTracking(): void { state.track = []; clearTimeout(dwell.timer); dwell.key = null; drawTracking(null, null); }
function showSnapMarker(sk: SketchFeature, sn: Snap | null): void {
  if (!sn || !sn.snapped || !sn.kind) { snapEl.style.display = 'none'; return; }
  const sp = toScreen(tw(sk.frame!, sn.p[0], sn.p[1])), info = SNAP_INFO[sn.kind];
  if (snapEl.dataset.kind !== sn.kind) { snapEl.innerHTML = `<svg viewBox="0 0 14 14">${info.svg}</svg><span>${info.label}</span>`; snapEl.dataset.kind = sn.kind; }
  snapEl.style.display = 'block';
  snapEl.style.transform = `translate(${Math.round(sp.x)}px, ${Math.round(sp.y)}px)`;
}

// ---- what is under the cursor ----
export function hitSketch(sk: SketchFeature, raw: P2, w: V3): SkSel | null {
  let best: SkSel | null = null, bd = 9;
  [...usedPoints(sk), 'O'].forEach((id) => {
    const p = sk.pts[id], s = toScreen(tw(sk.frame!, p.x, p.y)), d = Math.hypot(s.x - mouse.x, s.y - mouse.y);
    if (d < bd) { bd = d; best = { kind: 'point', id }; }
  });
  if (best) return best;
  const thr = worldPerPixel(w) * 7;
  let bc: SkSel | null = null, bcd = thr;
  sk.curves.forEach((c) => { const d = curveDist(sk, c, raw); if (d < bcd) { bcd = d; bc = { kind: 'curve', id: c.id }; } });
  return bc;
}
const pickKind = (sk: SketchFeature, p: SkSel): string => (p.kind === 'point' ? 'point' : curveOf(sk, p.id)!.type);
function canExtend(picks: SkSel[], h: SkSel | null): boolean {
  const sk = SK();
  if (!h || picks.length !== 1) return false;
  const a = pickKind(sk, picks[0]), b = pickKind(sk, h);
  if (a === 'circle' || b === 'circle' || a === 'arc' || b === 'arc') return false;
  if (h.kind === picks[0].kind && h.id === picks[0].id) return false;
  return true;
}
/** Only things the current tool can use light up and can be clicked. */
function validHit(h: SkSel | null): SkSel | null {
  const T = state.tool;
  if (!h) return null;
  const sk = SK();
  if (!T) return h;
  const isLine = h.kind === 'curve' && curveOf(sk, h.id)!.type === 'line';
  switch (T.type) {
    case 'hv': case 'perp': case 'par': return isLine ? h : null;
    case 'equal':
      if (h.kind !== 'curve') return null;
      if (T.picks.length) { const first = curveOf(sk, T.picks[0].id)!, cur = curveOf(sk, h.id)!; return (first.type === 'line') === (cur.type === 'line') && h.id !== first.id ? h : null; }
      return h;
    case 'tangent':
      if (h.kind !== 'curve') return null;
      if (T.picks.length) { const first = curveOf(sk, T.picks[0].id)!, cur = curveOf(sk, h.id)!; return h.id !== first.id && !(first.type === 'line' && cur.type === 'line') ? h : null; }
      return h;
    case 'midpt':
      if (!T.picks.length) return (h.kind === 'point' && h.id !== 'O') || isLine ? h : null;
      return T.picks[0].kind === 'point' ? (isLine ? h : null) : h.kind === 'point' ? h : null;
    case 'trim': return h.kind === 'curve' ? h : null;
    case 'fix': return h.kind === 'point' && h.id === 'O' ? null : h;
    case 'coincident':
      if (!T.picks.length) return h.kind === 'point' ? h : null;
      return h.kind === 'point' || !curvePtIds(curveOf(sk, h.id)!).includes(T.picks[0].id) ? h : null;
    case 'dim': return T.picks.length ? (canExtend(T.picks, h) ? h : null) : h;
    case 'offset': return h.kind === 'curve' ? h : null;
    case 'move': return h.kind === 'point' && h.id === 'O' ? null : h;
  }
  return null;
}

/** Mouse moved over the sketch being edited. */
export function sketchMove(e: PointerEvent | MouseEvent): void {
  const sk = SK();
  if (!sk.frame) return;
  const w = planeHit(sk.frame);
  if (!w) return;
  const raw = toLocal(sk.frame, [w.x, w.y, w.z]), T = state.tool;
  state.skRaw = raw;
  const showSnap = (sn: Snap | null): void => showSnapMarker(sk, sn);
  const hoverWith = (h: SkSel | null, cur: string): void => {
    if (JSON.stringify(h) !== JSON.stringify(state.skHover)) { state.skHover = h; refreshSketchStyles(sk); }
    canvas.style.cursor = h ? 'pointer' : cur;
  };
  if (T && T.type === 'trim') {
    const h = validHit(hitSketch(sk, raw, w));
    hoverWith(null, h ? 'pointer' : '');
    clearToolPreview();
    T.target = h && h.kind === 'curve' ? trimTarget(sk, h.id, raw) : null;
    if (T.target) {
      // the piece that will go, in red
      const obj = new THREE.Line(new THREE.BufferGeometry().setFromPoints(trimPreviewPts(sk, T.target).map((p) => tw(sk.frame!, p[0], p[1], 0.12))), trimMat);
      obj.computeLineDistances();
      obj.renderOrder = 15;
      toolPreview.add(obj);
    }
    return;
  }
  if (T && T.type === 'offset') {
    if (T.phase === 'select') { hoverWith(validHit(hitSketch(sk, raw, w)), ''); return; }
    hoverWith(null, 'crosshair');
    T.cur = raw;
    updateToolPreview(); positionHud();
    return;
  }
  if (T && T.type === 'move') {
    if (T.phase === 'select') { hoverWith(validHit(hitSketch(sk, raw, w)), ''); return; }
    if (T.phase === 'base') {
      const sn = snapPoint(sk, raw, e, moveScope(T.sel));
      showSnap(sn);
      hoverWith(null, sn.invalid ? 'not-allowed' : 'crosshair');
      T.cur = sn.invalid ? null : sn.p;
      if (sn.invalid) {
        pickTip.classList.add('bad');
        pickTip.textContent = 'Base point must be on the selected objects';
        pickTip.style.display = 'block';
        pickTip.style.transform = `translate(${Math.round(mouse.x + 14)}px, ${Math.round(mouse.y + 20)}px)`;
      } else if (!state.pick) pickTip.style.display = 'none';
      return;
    }
    const sn = snapPoint(sk, raw, e);
    T.cur = sn.p;
    showSnap(sn);
    hoverWith(null, 'crosshair');
    trackDwell(sk, sn); drawTracking(sk, sn);
    updateToolPreview(); positionHud();
    return;
  }
  if (T && DRAW_TOOLS.has(T.type)) {
    const sn = snapPoint(sk, raw, e);
    let p = sn.p;
    T.inf = null; T.free = e.shiftKey;
    trackDwell(sk, sn); drawTracking(sk, sn);
    // a nearly level or nearly upright line becomes exactly horizontal or vertical
    if (T.type === 'line' && T.pts.length && !sn.snapped) {
      const a = T.pts[0].p, dx = p[0] - a[0], dy = p[1] - a[1];
      if (Math.abs(dy) < Math.abs(dx) * 0.05) { p = [p[0], a[1]]; T.inf = 'h'; }
      else if (Math.abs(dx) < Math.abs(dy) * 0.05) { p = [a[0], p[1]]; T.inf = 'v'; }
    }
    T.cur = { p, id: sn.snapped ? sn.id : null, snap: sn.snapped && !T.inf ? sn : null };
    showSnap(sn.snapped ? Object.assign({}, sn, { p }) : sn);
    canvas.style.cursor = 'crosshair';
    updateToolPreview(); positionHud();
    return;
  }
  if (T && T.type === 'dim' && T.picks.length) {
    T.cur = raw;
    const h = validHit(hitSketch(sk, raw, w));
    if (JSON.stringify(h) !== JSON.stringify(state.skHover)) { state.skHover = h; refreshSketchStyles(sk); }
    canvas.style.cursor = h ? 'pointer' : 'crosshair';
    updateToolPreview();
    return;
  }
  const h = validHit(hitSketch(sk, raw, w));
  if (JSON.stringify(h) !== JSON.stringify(state.skHover)) { state.skHover = h; refreshSketchStyles(sk); }
  canvas.style.cursor = h ? (!T && h.kind === 'point' && h.id !== 'O' ? 'move' : 'pointer') : '';
}

/** Click (no drag) in the sketch being edited. */
export function sketchClick(e: PointerEvent): void {
  sketchMove(e);
  const T = state.tool, sk = SK();
  if (T && (T.type === 'offset' || T.type === 'move')) { modifyClick(e); return; }
  if (T && T.type === 'trim') { if (T.target) applyTrim(T.target); else message('Click the part of a curve you want to remove'); return; }
  if (T && DRAW_TOOLS.has(T.type)) {
    if (T.type === 'polygon' && T.phase === 'sides' && !acceptSides()) return;
    setTimeout(clearTracking, 0);
    if (!T.pts.length) {
      if (!T.cur) return;
      T.pts = [{ p: T.cur.p.slice(), id: T.cur.id, snap: T.cur.snap }];
      if (T.type === 'line') T.start = { id: T.cur.id };
      if (T.type !== 'arc') { showHud(); focusHud(); }
      updateToolPreview(); updatePrompt();
    } else if (T.type === 'arc' && T.pts.length === 1) {
      if (!T.cur || d2(T.cur.p, T.pts[0].p) < 1e-6) return;
      T.pts.push({ p: T.cur.p.slice(), id: T.cur.id, snap: T.cur.snap });
      showHud(); focusHud(); updateToolPreview(); updatePrompt();
    } else commitShape();
    return;
  }
  if (T) { constraintToolClick(); return; }
  const h = state.skHover;
  if (e.shiftKey) {
    if (h) { const i = state.skSels.findIndex((x) => x.kind === h.kind && x.id === h.id); if (i >= 0) state.skSels.splice(i, 1); else state.skSels.push(h); }
  } else state.skSels = h ? [h] : [];
  state.skSel = state.skSels[state.skSels.length - 1] || null;
  refreshSketchStyles(sk); setOverlaySel();
  const n = state.skSels.length;
  if (n > 1) message(`${n} items selected. Delete removes them, of offsets them, m moves them. Shift+click adds or removes.`);
  else if (n === 1) message(describeSel(sk, state.skSel!) + ' selected. Shift+click to add more. Delete removes it; drag to move.');
}

function modifyClick(e: PointerEvent): void {
  const T = state.tool!, sk = SK(), h = state.skHover;
  if (T.phase === 'select') {
    if (!h) { if (T.sel.length) message('Press Enter to continue with what you picked, or click more.'); return; }
    const items = T.type === 'offset' ? chainOf(sk, h.id) : objectOf(sk, h);
    const has = (it: SkSel): boolean => T.sel.some((x) => x.kind === it.kind && x.id === it.id);
    if (e.shiftKey) {
      if (items.every(has)) T.sel = T.sel.filter((x) => !items.some((it) => it.kind === x.kind && it.id === x.id));
      else items.forEach((it) => { if (!has(it)) T.sel.push(it); });
      refreshSketchStyles(sk); updatePrompt();
      message(`${T.sel.length} picked. Shift+click for more, Enter to continue.`);
      return;
    }
    items.forEach((it) => { if (!has(it)) T.sel.push(it); });
    advanceSelect();
    return;
  }
  if (T.type === 'offset') { commitOffset(); return; }
  if (T.phase === 'base') {
    if (!T.cur) { message('Pick the base point on the selected objects: an endpoint, midpoint, center, or anywhere along them', 'warn'); return; }
    pickTip.style.display = 'none';
    T.base = T.cur.slice(); T.phase = 'dest';
    showHud(); focusHud(); updateToolPreview(); updatePrompt();
    message('Specify second point, or type ΔX and ΔY');
    return;
  }
  if (T.phase === 'dest') { commitMove(); clearTracking(); }
}

export function describeSel(sk: SketchFeature, s: SkSel): string {
  if (s.kind === 'point') return s.id === 'O' ? 'Sketch origin' : 'Point';
  if (s.kind === 'curve') {
    const c = curveOf(sk, s.id)!;
    return c.type === 'line' ? `Line ${fmtU(d2(PT(sk, c.p1), PT(sk, c.p2)))}` : c.type === 'arc' ? `Arc R${fmtU(c.r)}` : `Circle Ø${fmtU(c.r * 2)}`;
  }
  const c = sk.cons.find((x) => x.id === s.id);
  return c ? (isDim(c) ? (c.driven ? 'Reference dimension ' : 'Dimension ') + dimText(c) : TOOL_NAMES[c.type === 'horizontal' || c.type === 'vertical' ? 'hv' : c.type] + ' constraint') : 'Item';
}

function tryConstraint(con: NewCon, okMsg?: string): boolean {
  const sk = SK(), snap = snapshot(sk);
  if (!addCon(sk, con, false)) return false;
  if (!solveSketch(sk)) { restore(sk, snap); skChanged(sk); message("That constraint can't be satisfied with the others, so it was not added.", 'warn'); return false; }
  pushHist(sk, snap);
  skChanged(sk);
  if (okMsg) message(okMsg + '. ' + DofSentence(sk) + '.', 'ok');
  return true;
}

function constraintToolClick(): void {
  const T = state.tool!, sk = SK(), h = state.skHover;
  if (T.type === 'dim') {
    if (!T.picks.length) { if (!h) return; T.picks = [h]; T.cur = state.skRaw || null; state.skHover = null; refreshSketchStyles(sk); updateToolPreview(); updatePrompt(); return; }
    if (h && canExtend(T.picks, h)) { T.picks.push(h); state.skHover = null; refreshSketchStyles(sk); updateToolPreview(); updatePrompt(); return; }
    const con = pendingDim();
    if (!con) { message(T.picks.length === 1 ? 'Click a second point, or a line' : "Those can't be dimensioned together", 'warn'); return; }
    T.picks = []; T.cur = null;
    clearToolPreview();
    pickTip.style.display = 'none';
    refreshSketchStyles(sk); updatePrompt();
    addDimension(con);
    return;
  }
  if (!h) return;
  if (T.type === 'hv') {
    const l = curveOf(sk, h.id) as LineCurve, a = PT(sk, l.p1), b = PT(sk, l.p2);
    const type = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 'horizontal' : 'vertical';
    tryConstraint({ type, l: h.id }, type === 'horizontal' ? 'Line made horizontal' : 'Line made vertical');
  } else if (T.type === 'perp' || T.type === 'par' || T.type === 'equal') {
    if (!T.picks.length) { T.picks = [h]; refreshSketchStyles(sk); updatePrompt(); return; }
    const first = T.picks[0];
    T.picks = [];
    tryConstraint({ type: T.type, a: first.id, b: h.id }, T.type === 'perp' ? 'Lines made perpendicular' : T.type === 'par' ? 'Lines made parallel' : 'Made equal');
    refreshSketchStyles(sk); updatePrompt();
  } else if (T.type === 'tangent' || T.type === 'midpt') {
    if (!T.picks.length) { T.picks = [h]; refreshSketchStyles(sk); updatePrompt(); return; }
    const first = T.picks[0];
    T.picks = [];
    if (T.type === 'midpt') { const p = first.kind === 'point' ? first.id : h.id, l = first.kind === 'point' ? h.id : first.id; tryConstraint({ type: 'midpt', p, l }, 'Point centered on the line'); }
    else {
      let A = curveOf(sk, first.id)!, B = curveOf(sk, h.id)!;
      if (B.type === 'line') { const t = A; A = B; B = t; }
      const con: NewCon = { type: 'tangent', a: A.id, b: B.id };
      if (A.type === 'line') { const a = PT(sk, A.p1), b = PT(sk, A.p2), q = PT(sk, (B as Round).c), sd = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]); con.sgn = Math.sign(sd) || 1; }
      else { const Ar = A as Round, Br = B as Round, D = d2(PT(sk, Ar.c), PT(sk, Br.c)); con.inner = D < Math.max(Ar.r, Br.r); con.sgn = Math.sign(Ar.r - Br.r) || 1; }
      tryConstraint(con, 'Made tangent');
    }
    refreshSketchStyles(sk); updatePrompt();
  } else if (T.type === 'fix') toggleFix(h);
  else if (T.type === 'coincident') {
    if (!T.picks.length) { T.picks = [h]; refreshSketchStyles(sk); updatePrompt(); return; }
    const keep = T.picks[0].id;
    T.picks = [];
    if (h.kind === 'point') mergePoints(keep, h.id);
    else { const cv = curveOf(sk, h.id)!; tryConstraint(cv.type === 'line' ? { type: 'ponl', p: keep, l: cv.id } : { type: 'ponc', p: keep, c: cv.id }, 'Point placed on the curve'); }
    refreshSketchStyles(sk); updatePrompt();
  }
}

// ---- offset ----
type OffsetItem = { kind: 'chain'; pts: P2[]; closed: boolean; lines: LineCurve[] } | { kind: 'circle'; src: string; s: number; r: number; c: P2 };
function offsetPlan(): { d: number; items: OffsetItem[]; typed: boolean } | null {
  const T = state.tool!, sk = SK(), cur = T.cur as P2 | null;
  if (!cur) return null;
  const M = cmap(sk), curves = T.sel.filter((i) => i.kind === 'curve').map((i) => M.get(i.id)).filter(Boolean) as Curve[];
  const lines = curves.filter((c): c is LineCurve => c.type === 'line'), circles = curves.filter((c): c is CircleCurve => c.type === 'circle');
  let dmin = Infinity;
  lines.forEach((l) => { dmin = Math.min(dmin, segDist(cur, PT(sk, l.p1), PT(sk, l.p2))); });
  circles.forEach((c) => { dmin = Math.min(dmin, Math.abs(d2(cur, PT(sk, c.c)) - c.r)); });
  const typed = hudVal('d'), d = typed !== null ? typed : Math.max(0.5, Math.round(dmin * 2) / 2);
  const items: OffsetItem[] = [];
  buildChains(sk, lines).forEach((ch) => {
    const P = ch.ids.map((id) => PT(sk, id));
    let s: number;
    if (ch.closed) s = closedSide(cur, P);
    else {
      let best = 0, bd = Infinity;
      for (let i = 0; i < P.length - 1; i++) { const dd = segDist(cur, P[i], P[i + 1]); if (dd < bd) { bd = dd; best = i; } }
      const a = P[best], b = P[best + 1];
      s = Math.sign((b[0] - a[0]) * (cur[1] - a[1]) - (b[1] - a[1]) * (cur[0] - a[0])) || 1;
    }
    items.push({ kind: 'chain', pts: offsetPolyline(P, ch.closed, s * d), closed: ch.closed, lines: ch.ls });
  });
  circles.forEach((c) => { const q = PT(sk, c.c), s = d2(cur, q) > c.r ? 1 : -1, r = c.r + s * d; if (r > 1e-3) items.push({ kind: 'circle', src: c.id, s, r, c: q }); });
  return { d, items, typed: typed !== null };
}
function commitOffset(): void {
  const T = state.tool!, sk = SK(), plan = offsetPlan();
  if (!plan || !plan.items.length) { message("Nothing to offset there (a circle can't shrink past its center)", 'warn'); return; }
  const snap = snapshot(sk), M = cmap(sk);
  let mainId: string | null = null;
  // one dimension drives the offset; the rest follow it
  const link = (con: NewCon): void => { if (mainId) con.ref = mainId; if (addCon(sk, con, true) && !mainId) mainId = con.id!; };
  plan.items.forEach((it) => {
    if (it.kind === 'circle') {
      const src = M.get(it.src) as CircleCurve, id = newId(sk, 'c');
      sk.curves.push({ id, type: 'circle', c: src.c, r: it.r, construction: src.construction || undefined });
      link({ type: 'coff', c: id, src: it.src, s: it.s, v: plan.d, ang: 0.5 });
    } else {
      const ids = it.pts.map((p) => addPt(sk, p[0], p[1])), n = ids.length, m = it.closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const nl = addLine(sk, ids[i], ids[(i + 1) % n]), L = it.lines[i];
        if (L.construction) curveOf(sk, nl)!.construction = true;
        addCon(sk, { type: 'par', a: nl, b: L.id }, true);
        const a = PT(sk, L.p1), u = lineUnit(sk, L), p = PT(sk, ids[i]), dd = u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0]);
        link({ type: 'pldist', p: ids[i], l: L.id, sgn: Math.sign(dd) || 1, v: plan.d, off: 0 });
      }
    }
  });
  if (!solveSketch(sk)) { restore(sk, snap); skChanged(sk); message("That offset doesn't work with the current constraints", 'warn'); return; }
  pushHist(sk, snap);
  T.sel = []; T.phase = 'select'; T.cur = null;
  hideHud(); clearToolPreview();
  skChanged(sk);
  message(`Offset ${fmtU(plan.d)}. Pick more to offset, or Esc to finish.`, 'ok');
  if (!plan.typed && mainId) startDimEdit(mainId);
  updatePrompt();
}

// ---- move ----
function moveScope(sel: SkSel[]): SnapScope {
  const s: SnapScope = { curves: new Set(), points: new Set() };
  sel.forEach((it) => (it.kind === 'curve' ? s.curves : s.points).add(it.id));
  return s;
}
function moveDelta(): { dx: number; dy: number } {
  const T = state.tool!, X = hudVal('x', true), Y = hudVal('y', true);
  return { dx: X !== null ? X : T.cur ? T.cur[0] - T.base[0] : 0, dy: Y !== null ? Y : T.cur ? T.cur[1] - T.base[1] : 0 };
}
function commitMove(): void {
  const T = state.tool!, sk = SK();
  if (!T.base) return;
  const { dx, dy } = moveDelta();
  if (Math.hypot(dx, dy) < 1e-9) { message('Base point and second point are the same', 'warn'); return; }
  const snap = snapshot(sk), M = cmap(sk);
  const curves = T.sel.filter((i) => i.kind === 'curve').map((i) => M.get(i.id)).filter(Boolean) as Curve[];
  const moved = new Set(T.sel.filter((i) => i.kind === 'point').map((i) => i.id));
  curves.forEach((c) => curvePtIds(c).forEach((p) => moved.add(p)));
  // carry construction circles whose on-circle points all move (polygons)
  const byCircle: Record<string, string[]> = {};
  sk.cons.forEach((c) => { if (c.type === 'ponc') (byCircle[c.c] = byCircle[c.c] || []).push(c.p); });
  Object.entries(byCircle).forEach(([cid, ps]) => { if (ps.every((p) => moved.has(p))) { const cc = M.get(cid) as CircleCurve | undefined; if (cc) { moved.add(cc.c); if (!curves.includes(cc)) curves.push(cc); } } });
  if (moved.has('O')) {
    // the origin itself never moves: geometry that used it gets its own point
    const np = addPt(sk, 0, 0);
    moved.delete('O'); moved.add(np);
    curves.forEach((c) => { (['p1', 'p2', 'c'] as const).forEach((k) => { if ((c as any)[k] === 'O') (c as any)[k] = np; }); });
  }
  const locked = [...moved].filter((p) => sk.cons.some((c) => c.type === 'fix' && c.p === p));
  if (locked.length) { restore(sk, snap); message('Part of the selection is locked with Fix. Unlock it with fix first.', 'warn'); return; }
  const probe = [...moved][0], start = probe ? PT(sk, probe) : null;
  moved.forEach((p) => { sk.pts[p].x += dx; sk.pts[p].y += dy; });
  // dimensions that tie moved geometry to unmoved geometry take their new values
  const drop = new Set<string>();
  sk.cons.forEach((c) => {
    if (c.driven || !['hdist', 'vdist', 'dist', 'pldist'].includes(c.type)) return;
    const l = c.l ? (M.get(c.l) as LineCurve) : null;
    const ps: string[] = c.type === 'pldist' ? [c.p, l!.p1, l!.p2] : [c.p1, c.p2];
    const m = ps.filter((p) => moved.has(p)).length;
    if (m === 0 || m === ps.length) return;
    if (c.type === 'pldist' && (c.ref || sk.cons.some((x) => x.ref === c.id))) { drop.add(c.ref || c.id); return; }
    if (c.type === 'hdist' || c.type === 'vdist') { const k = c.type === 'hdist' ? 'x' : 'y', raw = sk.pts[c.p2][k] - sk.pts[c.p1][k]; c.sgn = Math.sign(raw) || 1; c.v = Math.abs(raw); }
    else if (c.type === 'dist') c.v = d2(PT(sk, c.p1), PT(sk, c.p2));
    else { const a = PT(sk, l!.p1), u = lineUnit(sk, l!), p = PT(sk, c.p), dd = u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0]); c.sgn = Math.sign(dd) || 1; c.v = Math.abs(dd); }
    delete c.expr;
  });
  if (drop.size) sk.cons = sk.cons.filter((c) => !(drop.has(c.id) || drop.has(c.ref)));
  if (!solveSketch(sk)) { restore(sk, snap); skChanged(sk); message("Couldn't move it there with the current constraints", 'warn'); return; }
  pushHist(sk, snap);
  const held = !!probe && Math.hypot(sk.pts[probe].x - start![0] - dx, sk.pts[probe].y - start![1] - dy) > 0.01;
  const moveSel = T.sel.slice();
  exitTool(true);
  state.skSels = moveSel.filter((x) => x.kind !== 'point' || sk.pts[x.id]);
  state.skSel = state.skSels[state.skSels.length - 1] || null;
  skChanged(sk); setOverlaySel();
  message(held ? 'Moved only partway: constraints tie it to geometry that stayed put (like Horizontal, Parallel or Coincident with an unmoved line). Delete those to move it freely.'
    : `Moved ${fmt(dx)}, ${fmtU(dy)}. Still selected: press Enter or Space to move again.`, held ? 'warn' : 'ok');
}

// ---- trim ----
function applyTrim(tg: TrimTarget): void {
  const sk = SK(), snap = snapshot(sk), cv = tg.cv as any;
  const attach = (pid: string, by: string): void => { const o = curveOf(sk, by); if (!o) return; addCon(sk, o.type === 'line' ? { type: 'ponl', p: pid, l: o.id } : { type: 'ponc', p: pid, c: o.id }, true); };
  const dropDims = (id: string): void => { sk.cons = sk.cons.filter((c) => !((c.type === 'length' || c.type === 'equal') && (c.l === id || c.a === id || c.b === id))); };
  const lo = tg.lo, hi = tg.hi;
  if (tg.whole) sk.curves = sk.curves.filter((c) => c.id !== cv.id);
  else if (cv.type === 'line') {
    dropDims(cv.id);
    if (!lo) { const X = addPt(sk, hi!.p[0], hi!.p[1]); cv.p1 = X; attach(X, hi!.by); }
    else if (!hi) { const X = addPt(sk, lo.p[0], lo.p[1]); cv.p2 = X; attach(X, lo.by); }
    else {
      const X0 = addPt(sk, lo.p[0], lo.p[1]), X1 = addPt(sk, hi.p[0], hi.p[1]), oldP2 = cv.p2;
      cv.p2 = X0;
      const nl = addLine(sk, X1, oldP2);
      if (cv.construction) curveOf(sk, nl)!.construction = true;
      sk.cons.filter((c) => ['horizontal', 'vertical'].includes(c.type) && c.l === cv.id).forEach((c) => sk.cons.push({ id: newId(sk, 'k'), type: c.type, l: nl }));
      sk.cons.filter((c) => ['par', 'perp'].includes(c.type) && (c.a === cv.id || c.b === cv.id)).forEach((c) => sk.cons.push({ id: newId(sk, 'k'), type: c.type, a: nl, b: c.a === cv.id ? c.b : c.a }));
      attach(X0, lo.by); attach(X1, hi.by);
    }
  } else if (cv.type === 'circle') {
    const X0 = addPt(sk, lo!.p[0], lo!.p[1]), X1 = addPt(sk, hi!.p[0], hi!.p[1]);
    cv.type = 'arc'; cv.p1 = X1; cv.p2 = X0;
    sk.cons.forEach((c) => { if (c.type === 'diameter' && c.c === cv.id) { c.type = 'radius'; c.v = c.v! / 2; delete c.ang; } });
    attach(X0, lo!.by); attach(X1, hi!.by);
  } else {
    if (!lo) { const X = addPt(sk, hi!.p[0], hi!.p[1]); cv.p1 = X; attach(X, hi!.by); }
    else if (!hi) { const X = addPt(sk, lo.p[0], lo.p[1]); cv.p2 = X; attach(X, lo.by); }
    else {
      const X0 = addPt(sk, lo.p[0], lo.p[1]), X1 = addPt(sk, hi.p[0], hi.p[1]), id = newId(sk, 'a');
      sk.curves.push({ id, type: 'arc', c: cv.c, p1: X1, p2: cv.p2, r: cv.r, construction: cv.construction });
      cv.p2 = X0;
      sk.cons.push({ id: newId(sk, 'k'), type: 'equal', a: cv.id, b: id, quiet: true });
      attach(X0, lo.by); attach(X1, hi.by);
    }
  }
  removeOrphans(sk);
  state.skHover = null;
  if (!solveSketch(sk)) { restore(sk, snap); skChanged(sk); message("That trim doesn't work with the current constraints", 'warn'); return; }
  pushHist(sk, snap);
  skChanged(sk);
  clearToolPreview();
  message(tg.whole ? 'Removed the whole curve (nothing crosses it)' : 'Trimmed. The new end is attached to the curve it met.', 'ok');
}

// ---- dimensions ----
function pendingDim(): Constraint | null {
  const T = state.tool!, sk = SK(), P = T.picks, c = T.cur as P2 | null;
  if (!c || !P.length) return null;
  const M = cmap(sk), kinds = P.map((p) => pickKind(sk, p));
  const mk = (o: Record<string, unknown>): Constraint => o as unknown as Constraint;
  if (P.length === 1) {
    if (kinds[0] === 'line') { const l = M.get(P[0].id) as LineCurve, a = PT(sk, l.p1), u = lineUnit(sk, l); return mk({ type: 'length', l: l.id, v: d2(a, PT(sk, l.p2)), off: (c[0] - a[0]) * -u[1] + (c[1] - a[1]) * u[0] }); }
    if (kinds[0] === 'arc') { const cv = M.get(P[0].id) as ArcCurve, p = PT(sk, cv.c); return mk({ type: 'radius', c: cv.id, v: cv.r, ang: Math.atan2(c[1] - p[1], c[0] - p[0]) }); }
    if (kinds[0] === 'circle') { const cv = M.get(P[0].id) as CircleCurve, p = PT(sk, cv.c); return mk({ type: 'diameter', c: cv.id, v: cv.r * 2, ang: Math.atan2(c[1] - p[1], c[0] - p[0]) }); }
    return null;
  }
  if (kinds[0] === 'point' && kinds[1] === 'point') {
    // where the label is placed decides: beside → vertical distance, above/below → horizontal, between → straight-line
    const p1 = P[0].id, p2 = P[1].id, a = PT(sk, p1), b = PT(sk, p2);
    const minX = Math.min(a[0], b[0]), maxX = Math.max(a[0], b[0]), minY = Math.min(a[1], b[1]), maxY = Math.max(a[1], b[1]);
    const ex = c[0] < minX ? minX - c[0] : c[0] > maxX ? c[0] - maxX : 0, ey = c[1] < minY ? minY - c[1] : c[1] > maxY ? c[1] - maxY : 0;
    let type = 'dist';
    if (ey > ex && ey > 0.5) type = 'hdist'; else if (ex > 0.5) type = 'vdist';
    if (type === 'hdist' && Math.abs(b[0] - a[0]) < 1e-6) type = 'dist';
    if (type === 'vdist' && Math.abs(b[1] - a[1]) < 1e-6) type = 'dist';
    const con: Record<string, unknown> = { type, p1, p2, place: c.slice() };
    if (type === 'hdist') { con.sgn = Math.sign(b[0] - a[0]) || 1; con.v = Math.abs(b[0] - a[0]); }
    else if (type === 'vdist') { con.sgn = Math.sign(b[1] - a[1]) || 1; con.v = Math.abs(b[1] - a[1]); }
    else con.v = d2(a, b);
    return (con.v as number) > 1e-6 ? mk(con) : null;
  }
  const plCon = (pid: string, lid: string): Constraint | null => {
    const l = M.get(lid) as LineCurve, a = PT(sk, l.p1), u = lineUnit(sk, l), p = PT(sk, pid);
    const d = u[0] * (p[1] - a[1]) - u[1] * (p[0] - a[0]);
    if (Math.abs(d) < 1e-6) return null;
    const t = (p[0] - a[0]) * u[0] + (p[1] - a[1]) * u[1], F = [a[0] + u[0] * t, a[1] + u[1] * t], mid = [(p[0] + F[0]) / 2, (p[1] + F[1]) / 2];
    return mk({ type: 'pldist', p: pid, l: lid, sgn: Math.sign(d) || 1, v: Math.abs(d), off: (c[0] - mid[0]) * u[0] + (c[1] - mid[1]) * u[1] });
  };
  if (kinds[0] === 'point' && kinds[1] === 'line') return plCon(P[0].id, P[1].id);
  if (kinds[0] === 'line' && kinds[1] === 'point') return plCon(P[1].id, P[0].id);
  if (kinds[0] === 'line' && kinds[1] === 'line') {
    const A = M.get(P[0].id) as LineCurve, B = M.get(P[1].id) as LineCurve, X = lineInter(sk, A, B);
    if (!X) return plCon(B.p1, A.id); // parallel lines: the distance between them
    const ua = lineUnit(sk, A), ub = lineUnit(sk, B), C = [c[0] - X[0], c[1] - X[1]], cr = (p: number[], q: number[]): number => p[0] * q[1] - p[1] * q[0];
    let best = { sa: 1, sb: 1 };
    for (const sa of [1, -1]) for (const sb of [1, -1]) {
      const U = [ua[0] * sa, ua[1] * sa], W = [ub[0] * sb, ub[1] * sb], s = cr(U, W);
      if (cr(U, C) * s >= 0 && cr(C, W) * s >= 0) best = { sa, sb };
    }
    const U = [ua[0] * best.sa, ua[1] * best.sa], W = [ub[0] * best.sb, ub[1] * best.sb];
    const phi = Math.atan2(cr(U, W), U[0] * W[0] + U[1] * W[1]);
    return mk({ type: 'angle', a: A.id, b: B.id, sa: best.sa, sb: best.sb, s: Math.sign(phi) || 1, v: (Math.abs(phi) * 180) / Math.PI, rad: Math.max(1e-3, Math.hypot(C[0], C[1])) });
  }
  return null;
}
function addDimension(con: Constraint): Constraint | null {
  const sk = SK(), snap = snapshot(sk);
  con.id = newId(sk, 'k');
  if (!independent(sk, con)) {
    // over-constraining: keep it as a reference dimension that only measures
    const cs = conflictsWith(sk, con);
    con.driven = true;
    sk.cons.push(con);
    pushHist(sk, snap);
    skChanged(sk);
    message(`That size is already set${cs.length ? ' by ' + conName(cs[0]) : ' by other constraints'}, so it was added as a reference dimension in parentheses. Delete ${cs.length ? 'that' : 'a conflicting constraint'} if you want this one to drive.`);
    return con;
  }
  sk.cons.push(con);
  if (!solveSketch(sk)) { restore(sk, snap); skChanged(sk); message("That dimension can't be satisfied with the others.", 'warn'); return null; }
  pushHist(sk, snap);
  skChanged(sk);
  startDimEdit(con.id);
  return con;
}

function toggleFix(h: SkSel): void {
  const sk = SK(), snap = snapshot(sk);
  const pts = h.kind === 'point' ? [h.id] : ((): string[] => { const c = curveOf(sk, h.id)!; return c.type === 'line' ? [c.p1, c.p2] : [c.c]; })();
  const allFixed = pts.every((p) => sk.cons.some((c) => c.type === 'fix' && c.p === p));
  if (allFixed) {
    sk.cons = sk.cons.filter((c) => !(c.type === 'fix' && pts.includes(c.p)) && !(c.type === 'fixr' && h.kind === 'curve' && c.c === h.id));
    message('Unlocked');
  } else {
    pts.forEach((p) => { if (p !== 'O' && !sk.cons.some((c) => c.type === 'fix' && c.p === p)) sk.cons.push({ id: newId(sk, 'k'), type: 'fix', p }); });
    if (h.kind === 'curve' && curveOf(sk, h.id)!.type === 'circle' && !sk.cons.some((c) => c.type === 'fixr' && c.c === h.id)) sk.cons.push({ id: newId(sk, 'k'), type: 'fixr', c: h.id });
    message('Locked in place', 'ok');
  }
  pushHist(sk, snap);
  solveSketch(sk);
  skChanged(sk);
}

/** Coincident: join two points into one. */
function mergePoints(keep: string, drop: string): void {
  const sk = SK();
  if (keep === drop) return;
  if (drop === 'O') { const t = keep; keep = drop; drop = t; }
  const snap = snapshot(sk);
  const rep = (id: string): string => (id === drop ? keep : id);
  sk.curves.forEach((c: any) => { ['p1', 'p2', 'c'].forEach((k) => { if (c[k]) c[k] = rep(c[k]); }); });
  sk.cons.forEach((c) => { ['p', 'p1', 'p2'].forEach((k) => { if (c[k]) c[k] = rep(c[k]); }); if (c.ref && c.ref.id) c.ref.id = rep(c.ref.id); });
  const dead = new Set(sk.curves.filter((c) => isEdgeCurve(c) && c.p1 === c.p2).map((c) => c.id));
  sk.curves = sk.curves.filter((c) => !dead.has(c.id));
  sk.cons = sk.cons.filter((c) => !conCurves(c).some((id) => dead.has(id)) && !(c.p1 && c.p1 === c.p2));
  const fx = new Set<string>();
  sk.cons = sk.cons.filter((c) => { if (c.type !== 'fix') return true; if (fx.has(c.p) || c.p === 'O') return false; fx.add(c.p); return true; });
  delete sk.pts[drop];
  if (!solveSketch(sk)) { restore(sk, snap); skChanged(sk); message("Those points can't be joined with the current constraints.", 'warn'); return; }
  pushHist(sk, snap);
  skChanged(sk);
  message('Points joined. ' + DofSentence(sk) + '.', 'ok');
}

export function deleteSketchSel(): void {
  const sk = state.sketch;
  if (!sk) return;
  const list = state.skSels.length ? state.skSels.slice() : state.skSel ? [state.skSel] : [];
  const items = list.filter((s) => !(s.kind === 'point' && s.id === 'O'));
  if (!items.length) { if (list.length) message("The sketch origin can't be deleted", 'warn'); return; }
  const snap = snapshot(sk), what = items.length === 1 ? describeSel(sk, items[0]) : `${items.length} items`;
  items.forEach((s) => {
    if (s.kind === 'con') sk.cons = sk.cons.filter((c) => c.id !== s.id);
    else if (s.kind === 'curve') sk.curves = sk.curves.filter((c) => c.id !== s.id);
    else sk.curves = sk.curves.filter((c) => !curvePtIds(c).includes(s.id));
  });
  // a polygon's construction circle goes with it once no points ride on it
  sk.curves = sk.curves.filter((c) => !(c.construction && c.type === 'circle' && sk.cons.some((k) => k.type === 'ponc' && k.c === c.id) &&
    !sk.cons.some((k) => k.type === 'ponc' && k.c === c.id && sk.curves.some((l) => l.type === 'line' && (l.p1 === k.p || l.p2 === k.p)))));
  removeOrphans(sk);
  state.skSel = null; state.skSels = []; state.skHover = null;
  pushHist(sk, snap);
  solveSketch(sk);
  skChanged(sk);
  message(`Removed ${what}`);
}

// ---- dragging points, lines and circles with no tool active ----
export interface SketchDrag { hit: SkSel; snap: string; start: P2; orig: Record<string, P2>; x: number; y: number; moved: boolean }
export function sketchDragStart(e: PointerEvent): SketchDrag | null {
  const sk = state.sketch;
  if (!sk || !sk.frame || state.tool || e.button !== 0 || e.shiftKey) return null;
  if (isDimEditing()) closeDimEdit(true);
  const w = planeHit(sk.frame);
  if (!w) return null;
  const raw = toLocal(sk.frame, [w.x, w.y, w.z]), h = hitSketch(sk, raw, w);
  if (!h || (h.kind === 'point' && h.id === 'O')) return null;
  const orig: Record<string, P2> = {};
  Object.keys(sk.pts).forEach((id) => { orig[id] = [sk.pts[id].x, sk.pts[id].y]; });
  return { hit: h, snap: snapshot(sk), start: raw, orig, x: e.clientX, y: e.clientY, moved: false };
}
export function sketchDragMove(e: PointerEvent, d: SketchDrag): void {
  const sk = SK();
  const w = planeHit(sk.frame!);
  if (!w) return;
  if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 3) return;
  d.moved = true;
  const raw = toLocal(sk.frame!, [w.x, w.y, w.z]), dx = raw[0] - d.start[0], dy = raw[1] - d.start[1], h = d.hit;
  let drag;
  if (h.kind === 'point') drag = [{ p: h.id, x: raw[0], y: raw[1] }];
  else {
    const c = curveOf(sk, h.id)!;
    if (c.type === 'line') drag = [c.p1, c.p2].map((p) => ({ p, x: d.orig[p][0] + dx, y: d.orig[p][1] + dy }));
    else drag = [{ r: c.id, v: Math.max(0.1, d2(raw, PT(sk, c.c))) }];
  }
  solveSketch(sk, drag);
  skChanged(sk);
}
export function sketchDragEnd(d: SketchDrag): void {
  const sk = SK();
  if (d.moved) { pushHist(sk, d.snap); message(`Moved. ${DofSentence(sk)}.`); }
  else {
    state.skSel = d.hit; state.skSels = [d.hit];
    refreshSketchStyles(sk); setOverlaySel();
    message(describeSel(sk, d.hit) + ' selected. Delete removes it; drag to move.');
  }
}

/** Ctrl+Z inside a sketch: back out of the shape in progress, or undo the last change. */
export function sketchUndo(): void {
  const sk = SK(), T = state.tool;
  if (isDimEditing()) { closeDimEdit(false); return; }
  if (T && (T.pts.length || T.picks.length)) { cancelShape(); return; }
  if (!sk.hist.length) { message('Nothing to undo in this sketch'); return; }
  restore(sk, sk.hist.pop()!);
  state.skSel = null; state.skSels = []; state.skHover = null;
  if (T && T.type === 'line') T.start = null;
  skChanged(sk);
  message('Undone');
}

/** Words for the command bar while a sketch tool is active. */
export function toolPrompt(): string {
  const T = state.tool;
  if (!T) return 'Draw: l rec c pol. Edit: m of. Constrain: d hv pe pa eq co fix. Shift+click selects several; fs finishes';
  switch (T.type) {
    case 'arc': return !T.pts.length ? 'Arc: click the start point' : T.pts.length === 1 ? 'Click the end point' : 'Move to bend the arc and click, or type a radius and press Enter';
    case 'trim': return 'Trim: hover a curve to see the piece that goes (red), then click. Esc when done';
    case 'tangent': return T.picks.length ? 'Click the second curve' : 'Tangent: click a line, circle or arc';
    case 'midpt': return T.picks.length ? (T.picks[0].kind === 'point' ? 'Click the line' : 'Click the point') : 'Midpoint: click a point and a line';
    case 'polygon': return T.phase === 'sides' ? 'Polygon: type the number of sides, then press Enter' : T.pts.length ? 'Type a size or click to set it. The HUD button switches corners/flats; Shift turns off 15° rotation snap' : `Polygon (${T.sides} sides): click the center point`;
    case 'offset': return T.phase === 'select' ? 'Offset: click a curve or shape. Shift+click picks several, Enter continues' : 'Move to the side to offset toward, type a distance, then click or press Enter';
    case 'move': return T.phase === 'select' ? 'Move: select objects. Shift+click for several, Enter continues' : T.phase === 'base' ? 'Specify base point on the selected objects (snaps to endpoints, midpoints, centers)' : 'Specify second point, or type ΔX / ΔY and press Enter';
    case 'rect': return T.pts.length ? 'Type width, Tab, height, then Enter, or click the opposite corner' : 'Rectangle: click the first corner';
    case 'circle': return T.pts.length ? 'Type a diameter and press Enter, or click to set the size' : 'Circle: click the center';
    case 'line': return T.pts.length ? 'Type a length or click the next point. Click the start point to close, Esc to stop' : 'Line: click the start point';
    case 'dim': {
      const P = T.picks;
      if (!P.length) return 'Dimension: click a line, circle or point';
      if (P.length === 1) {
        const k = pickKind(SK(), P[0]);
        if (k === 'point') return 'Click a second point, or a line for a perpendicular distance';
        if (k === 'line') return 'Click to place the length, or click another line for an angle, or a point for a distance';
        return 'Click to place the diameter';
      }
      return 'Move to position the dimension, then click to place it';
    }
    case 'hv': return 'Horizontal/Vertical: click a line';
    case 'perp': return T.picks.length ? 'Click the second line' : 'Perpendicular: click the first line';
    case 'par': return T.picks.length ? 'Click the second line' : 'Parallel: click the first line';
    case 'equal': return T.picks.length ? 'Click a second line or circle of the same kind' : 'Equal: click the first line or circle';
    case 'fix': return 'Fix: click a point, line or circle to lock or unlock it';
    case 'coincident': return T.picks.length ? 'Click a point to join, or a curve to put the point on it' : 'Coincident: click a point';
  }
  return '';
}

export function initSketchTools(): void {
  on('units', () => { hud.querySelectorAll<HTMLElement>('em[data-ul]').forEach((e) => { e.textContent = unitName(); }); hud.querySelectorAll<HTMLInputElement>('input[data-len]').forEach((i) => { i.value = ''; delete i.dataset.locked; }); });
  hud.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act="polymode"]');
    if (!b) return;
    state.polyMode = state.polyMode === 'flats' ? 'corners' : 'flats';
    b.textContent = state.polyMode === 'flats' ? 'across flats' : 'to corners';
    updateToolPreview(); focusHud();
  });
  hud.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    t.dataset.locked = '1'; // a typed value stops following the cursor
    t.classList.toggle('invalid', parseExpr(t.value) === null);
    updateToolPreview();
  });
  hud.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); hudEnter(); }
    else if (e.key === 'Escape') { e.preventDefault(); exitTool(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const ins = [...hud.querySelectorAll<HTMLInputElement>('input')];
      if (ins.length > 1) { const i = ins.indexOf(e.target as HTMLInputElement); const nx = ins[(i + (e.shiftKey ? -1 : 1) + ins.length) % ins.length]; nx.focus(); nx.select(); }
    }
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) e.stopPropagation();
  });
}
