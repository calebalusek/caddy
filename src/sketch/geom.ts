// Sketch geometry queries that need no screen or 3D: snap candidates, nearest points, chains,
// offsets and trimming. Carried over from the prototype.
import {
  arcSweep, cmap, conCurves, conPoints, curvePtIds, curvePts, d2, inSweep, isEdgeCurve, normAng, pip, PT, segDist, signedArea, usedPoints,
  type ArcCurve, type CircleCurve, type Curve, type LineCurve, type P2, type SketchData,
} from './model';
import type { ExtSnap } from '../model/types';
import { inProfile, type Profile } from './profiles';

export type SnapKind = 'end' | 'center' | 'origin' | 'mid' | 'int' | 'quad' | 'near' | 'track' | 'track2';
export interface SnapCand { p: P2; kind: SnapKind; id?: string; cv?: string; cv2?: string; ext?: boolean }
/** Restricts snapping to some curves and points (Move's base point must be on the selection). */
export interface SnapScope { curves: Set<string>; points: Set<string> }
export interface Sel { kind: 'point' | 'curve' | 'con'; id: string }

export const curveOf = (sk: SketchData, id: string): Curve | undefined => sk.curves.find((c) => c.id === id);
type Round = ArcCurve | CircleCurve;

export function segCircle(a: P2, b: P2, q: P2, R: number): P2[] {
  const r = [b[0] - a[0], b[1] - a[1]], f = [a[0] - q[0], a[1] - q[1]], A = r[0] * r[0] + r[1] * r[1], B = 2 * (f[0] * r[0] + f[1] * r[1]), C = f[0] * f[0] + f[1] * f[1] - R * R, disc = B * B - 4 * A * C;
  if (disc < 0 || A < 1e-12) return [];
  const sq = Math.sqrt(disc), out: P2[] = [];
  [(-B - sq) / (2 * A), (-B + sq) / (2 * A)].forEach((t) => { if (t >= -1e-9 && t <= 1 + 1e-9) out.push([a[0] + r[0] * t, a[1] + r[1] * t]); });
  return out;
}
export function circCircle(q1: P2, r1: number, q2: P2, r2: number): P2[] {
  const d = d2(q1, q2);
  if (d < 1e-9 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d), h = Math.sqrt(Math.max(0, r1 * r1 - a * a)), u = [(q2[0] - q1[0]) / d, (q2[1] - q1[1]) / d];
  const P: P2 = [q1[0] + u[0] * a, q1[1] + u[1] * a];
  return h < 1e-9 ? [P] : [[P[0] - u[1] * h, P[1] + u[0] * h], [P[0] + u[1] * h, P[1] - u[0] * h]];
}

/** Every point the cursor can snap to: ends, centers, origin, midpoints, quadrants, intersections, face points. */
export function snapCands(sk: SketchData, scope?: SnapScope | null, ext?: ExtSnap[]): SnapCand[] {
  const out: SnapCand[] = [], curves = sk.curves.filter((c) => !scope || scope.curves.has(c.id));
  const ends = new Set<string>();
  sk.curves.forEach((c) => { if (isEdgeCurve(c)) { ends.add(c.p1); ends.add(c.p2); } });
  const pts = new Set<string>();
  curves.forEach((c) => curvePtIds(c).forEach((p) => pts.add(p)));
  if (scope) scope.points.forEach((p) => pts.add(p)); else pts.add('O');
  pts.forEach((id) => { if (!sk.pts[id]) return; out.push({ p: PT(sk, id), id, kind: id === 'O' ? 'origin' : ends.has(id) ? 'end' : 'center' }); });
  const segs: [P2, P2, string][] = [], circs: [P2, number, string, Round][] = [];
  curves.forEach((c) => {
    if (c.type === 'line') { const a = PT(sk, c.p1), b = PT(sk, c.p2); segs.push([a, b, c.id]); out.push({ p: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], kind: 'mid', cv: c.id }); return; }
    const q = PT(sk, c.c);
    circs.push([q, c.r, c.id, c]);
    if (c.type === 'arc') { const { a1, sw } = arcSweep(sk, c), t = a1 + sw / 2; out.push({ p: [q[0] + c.r * Math.cos(t), q[1] + c.r * Math.sin(t)], kind: 'mid', cv: c.id }); }
    for (let i = 0; i < 4; i++) { const t = (i * Math.PI) / 2; if (c.type === 'arc' && !inSweep(sk, c, t)) continue; out.push({ p: [q[0] + c.r * Math.cos(t), q[1] + c.r * Math.sin(t)], kind: 'quad', cv: c.id }); }
  });
  const onCirc = (cc: [P2, number, string, Round], p: P2): boolean => cc[3].type !== 'arc' || inSweep(sk, cc[3], Math.atan2(p[1] - cc[0][1], p[0] - cc[0][0]));
  for (let i = 0; i < segs.length; i++) {
    const [a, b, ida] = segs[i], r = [b[0] - a[0], b[1] - a[1]];
    for (let j = i + 1; j < segs.length; j++) {
      const [c, d, idb] = segs[j], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) < 1e-12) continue;
      const q = [c[0] - a[0], c[1] - a[1]], t = (q[0] * s[1] - q[1] * s[0]) / den, u = (q[0] * r[1] - q[1] * r[0]) / den;
      if (t >= -1e-9 && t <= 1 + 1e-9 && u >= -1e-9 && u <= 1 + 1e-9) out.push({ p: [a[0] + r[0] * t, a[1] + r[1] * t], kind: 'int', cv: ida, cv2: idb });
    }
    circs.forEach((cc) => segCircle(a, b, cc[0], cc[1]).forEach((p) => { if (onCirc(cc, p)) out.push({ p, kind: 'int', cv: ida, cv2: cc[2] }); }));
  }
  for (let i = 0; i < circs.length; i++)
    for (let j = i + 1; j < circs.length; j++)
      circCircle(circs[i][0], circs[i][1], circs[j][0], circs[j][1]).forEach((p) => { if (onCirc(circs[i], p) && onCirc(circs[j], p)) out.push({ p, kind: 'int', cv: circs[i][2], cv2: circs[j][2] }); });
  if (!scope && ext) ext.forEach((c) => out.push({ p: [c.p[0], c.p[1]], kind: c.kind, ext: true }));
  return out;
}

/** Closest point on any curve, with the curve's id. */
export function nearestOn(sk: SketchData, raw: P2, scope?: SnapScope | null): { p: P2; cv: string } | null {
  let best: P2 | null = null, bd = Infinity, bestId = '';
  sk.curves.forEach((c) => {
    if (scope && !scope.curves.has(c.id)) return;
    let p: P2;
    if (c.type === 'line') {
      const a = PT(sk, c.p1), b = PT(sk, c.p2), dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
      let t = L ? ((raw[0] - a[0]) * dx + (raw[1] - a[1]) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      p = [a[0] + dx * t, a[1] + dy * t];
    } else {
      const q = PT(sk, c.c), d = d2(raw, q) || 1;
      p = [q[0] + ((raw[0] - q[0]) / d) * c.r, q[1] + ((raw[1] - q[1]) / d) * c.r];
      if (c.type === 'arc' && !inSweep(sk, c, Math.atan2(raw[1] - q[1], raw[0] - q[0]))) p = d2(raw, PT(sk, c.p1)) < d2(raw, PT(sk, c.p2)) ? PT(sk, c.p1) : PT(sk, c.p2);
    }
    const dd = d2(p, raw);
    if (dd < bd) { bd = dd; best = p; bestId = c.id; }
  });
  return best ? { p: best, cv: bestId } : null;
}

export function curveDist(sk: SketchData, c: Curve, p: P2): number {
  if (c.type === 'line') return segDist(p, PT(sk, c.p1), PT(sk, c.p2));
  const q = PT(sk, c.c), d = Math.abs(d2(p, q) - c.r);
  if (c.type === 'circle' || inSweep(sk, c, Math.atan2(p[1] - q[1], p[0] - q[0]))) return d;
  return Math.min(d2(p, PT(sk, c.p1)), d2(p, PT(sk, c.p2)));
}

const lineDegree = (sk: SketchData, pid: string, constr: boolean, arcs?: boolean): number =>
  sk.curves.filter((c) => (c.type === 'line' || (arcs && c.type === 'arc')) && !!c.construction === constr && ((c as LineCurve).p1 === pid || (c as LineCurve).p2 === pid)).length;

/** The connected run of lines (and arcs, if asked) through a curve, stopping at branches. */
export function chainOf(sk: SketchData, curveId: string, arcs?: boolean): Sel[] {
  const start = curveOf(sk, curveId);
  if (!start) return [];
  if (!(start.type === 'line' || (arcs && start.type === 'arc'))) return [{ kind: 'curve', id: curveId }];
  const ok = (c: Curve): c is LineCurve | ArcCurve => (c.type === 'line' || (!!arcs && c.type === 'arc')) && !!c.construction === !!start.construction;
  const seen = new Set([start.id]), queue: (LineCurve | ArcCurve)[] = [start as LineCurve | ArcCurve];
  while (queue.length) {
    const l = queue.shift()!;
    [l.p1, l.p2].forEach((p) => {
      if (lineDegree(sk, p, !!start.construction, arcs) !== 2) return;
      sk.curves.forEach((c) => { if (ok(c) && !seen.has(c.id) && (c.p1 === p || c.p2 === p)) { seen.add(c.id); queue.push(c); } });
    });
  }
  return [...seen].map((id) => ({ kind: 'curve' as const, id }));
}

/** A closed shape is picked as one object; anything else is just the item itself. */
export function objectOf(sk: SketchData, h: Sel): Sel[] {
  if (h.kind === 'point') return [h];
  const c = curveOf(sk, h.id);
  if (!c || !isEdgeCurve(c)) return [h];
  const chain = chainOf(sk, h.id, true), ids = new Set(chain.map((x) => x.id));
  const pts = new Set<string>();
  chain.forEach((x) => { const l = curveOf(sk, x.id) as LineCurve; pts.add(l.p1); pts.add(l.p2); });
  const closed = [...pts].every((p) => sk.curves.filter((l) => ids.has(l.id) && ((l as LineCurve).p1 === p || (l as LineCurve).p2 === p)).length === 2);
  return closed ? chain : [h];
}

export interface Chain { ids: string[]; ls: LineCurve[]; closed: boolean }
export function buildChains(_sk: SketchData, lines: LineCurve[]): Chain[] {
  const byPt = new Map<string, LineCurve[]>();
  lines.forEach((l) => [l.p1, l.p2].forEach((p) => { if (!byPt.has(p)) byPt.set(p, []); byPt.get(p)!.push(l); }));
  const used = new Set<string>(), chains: Chain[] = [];
  const walk = (start: string): { ids: string[]; ls: LineCurve[] } => {
    const ids = [start], ls: LineCurve[] = [];
    let p = start;
    for (;;) {
      const next = (byPt.get(p) || []).find((l) => !used.has(l.id));
      if (!next) break;
      used.add(next.id); ls.push(next);
      p = next.p1 === p ? next.p2 : next.p1;
      ids.push(p);
      if (p === start || (byPt.get(p) || []).length > 2) break;
    }
    return { ids, ls };
  };
  [...byPt.entries()].filter(([, ls]) => ls.length !== 2).forEach(([p]) => {
    while ((byPt.get(p) || []).some((l) => !used.has(l.id))) { const w = walk(p); if (!w.ls.length) break; chains.push({ ids: w.ids, ls: w.ls, closed: false }); }
  });
  lines.forEach((l) => {
    if (used.has(l.id)) return;
    const w = walk(l.p1);
    const closed = w.ids.length > 2 && w.ids[w.ids.length - 1] === w.ids[0];
    if (closed) w.ids.pop();
    chains.push({ ids: w.ids, ls: w.ls, closed });
  });
  return chains;
}

export function offsetPolyline(P: P2[], closed: boolean, dist: number): P2[] {
  const n = P.length, m = closed ? n : n - 1, segs: { a: P2; u: P2; nr: P2 }[] = [];
  for (let i = 0; i < m; i++) {
    const a = P[i], b = P[(i + 1) % n], L = d2(a, b) || 1, u: P2 = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], nr: P2 = [-u[1], u[0]];
    segs.push({ a: [a[0] + nr[0] * dist, a[1] + nr[1] * dist], u, nr });
  }
  const out: P2[] = [];
  for (let j = 0; j < n; j++) {
    if (!closed && j === 0) { out.push([segs[0].a[0], segs[0].a[1]]); continue; }
    if (!closed && j === n - 1) { const s = segs[m - 1]; out.push([P[j][0] + s.nr[0] * dist, P[j][1] + s.nr[1] * dist]); continue; }
    const s1 = segs[(j - 1 + m) % m], s2 = segs[j % m], den = s1.u[0] * s2.u[1] - s1.u[1] * s2.u[0];
    if (Math.abs(den) < 1e-9) { out.push([P[j][0] + s2.nr[0] * dist, P[j][1] + s2.nr[1] * dist]); continue; }
    const q = [s2.a[0] - s1.a[0], s2.a[1] - s1.a[1]], t = (q[0] * s2.u[1] - q[1] * s2.u[0]) / den;
    out.push([s1.a[0] + s1.u[0] * t, s1.a[1] + s1.u[1] * t]);
  }
  return out;
}
/** Which side of a closed chain the cursor is on: +1 offsets outward for a counter-clockwise loop. */
export const closedSide = (cur: P2, P: P2[]): number => (pip(cur, P) === signedArea(P) > 0 ? 1 : -1);

export interface Hit { t: number; p: P2; by: string }
/** Where other curves cross cv: line t in 0…1, circle angle, arc sweep offset. */
export function curveHits(sk: SketchData, cv: Curve): Hit[] {
  const hits: Hit[] = [], q = cv.type !== 'line' ? PT(sk, cv.c) : null;
  const toParam = (p: P2): number => {
    if (cv.type === 'line') { const a = PT(sk, cv.p1), b = PT(sk, cv.p2), dx = b[0] - a[0], dy = b[1] - a[1]; return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy); }
    const ang = Math.atan2(p[1] - q![1], p[0] - q![0]);
    if (cv.type === 'circle') return normAng(ang);
    return normAng(ang - arcSweep(sk, cv).a1);
  };
  const within = (o: Curve, p: P2): boolean => o.type !== 'arc' || inSweep(sk, o, Math.atan2(p[1] - PT(sk, o.c)[1], p[0] - PT(sk, o.c)[0]));
  sk.curves.forEach((o) => {
    if (o.id === cv.id) return;
    let pts: P2[] = [];
    if (cv.type === 'line' && o.type === 'line') {
      const a = PT(sk, cv.p1), b = PT(sk, cv.p2), c = PT(sk, o.p1), d = PT(sk, o.p2), r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(den) > 1e-12) { const w = [c[0] - a[0], c[1] - a[1]], t = (w[0] * s[1] - w[1] * s[0]) / den, u = (w[0] * r[1] - w[1] * r[0]) / den; if (u >= -1e-9 && u <= 1 + 1e-9) pts.push([a[0] + r[0] * t, a[1] + r[1] * t]); }
    } else if (cv.type === 'line') pts = segCircle(PT(sk, cv.p1), PT(sk, cv.p2), PT(sk, (o as Round).c), (o as Round).r).filter((p) => within(o, p));
    else if (o.type === 'line') pts = segCircle(PT(sk, o.p1), PT(sk, o.p2), q!, cv.r).filter((p) => within(cv, p));
    else pts = circCircle(q!, cv.r, PT(sk, o.c), o.r).filter((p) => within(o, p) && within(cv, p));
    pts.forEach((p) => hits.push({ t: toParam(p), p, by: o.id }));
  });
  return hits;
}

export interface TrimTarget { cv: Curve; whole?: boolean; lo?: Hit | null; hi?: Hit | null }
/** The piece of a curve under the cursor, between the crossings on either side. */
export function trimTarget(sk: SketchData, cvId: string, raw: P2): TrimTarget | null {
  const cv = curveOf(sk, cvId);
  if (!cv) return null;
  const hits = curveHits(sk, cv);
  if (cv.type === 'circle') {
    const ts = hits.slice().sort((x, y) => x.t - y.t).filter((h, i, a) => i === 0 || h.t - a[i - 1].t > 1e-7);
    if (ts.length < 2) return { cv, whole: true };
    const q = PT(sk, cv.c), th = normAng(Math.atan2(raw[1] - q[1], raw[0] - q[0]));
    let i = ts.findIndex((h, k) => th >= h.t && th < (k + 1 < ts.length ? ts[k + 1].t : Infinity));
    if (i < 0) i = ts.length - 1;
    return { cv, lo: ts[i], hi: ts[(i + 1) % ts.length] };
  }
  const end = cv.type === 'line' ? 1 : arcSweep(sk, cv).sw;
  const ts = hits.filter((h) => h.t > 1e-6 && h.t < end - 1e-6).sort((x, y) => x.t - y.t);
  let tc: number;
  if (cv.type === 'line') { const a = PT(sk, cv.p1), b = PT(sk, cv.p2), dx = b[0] - a[0], dy = b[1] - a[1]; tc = ((raw[0] - a[0]) * dx + (raw[1] - a[1]) * dy) / (dx * dx + dy * dy); }
  else { const q = PT(sk, cv.c); tc = normAng(Math.atan2(raw[1] - q[1], raw[0] - q[0]) - arcSweep(sk, cv).a1); }
  let lo: Hit | null = null, hi: Hit | null = null;
  ts.forEach((h) => { if (h.t <= tc) lo = h; else if (!hi) hi = h; });
  if (!lo && !hi) return { cv, whole: true };
  return { cv, lo, hi };
}
export function trimPreviewPts(sk: SketchData, tg: TrimTarget): P2[] {
  const cv = tg.cv;
  if (tg.whole) return curvePts(sk, cv);
  if (cv.type === 'line') { const a = PT(sk, cv.p1), b = PT(sk, cv.p2); return [tg.lo ? tg.lo.p : a, tg.hi ? tg.hi.p : b]; }
  const q = PT(sk, cv.c), base = cv.type === 'arc' ? arcSweep(sk, cv) : { a1: 0, sw: Math.PI * 2 };
  const t0 = tg.lo ? tg.lo.t : 0, t1 = tg.hi ? (tg.hi.t > t0 ? tg.hi.t : tg.hi.t + Math.PI * 2) : base.sw, out: P2[] = [], n = Math.max(6, Math.ceil((t1 - t0) / (Math.PI / 36)));
  for (let i = 0; i <= n; i++) { const a = base.a1 + t0 + ((t1 - t0) * i) / n; out.push([q[0] + cv.r * Math.cos(a), q[1] + cv.r * Math.sin(a)]); }
  return out;
}

/** Drop points nothing uses and constraints whose geometry is gone. */
export function removeOrphans(sk: SketchData): void {
  const used = usedPoints(sk);
  Object.keys(sk.pts).forEach((id) => { if (id !== 'O' && !used.has(id)) delete sk.pts[id]; });
  const cids = new Set(sk.curves.map((c) => c.id));
  sk.cons = sk.cons.filter((c) => conCurves(c).every((id) => cids.has(id)) && conPoints(c).every((id) => sk.pts[id]));
  const ids = new Set(sk.cons.map((c) => c.id));
  sk.cons = sk.cons.filter((c) => !c.ref || typeof c.ref !== 'string' || ids.has(c.ref));
}

/** Bounding box center of everything drawn, or null for an empty sketch. */
export function sketchBoundsCenter(sk: SketchData): P2 | null {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  sk.curves.forEach((c) => curvePts(sk, c).forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
  return x0 < Infinity ? [(x0 + x1) / 2, (y0 + y1) / 2] : null;
}

/**
 * Remembers where a region is (sample points inside it and its area), so a feature can find
 * "its" region again after the sketch is edited and the region's key changes.
 */
export function profileHint(pr: Profile): { pts: P2[]; area: number } {
  const P = pr.loop.poly;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  P.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
  const pts: P2[] = [];
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { const q: P2 = [x0 + ((x1 - x0) * (i + 0.5)) / 8, y0 + ((y1 - y0) * (j + 0.5)) / 8]; if (inProfile(q, pr)) pts.push(q); }
  return { pts: pts.slice(0, 48).map((q) => q.map((v) => Math.round(v * 1000) / 1000) as P2), area: Math.round(pr.area * 1000) / 1000 };
}

export { cmap };
