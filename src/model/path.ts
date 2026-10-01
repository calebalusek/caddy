// Sweep paths: a connected chain of sketch lines and arcs (or one circle), kept exact, in the path
// sketch's own 2D coordinates. No DOM, no kernel: runs in the app, the worker and Node tests.
import type { PathSeg, PathSpec } from '../kernel/protocol';
import { arcSweep, PT, type P2 } from '../sketch/model';
import { toWorld } from './frames';
import type { Feature, Vec3 } from './types';

/** How a sweep's path is saved (same as version 1 files). */
export interface PathRef { sketchId: string; curveIds: string[] }

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: P2, b: P2): P2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: P2, s: number): P2 => [a[0] * s, a[1] * s];
const len = (a: P2): number => Math.hypot(a[0], a[1]);
const unit = (a: P2): P2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
/** Turned a quarter turn to the left. */
const left = (a: P2): P2 => [-a[1], a[0]];
const dot = (a: P2, b: P2): number => a[0] * b[0] + a[1] * b[1];
const wrap = (a: number): number => { while (a > Math.PI) a -= Math.PI * 2; while (a <= -Math.PI) a += Math.PI * 2; return a; };

/** Corners gentler than this are treated as smooth. */
export const SHARP = (10 * Math.PI) / 180;

/** Angle an arc piece turns through (always positive). */
export function segAngle(s: PathSeg): number {
  if (s.type === 'line') return 0;
  if (s.full) return Math.PI * 2;
  const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]), a1 = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]);
  let d = s.ccw ? a1 - a0 : a0 - a1;
  while (d <= 1e-12) d += Math.PI * 2;
  return d;
}
export const segLength = (s: PathSeg): number => (s.type === 'line' ? len(sub(s.b, s.a)) : s.r * segAngle(s));
/** Direction of travel at the start (end = false) or end of a piece. */
export function segTangent(s: PathSeg, end: boolean): P2 {
  if (s.type === 'line') return unit(sub(s.b, s.a));
  const r = unit(sub(end ? s.b : s.a, s.c));
  return s.ccw ? left(r) : mul(left(r), -1);
}
/** How much the path turns where piece a hands over to piece b: positive = to the left. */
export const turnAt = (a: PathSeg, b: PathSeg): number => { const t0 = segTangent(a, true), t1 = segTangent(b, false); return wrap(Math.atan2(t1[1], t1[0]) - Math.atan2(t0[1], t0[0])); };
export const reverseSeg = (s: PathSeg): PathSeg => (s.type === 'line' ? { ...s, a: s.b, b: s.a } : { ...s, a: s.b, b: s.a, ccw: !s.ccw });
export const reversePath = (p: PathSpec): PathSpec => ({ ...p, segs: p.segs.slice().reverse().map(reverseSeg) });

/** A point a distance d along a piece from its start. */
function pointAlong(s: PathSeg, d: number): P2 {
  if (s.type === 'line') return add(s.a, mul(unit(sub(s.b, s.a)), d));
  const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]), t = a0 + ((s.ccw ? 1 : -1) * d) / s.r;
  return [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)];
}
/** Points along a piece, for drawing and hit-testing (arcs in small steps). */
export function segPoints(s: PathSeg, step = Math.PI / 36): P2[] {
  if (s.type === 'line') return [s.a, s.b];
  const ang = segAngle(s), n = Math.max(6, Math.ceil(ang / step)), L = s.r * ang, out: P2[] = [];
  for (let i = 0; i <= n; i++) out.push(pointAlong(s, (L * i) / n));
  out[0] = s.a; out[n] = s.b;
  return out;
}
/** The path as line segments in space. */
export function pathSegments(p: PathSpec): [Vec3, Vec3][] {
  const out: [Vec3, Vec3][] = [];
  p.segs.forEach((s) => { const P = segPoints(s).map((q) => toWorld(p.frame, q[0], q[1])); for (let i = 0; i + 1 < P.length; i++) out.push([P[i], P[i + 1]]); });
  return out;
}

/** The path a sweep follows, from the sketch curves it points at. */
export function sweepPath(features: Feature[], ref: PathRef | null | undefined): { path?: PathSpec; name?: string; err?: string } {
  if (!ref || !ref.curveIds || !ref.curveIds.length) return { err: 'pick a path: click a sketch line, arc or circle' };
  const sk = features.find((f) => f.id === ref.sketchId);
  if (!sk || sk.type !== 'sketch' || !sk.frame) return { err: 'its path sketch is gone' };
  const cs = ref.curveIds.map((id) => sk.curves.find((c) => c.id === id));
  if (cs.some((c) => !c)) return { err: 'part of its path is gone' };
  const curves = cs as NonNullable<(typeof cs)[number]>[];
  if (curves.length === 1 && curves[0].type === 'circle') {
    const c = curves[0], q = PT(sk, c.c), a: P2 = [q[0] + c.r, q[1]];
    return { path: { frame: sk.frame, segs: [{ cid: c.id, type: 'arc', a, b: a, c: q, r: c.r, ccw: true, full: true }], closed: true }, name: sk.name };
  }
  if (curves.some((c) => c.type === 'circle')) return { err: 'a circle has to be the whole path on its own' };
  const deg: Record<string, number> = {};
  curves.forEach((c) => { if (c.type !== 'circle') [c.p1, c.p2].forEach((p) => { deg[p] = (deg[p] || 0) + 1; }); });
  const first = curves[0];
  if (first.type === 'circle') return { err: 'the path is too short' };
  let cur = Object.keys(deg).find((p) => deg[p] === 1) || first.p1;
  const start = cur, used = new Set<string>(), segs: PathSeg[] = [];
  for (;;) {
    const c = curves.find((x) => x.type !== 'circle' && !used.has(x.id) && (x.p1 === cur || x.p2 === cur));
    if (!c || c.type === 'circle') break;
    used.add(c.id);
    const fwd = c.p1 === cur;
    let s: PathSeg;
    if (c.type === 'line') s = { cid: c.id, type: 'line', a: PT(sk, c.p1), b: PT(sk, c.p2) };
    else s = { cid: c.id, type: 'arc', a: PT(sk, c.p1), b: PT(sk, c.p2), c: arcSweep(sk, c).q, r: c.r, ccw: true };
    if (!fwd) s = reverseSeg(s);
    if (segLength(s) > 1e-7) segs.push(s);
    cur = fwd ? c.p2 : c.p1;
  }
  if (used.size !== curves.length) return { err: 'the path has to be one connected chain' };
  if (!segs.length) return { err: 'the path is too short' };
  return { path: { frame: sk.frame, segs, closed: cur === start && curves.length > 1 }, name: sk.name };
}

/** The point of a piece nearest to q, and how far along the piece it is. */
function nearestOnSeg(s: PathSeg, q: P2): { p: P2; run: number } {
  const L = segLength(s);
  if (s.type === 'line') { const t = unit(sub(s.b, s.a)), run = Math.max(0, Math.min(L, dot(sub(q, s.a), t))); return { p: add(s.a, mul(t, run)), run }; }
  const ang = (v: P2): number => Math.atan2(v[1] - s.c[1], v[0] - s.c[0]);
  let prog = (ang(q) - ang(s.a)) * (s.ccw ? 1 : -1);
  while (prog < 0) prog += Math.PI * 2;
  while (prog >= Math.PI * 2) prog -= Math.PI * 2;
  if (prog <= segAngle(s)) return { p: pointAlong(s, prog * s.r), run: prog * s.r };
  return len(sub(q, s.a)) < len(sub(q, s.b)) ? { p: s.a, run: 0 } : { p: s.b, run: L };
}

/** A closed path starts where the profile is (splitting a piece there if needed), so the sweep begins at the profile. */
export function startNear(p: PathSpec, near: Vec3): PathSpec {
  if (!p.closed || p.segs.length < 2) return p;
  const d3 = [near[0] - p.frame.o[0], near[1] - p.frame.o[1], near[2] - p.frame.o[2]];
  const q: P2 = [d3[0] * p.frame.u[0] + d3[1] * p.frame.u[1] + d3[2] * p.frame.u[2], d3[0] * p.frame.v[0] + d3[1] * p.frame.v[1] + d3[2] * p.frame.v[2]];
  let bi = 0, bd = Infinity, bp: P2 = p.segs[0].a, br = 0;
  p.segs.forEach((s, i) => { const h = nearestOnSeg(s, q), d = len(sub(h.p, q)); if (d < bd - 1e-9) { bd = d; bi = i; bp = h.p; br = h.run; } });
  const s = p.segs[bi], L = segLength(s), m = p.segs.length;
  if (br < 1e-6 || br > L - 1e-6) { const at = br < 1e-6 ? bi : (bi + 1) % m; return at ? { ...p, segs: p.segs.slice(at).concat(p.segs.slice(0, at)) } : p; }
  return { ...p, segs: [{ ...s, a: bp } as PathSeg, ...p.segs.slice(bi + 1), ...p.segs.slice(0, bi), { ...s, b: bp } as PathSeg] };
}

// ---- Round corners: replace each sharp path corner with a true arc sized to the profile ----
type Off = { line: true; p: P2; t: P2 } | { line: false; c: P2; r: number };
/** The curve a fillet's center runs along: the piece moved sideways by rho toward side s (+1 = left). */
function offsetOf(sg: PathSeg, s: number, rho: number): Off | null {
  if (sg.type === 'line') { const t = unit(sub(sg.b, sg.a)); return { line: true, p: add(sg.a, mul(left(t), s * rho)), t }; }
  const r = sg.r - s * rho * (sg.ccw ? 1 : -1);
  return r > 1e-9 ? { line: false, c: sg.c, r } : null;
}
function meet(A: Off, B: Off): P2[] {
  if (A.line && B.line) {
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 1e-12) return [];
    const w = sub(B.p, A.p), u = (w[0] * B.t[1] - w[1] * B.t[0]) / den;
    return [add(A.p, mul(A.t, u))];
  }
  if (A.line !== B.line) {
    const L = (A.line ? A : B) as Extract<Off, { line: true }>, C = (A.line ? B : A) as Extract<Off, { line: false }>;
    const w = sub(L.p, C.c), b = dot(w, L.t), cc = dot(w, w) - C.r * C.r, disc = b * b - cc;
    if (disc < 0) return [];
    const q = Math.sqrt(disc);
    return [add(L.p, mul(L.t, -b - q)), add(L.p, mul(L.t, -b + q))];
  }
  const a = A as Extract<Off, { line: false }>, b = B as Extract<Off, { line: false }>;
  const d = len(sub(b.c, a.c));
  if (d < 1e-12 || d > a.r + b.r || d < Math.abs(a.r - b.r)) return [];
  const x = (d * d + a.r * a.r - b.r * b.r) / (2 * d), h = Math.sqrt(Math.max(0, a.r * a.r - x * x)), e = unit(sub(b.c, a.c)), m = add(a.c, mul(e, x));
  return [add(m, mul(left(e), h)), add(m, mul(left(e), -h))];
}
/** Where a fillet centered at q touches a piece. */
const footOn = (sg: PathSeg, q: P2): P2 => {
  if (sg.type === 'line') { const t = unit(sub(sg.b, sg.a)); return add(sg.a, mul(t, dot(sub(q, sg.a), t))); }
  return add(sg.c, mul(unit(sub(q, sg.c)), sg.r));
};
/** Distance along a piece from one of its ends (the corner) to a point on it; negative if the point is off that end. */
function runFrom(sg: PathSeg, atEnd: boolean, p: P2): number {
  const q = atEnd ? sg.b : sg.a;
  if (sg.type === 'line') { const t = unit(sub(sg.b, sg.a)); return dot(sub(p, q), t) * (atEnd ? -1 : 1); }
  const ang = (v: P2): number => Math.atan2(v[1] - sg.c[1], v[0] - sg.c[0]);
  return wrap((ang(p) - ang(q)) * (sg.ccw ? 1 : -1) * (atEnd ? -1 : 1)) * sg.r;
}

/**
 * Round corners. `inner(side)` is how far the profile reaches toward the inside of a bend that
 * turns to that side (+1 = left). The bend's radius is about twice that reach, so the inside is
 * rounded too; a corner with too little room for a bend the profile fits around is left sharp.
 */
export function roundPath(p: PathSpec, inner: (side: number) => number): PathSpec {
  const segs = p.segs.slice(), m = segs.length;
  if (m < 2) return p;
  const sharp = (i: number): boolean => { const d = Math.abs(turnAt(segs[i - 1], segs[i])); return d > SHARP && d < Math.PI * 0.97; };
  const closingSharp = p.closed && Math.abs(turnAt(segs[m - 1], segs[0])) > SHARP;
  const bends: (PathSeg | null)[] = segs.map(() => null);
  // room on each side of a corner: half the piece if its other end is a corner too, else nearly all of it
  const room = segs.map((s, i) => {
    const startCorner = i > 0 ? sharp(i) : closingSharp, endCorner = i + 1 < m ? sharp(i + 1) : closingSharp;
    return segLength(s) * (startCorner && endCorner ? 0.5 : 1) * 0.95;
  });
  const trims: { i: number; ta: P2; tb: P2 }[] = [];
  for (let i = 1; i < m; i++) {
    if (!sharp(i)) continue;
    const A = segs[i - 1], B = segs[i], delta = turnAt(A, B), s = Math.sign(delta), h = Math.abs(delta) / 2, reach = Math.max(0, inner(s));
    // same apex as the prototype's bend: (2 × reach + 0.5), eased toward the corner
    let rho = ((2 * reach + 0.5) * (1 + Math.cos(h))) / 2, found: { q: P2; ta: P2; tb: P2 } | null = null;
    for (let it = 0; it < 24 && rho > 1e-3; it++) {
      const oa = offsetOf(A, s, rho), ob = offsetOf(B, s, rho);
      const cands = oa && ob ? meet(oa, ob) : [];
      const q = cands.sort((x, y) => len(sub(x, A.b)) - len(sub(y, A.b)))[0];
      if (!q) { rho *= 0.7; continue; }
      const ta = footOn(A, q), tb = footOn(B, q), da = runFrom(A, true, ta), db = runFrom(B, false, tb);
      if (da < 1e-9 || db < 1e-9) { rho *= 0.7; continue; }
      const over = Math.max(da / room[i - 1], db / room[i]);
      if (over <= 1 + 1e-9) { found = { q, ta, tb }; break; }
      rho *= Math.min(0.98, 1 / over);
    }
    if (!found || rho <= reach * 1.02) continue; // no room for a bend the profile fits around: stays sharp
    bends[i] = { cid: 'rc' + i, type: 'arc', a: found.ta, b: found.tb, c: found.q, r: rho, ccw: s > 0 };
    trims.push({ i, ta: found.ta, tb: found.tb });
  }
  if (!trims.length) return p;
  trims.forEach(({ i, ta, tb }) => { segs[i - 1] = { ...segs[i - 1], b: ta, full: undefined } as PathSeg; segs[i] = { ...segs[i], a: tb, full: undefined } as PathSeg; });
  const out: PathSeg[] = [];
  segs.forEach((s, i) => { if (bends[i]) out.push(bends[i]!); if (segLength(s) > 1e-7) out.push(s); });
  return { ...p, segs: out };
}
