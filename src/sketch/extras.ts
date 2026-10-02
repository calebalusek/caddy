// More sketch tools, as plain operations on the sketch data (so they run in Node tests too):
// Slot, corner Fillet / Chamfer, Mirror curves across a line, and Project body edges into the sketch.
// None of them adds constraints by itself (standing rule 13).
import type { BodyResult } from '../kernel/protocol';
import { toLocal } from '../model/frames';
import type { Frame } from '../model/types';
import {
  addLine, addPt, circlePts, conCurves, conPoints, curvePtIds, d2, isDim, newId, normAng, PT, segDist, usedPoints,
  type ArcCurve, type Curve, type LineCurve, type P2, type SketchData,
} from './model';

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const len = (a: P2): number => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

// ---- slot ----
/** The corners of a slot between two centers: two straight sides and a half circle at each end. */
export function slotParts(a: P2, b: P2, w: number): { u: P2; n: P2; r: number; a1: P2; a2: P2; b1: P2; b2: P2 } {
  const u = unit(sub(b, a)), n: P2 = [-u[1], u[0]], r = w / 2;
  const at = (c: P2, s: number): P2 => [c[0] + n[0] * r * s, c[1] + n[1] * r * s];
  return { u, n, r, a1: at(a, 1), a2: at(a, -1), b1: at(b, 1), b2: at(b, -1) };
}
/** The slot's outline as a polyline, for the preview. */
export function slotOutline(a: P2, b: P2, w: number): P2[] {
  const { u, r } = slotParts(a, b, w), t0 = Math.atan2(u[1], u[0]), out: P2[] = [];
  const half = (c: P2, from: number): void => { for (let i = 0; i <= 18; i++) { const t = from + (Math.PI * i) / 18; out.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]); } };
  half(b, t0 - Math.PI / 2); // around the far end, front side
  half(a, t0 + Math.PI / 2); // and back around the near end
  return out;
}
/** Add a slot. `ia` and `ib` are existing points to use as the centers (or null to make new ones). */
export function addSlot(sk: SketchData, ia: string | null, a: P2, ib: string | null, b: P2, w: number): string | null {
  if (d2(a, b) < 0.01) return 'Move the second center away from the first';
  if (w < 0.01) return 'Give the slot a width';
  const { a1, a2, b1, b2, r } = slotParts(a, b, w);
  const Ca = ia || addPt(sk, a[0], a[1]), Cb = ib || addPt(sk, b[0], b[1]);
  const A1 = addPt(sk, a1[0], a1[1]), A2 = addPt(sk, a2[0], a2[1]), B1 = addPt(sk, b1[0], b1[1]), B2 = addPt(sk, b2[0], b2[1]);
  addLine(sk, A1, B1); addLine(sk, B2, A2);
  // arcs run counter-clockwise from p1 to p2: round the far end from its right side to its left, the near end the other way
  sk.curves.push({ id: newId(sk, 'a'), type: 'arc', c: Cb, p1: B2, p2: B1, r });
  sk.curves.push({ id: newId(sk, 'a'), type: 'arc', c: Ca, p1: A1, p2: A2, r });
  return null;
}

// ---- corner fillet and chamfer ----
/** Round or bevel the corner where exactly two straight lines meet at a point. Returns an error sentence, or null when done. */
export function cornerEdit(sk: SketchData, pid: string, kind: 'fillet' | 'chamfer', v: number): string | null {
  if (!(v > 0)) return kind === 'fillet' ? 'Type a radius first' : 'Type a distance first';
  const users = sk.curves.filter((c) => curvePtIds(c).includes(pid));
  if (users.length !== 2 || users.some((c) => c.type !== 'line')) return 'Click a corner where two straight lines meet';
  const [L1, L2] = users as LineCurve[], C = PT(sk, pid);
  const other = (l: LineCurve): string => (l.p1 === pid ? l.p2 : l.p1);
  const O1 = PT(sk, other(L1)), O2 = PT(sk, other(L2)), u1 = unit(sub(O1, C)), u2 = unit(sub(O2, C));
  const cos = u1[0] * u2[0] + u1[1] * u2[1], cross = u1[0] * u2[1] - u1[1] * u2[0];
  if (Math.abs(cross) < 1e-6) return 'Those two lines run straight on; there is no corner to round';
  const half = Math.atan2(Math.abs(cross), 1 + cos); // half of the angle between the lines, from sin/(1+cos) = tan(half)
  const t = kind === 'fillet' ? v / Math.tan(half) : v, room = Math.min(d2(O1, C), d2(O2, C)) - 0.01;
  if (t > room) {
    const max = kind === 'fillet' ? room * Math.tan(half) : room;
    return `That ${kind === 'fillet' ? 'radius' : 'distance'} is too big for these lines (the most that fits is ${Math.floor(max * 100) / 100})`;
  }
  const T1: P2 = [C[0] + u1[0] * t, C[1] + u1[1] * t], T2: P2 = [C[0] + u2[0] * t, C[1] + u2[1] * t];
  const N1 = addPt(sk, T1[0], T1[1]), N2 = addPt(sk, T2[0], T2[1]);
  if (L1.p1 === pid) L1.p1 = N1; else L1.p2 = N1;
  if (L2.p1 === pid) L2.p1 = N2; else L2.p2 = N2;
  if (kind === 'chamfer') addLine(sk, N1, N2);
  else {
    const b = unit([u1[0] + u2[0], u1[1] + u2[1]]), dist = v / Math.sin(half), q: P2 = [C[0] + b[0] * dist, C[1] + b[1] * dist];
    const Q = addPt(sk, q[0], q[1]), c2 = (T1[0] - q[0]) * (T2[1] - q[1]) - (T1[1] - q[1]) * (T2[0] - q[0]);
    sk.curves.push({ id: newId(sk, 'a'), type: 'arc', c: Q, p1: c2 > 0 ? N1 : N2, p2: c2 > 0 ? N2 : N1, r: v });
  }
  // what no longer holds: anything on the old corner, and sizes or equalities of the two shortened lines
  const ids = new Set([L1.id, L2.id]);
  sk.cons = sk.cons.filter((c) => !(conPoints(c).includes(pid) || ((isDim(c) || ['equal', 'midpt', 'tangent'].includes(c.type)) && conCurves(c).some((x) => ids.has(x)))));
  if (pid !== 'O' && !usedPoints(sk).has(pid)) delete sk.pts[pid];
  return null;
}

// ---- mirror ----
/** Copy curves to the other side of a line. Points on the line are shared, so shapes join up. Returns an error sentence, or the number copied. */
export function mirrorCurves(sk: SketchData, ids: string[], axisId: string): string | number {
  const axis = sk.curves.find((c) => c.id === axisId);
  if (!axis || axis.type !== 'line') return 'Click a straight line to mirror across';
  const A = PT(sk, axis.p1), B = PT(sk, axis.p2), D = unit(sub(B, A));
  if (d2(A, B) < 1e-6) return 'That line has no length';
  const side = (p: P2): number => (p[0] - A[0]) * D[1] - (p[1] - A[1]) * D[0];
  const onAxis = (p: P2): boolean => Math.abs(side(p)) < 1e-6;
  const reflect = (p: P2): P2 => { const v = sub(p, A), s = v[0] * D[0] + v[1] * D[1]; return [A[0] + 2 * D[0] * s - v[0], A[1] + 2 * D[1] * s - v[1]]; };
  const made = new Map<string, string>();
  const mp = (id: string): string => {
    const p = PT(sk, id);
    if (onAxis(p)) return id;
    let m = made.get(id);
    if (!m) { const q = reflect(p); m = addPt(sk, q[0], q[1]); made.set(id, m); }
    return m;
  };
  let n = 0;
  sk.curves.slice().forEach((c: Curve) => {
    if (!ids.includes(c.id) || c.id === axisId) return;
    if (c.type === 'line') {
      if (onAxis(PT(sk, c.p1)) && onAxis(PT(sk, c.p2))) return; // lies on the line: nothing to copy
      const l = addLine(sk, mp(c.p1), mp(c.p2));
      if (c.construction) (sk.curves[sk.curves.length - 1] as LineCurve).construction = true;
      void l;
    } else if (c.type === 'arc') {
      sk.curves.push({ id: newId(sk, 'a'), type: 'arc', c: mp(c.c), p1: mp(c.p2), p2: mp(c.p1), r: c.r, construction: c.construction || undefined } as ArcCurve); // a mirror image runs the other way round
    } else sk.curves.push({ id: newId(sk, 'c'), type: 'circle', c: mp(c.c), r: c.r, construction: c.construction || undefined });
    n++;
  });
  return n || 'Nothing to copy: the curves you picked lie on the mirror line';
}

// ---- project body edges ----
export type Projected = { kind: 'line'; a: P2; b: P2 } | { kind: 'circle'; c: P2; r: number } | { kind: 'arc'; c: P2; r: number; a: P2; b: P2; mid: P2 };

/** The edges of the bodies as the sketch's plane sees them (straight edges and circles or arcs that face the plane). */
export function projectables(frame: Frame, bodies: BodyResult[]): Projected[] {
  const out: Projected[] = [], L = (p: [number, number, number]): P2 => toLocal(frame, p), n = frame.n;
  const seen = new Set<string>(), key = (...p: P2[]): string => p.map((q) => Math.round(q[0] * 1e3) + ',' + Math.round(q[1] * 1e3)).join('|');
  bodies.forEach((b) => b.edges.forEach((e) => {
    if (e.kind === 'line') {
      const a = L(e.a), c = L(e.b);
      if (d2(a, c) < 1e-6) return;
      const k = [key(a, c), key(c, a)];
      if (k.some((x) => seen.has(x))) return;
      seen.add(k[0]); out.push({ kind: 'line', a, b: c });
    } else if (e.kind === 'round' && e.center && e.axis && e.R) {
      if (Math.abs(Math.abs(e.axis[0] * n[0] + e.axis[1] * n[1] + e.axis[2] * n[2]) - 1) > 1e-6) return; // an ellipse on the plane: not supported
      const c = L(e.center);
      if (e.closed) { const k = 'c' + key(c) + e.R.toFixed(3); if (seen.has(k)) return; seen.add(k); out.push({ kind: 'circle', c, r: e.R }); }
      else { const a = L(e.a), bb = L(e.b), k = 'a' + key(c, a, bb); if (seen.has(k)) return; seen.add(k); out.push({ kind: 'arc', c, r: e.R, a, b: bb, mid: L(e.mid) }); }
    }
  }));
  return out;
}

const arcOf = (p: Extract<Projected, { kind: 'arc' }>): { from: P2; to: P2 } => {
  const ang = (q: P2): number => Math.atan2(q[1] - p.c[1], q[0] - p.c[0]);
  const swap = normAng(ang(p.mid) - ang(p.a)) > normAng(ang(p.b) - ang(p.a));
  return swap ? { from: p.b, to: p.a } : { from: p.a, to: p.b };
};

/** The outline of a projected edge, for the preview. */
export function projectedPts(p: Projected): P2[] {
  if (p.kind === 'line') return [p.a, p.b];
  if (p.kind === 'circle') return circlePts(p.c, p.r, 72);
  const { from, to } = arcOf(p), a1 = Math.atan2(from[1] - p.c[1], from[0] - p.c[0]), sw = normAng(Math.atan2(to[1] - p.c[1], to[0] - p.c[0]) - a1) || Math.PI * 2, pts: P2[] = [];
  for (let i = 0; i <= 36; i++) { const t = a1 + (sw * i) / 36; pts.push([p.c[0] + p.r * Math.cos(t), p.c[1] + p.r * Math.sin(t)]); }
  return pts;
}

/** How far the cursor is from a projected edge. */
export function projectedDist(p: Projected, at: P2): number {
  if (p.kind === 'line') return segDist(at, p.a, p.b);
  if (p.kind === 'circle') return Math.abs(d2(at, p.c) - p.r);
  const pts = projectedPts(p);
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, segDist(at, pts[i], pts[i + 1]));
  return best;
}

/** The projected edge nearest the cursor, within `max`. */
export function nearestProjected(list: Projected[], at: P2, max: number): Projected | null {
  let best: Projected | null = null, bd = max;
  list.forEach((p) => { const d = projectedDist(p, at); if (d < bd) { bd = d; best = p; } });
  return best;
}

/** Put a projected edge into the sketch (sharing points that are already there). Returns an error sentence or null. */
export function addProjected(sk: SketchData, p: Projected): string | null {
  const used = [...usedPoints(sk)];
  const pt = (q: P2): string => used.find((id) => d2(PT(sk, id), q) < 1e-4) || addPt(sk, q[0], q[1]);
  const exists = (m: (c: Curve) => boolean): boolean => sk.curves.some(m);
  if (p.kind === 'line') {
    const a = pt(p.a), b = pt(p.b);
    if (exists((c) => c.type === 'line' && ((c.p1 === a && c.p2 === b) || (c.p1 === b && c.p2 === a)))) return 'That edge is already in the sketch';
    addLine(sk, a, b);
  } else if (p.kind === 'circle') {
    const c = pt(p.c);
    if (exists((x) => x.type === 'circle' && x.c === c && Math.abs(x.r - p.r) < 1e-4)) return 'That circle is already in the sketch';
    sk.curves.push({ id: newId(sk, 'c'), type: 'circle', c, r: p.r });
  } else {
    const { from, to } = arcOf(p), c = pt(p.c), a = pt(from), b = pt(to);
    if (exists((x) => x.type === 'arc' && x.c === c && x.p1 === a && x.p2 === b)) return 'That arc is already in the sketch';
    sk.curves.push({ id: newId(sk, 'a'), type: 'arc', c, p1: a, p2: b, r: p.r });
  }
  return null;
}
