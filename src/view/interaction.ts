// What the mouse does in the viewport when it is not orbiting: hover highlights (orange),
// click selection (blue) and handing clicks to whichever tool is asking for something.
import { emit } from '../app/hub';
import { feats, featById, state } from '../app/state';
import type { SketchFeature } from '../model/types';
import { curvePts } from '../sketch/model';
import { enterSketch, selectSketch } from '../sketch/session';
import { sketchClick, sketchMove } from '../sketch/tools';
import { clearHoverLines, profileFills, showHoverLines, sketchCenter, sketchGroupVisible, sketchWorldSegs, toScreen, tw } from '../sketch/visuals';
import { clearSelection, endPick, hidePickTip, mouse, planeName, planeUnderCursor, ray, showPickTip } from '../tools/pick';
import { message } from '../ui/message';
import type { PlaneVis } from './planes';
import { camera, canvas } from './scene';

type Hit = { kind: 'sketch'; id: string; key: string } | { kind: 'plane'; vis: PlaneVis; key: string };

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

/** What a click would select right now, outside any tool. Outside sketch editing a sketch is one object. */
function solidHit(): Hit | null {
  let best: { d: number; r: Hit } | null = null;
  const ph = ray.intersectObjects(profileFills(), false)[0];
  if (ph) { const id = ph.object.userData.profile.sketchId as string; best = { d: ph.distance - 0.05, r: { kind: 'sketch', id, key: 'sk:' + id } }; }
  else { const sl = sketchLineAt(); if (sl) best = { d: sl.d, r: { kind: 'sketch', id: sl.id, key: 'sk:' + sl.id } }; }
  const pl = planeUnderCursor();
  if (pl && (!best || pl.distance < best.d - 0.01)) best = { d: pl.distance, r: { kind: 'plane', vis: pl.vis, key: pl.vis.key } };
  return best ? best.r : null;
}

function setHover(h: Hit | null): void {
  const key = h ? h.key : null;
  if (key === state.hoverKey) return;
  state.hoverKey = key;
  if (h && h.kind === 'sketch') { const s = featById(h.id) as SketchFeature; showHoverLines(h.key, sketchWorldSegs(s)); }
  else clearHoverLines();
  emit('select');
}

export function hoverMove(e: PointerEvent): void {
  if (state.pick) {
    const pl = planeUnderCursor();
    setHover(pl ? { kind: 'plane', vis: pl.vis, key: pl.vis.key } : null);
    canvas.style.cursor = pl ? 'pointer' : '';
    showPickTip();
    return;
  }
  if (state.mode === 'sketch') { sketchMove(e); return; }
  if (state.active) { setHover(null); canvas.style.cursor = ''; return; }
  const h = solidHit();
  setHover(h);
  canvas.style.cursor = h ? 'pointer' : '';
}

export function hoverLeave(): void {
  hidePickTip();
  if (state.mode !== 'sketch') setHover(null);
}

/** A click in the viewport that was not a drag. */
export function clickAt(e: PointerEvent): void {
  if (e.button !== 0) return;
  if (state.pick) {
    const pl = planeUnderCursor();
    if (!pl) return;
    const p = state.pick;
    endPick();
    clearHoverLines();
    p.onPick(pl.vis.ref);
    return;
  }
  if (state.mode === 'sketch') { sketchClick(e); return; }
  if (state.active) return;
  const h = solidHit();
  if (!h) {
    if (state.treeSel) selectSketch(null);
    if (!e.shiftKey && state.selection.length) { clearSelection(); message('Selection cleared'); }
    return;
  }
  if (h.kind === 'sketch') {
    const f = featById(h.id)!;
    selectSketch(state.treeSel === h.id ? null : h.id);
    if (state.treeSel) message(`${f.name} selected. Double-click to edit it, or type ex, rev or sw to use its profile.`);
    return;
  }
  if (state.treeSel) selectSketch(null);
  const v = h.vis, had = state.selection.some((s) => s.key === v.key);
  if (e.shiftKey) state.selection = had ? state.selection.filter((s) => s.key !== v.key) : state.selection.concat({ kind: 'plane', key: v.key, ref: v.ref });
  else state.selection = had && state.selection.length === 1 ? [] : [{ kind: 'plane', key: v.key, ref: v.ref }];
  emit('select');
  if (state.selection.length) message(`${planeName(v.ref)} selected. sk sketches on it, pl offsets a plane from it.`);
}

/** Double-click a sketch in the viewport to edit it. */
export function doubleClickAt(): void {
  if (state.mode === 'sketch' || state.active || state.pick) return;
  const h = solidHit();
  if (h && h.kind === 'sketch') { clearHoverLines(); state.hoverKey = null; enterSketch(featById(h.id) as SketchFeature); }
}
