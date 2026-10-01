// Profiles: the closed regions of a sketch that can be extruded, revolved or swept.
//
// The prototype found regions on a faceted copy of the sketch, and circles never split anything.
// Here the curves are split exactly where they cross (line/line, line/arc, arc/arc, circles too),
// and every loop keeps its true lines and arcs so the kernel builds real cylinders, not facets.
import { arcSweep, circlePts, d2, normAng, pip, PT, type Curve, type P2, type SketchData } from './model';

/** One piece of a loop boundary, in travel order. */
export type Edge2 =
  | { type: 'line'; a: P2; b: P2; parent: string }
  | { type: 'arc'; a: P2; b: P2; c: P2; r: number; ccw: boolean; parent: string };

export interface Loop {
  key: string;
  kind: 'poly' | 'circle';
  /** Exact boundary, counter-clockwise. A free circle has no edges; use c and r. */
  edges: Edge2[];
  /** Faceted outline for display and point-in-region tests. */
  pts: P2[];
  poly: P2[];
  /** For each pts[i] → pts[i+1] segment: is it part of an arc? */
  arcSeg: boolean[];
  parents: string[];
  c?: P2;
  r?: number;
  /** Exact area. */
  area: number;
  parent: Loop | null;
}

export interface Profile {
  key: string;
  loop: Loop;
  holes: Loop[];
  /** Exact area of the region (loop minus holes). */
  area: number;
  outer: boolean;
  /** Set when the sketch is drawn: a point safely inside the region, and where the drag arrow sits. */
  inner?: P2;
  centroid?: P2;
}

const TAU = Math.PI * 2;
const ARC_STEP = Math.PI / 60;

type Prim =
  | { kind: 'line'; id: string; a: P2; b: P2; cuts: number[] }
  | { kind: 'arc'; id: string; c: P2; r: number; a1: number; sw: number; full: boolean; cuts: number[] };

/** Points where an infinite line through a,b meets a circle, as line parameters t. */
function lineCircle(a: P2, b: P2, c: P2, r: number): number[] {
  const dx = b[0] - a[0], dy = b[1] - a[1], fx = a[0] - c[0], fy = a[1] - c[1];
  const A = dx * dx + dy * dy, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - r * r;
  if (A < 1e-18) return [];
  let disc = B * B - 4 * A * C;
  const tol = 1e-9 * (B * B + 4 * A * Math.abs(C) + 1e-12);
  if (disc < -tol) return [];
  if (disc < tol) disc = 0;
  const s = Math.sqrt(disc);
  return disc === 0 ? [-B / (2 * A)] : [(-B - s) / (2 * A), (-B + s) / (2 * A)];
}
function circleCircle(c1: P2, r1: number, c2: P2, r2: number): P2[] {
  const d = d2(c1, c2);
  if (d < 1e-9 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  let h2 = r1 * r1 - a * a;
  if (h2 < 0) h2 = 0;
  const h = Math.sqrt(h2), ux = (c2[0] - c1[0]) / d, uy = (c2[1] - c1[1]) / d;
  const mx = c1[0] + ux * a, my = c1[1] + uy * a;
  return h < 1e-7 ? [[mx, my]] : [[mx - uy * h, my + ux * h], [mx + uy * h, my - ux * h]];
}

const angOf = (c: P2, p: P2): number => Math.atan2(p[1] - c[1], p[0] - c[0]);
/** Where a point on the arc's circle falls along its sweep (0…sw), or null if outside the arc. */
function arcParam(P: Prim & { kind: 'arc' }, p: P2): number | null {
  if (P.full) return normAng(angOf(P.c, p) - P.a1);
  const t = normAng(angOf(P.c, p) - P.a1), tolA = 1e-7 / Math.max(P.r, 1e-6);
  if (t <= P.sw + tolA) return Math.min(t, P.sw);
  if (t >= TAU - tolA) return 0;
  return null;
}
function lineParam(P: Prim & { kind: 'line' }, p: P2): number | null {
  const dx = P.b[0] - P.a[0], dy = P.b[1] - P.a[1], L2 = dx * dx + dy * dy;
  const t = ((p[0] - P.a[0]) * dx + (p[1] - P.a[1]) * dy) / L2, tol = 1e-7 / Math.sqrt(L2);
  return t >= -tol && t <= 1 + tol ? Math.max(0, Math.min(1, t)) : null;
}
const paramOf = (P: Prim, p: P2): number | null => (P.kind === 'line' ? lineParam(P, p) : arcParam(P, p));

function crossings(P: Prim, Q: Prim): P2[] {
  if (P.kind === 'line' && Q.kind === 'line') {
    const r = [P.b[0] - P.a[0], P.b[1] - P.a[1]], s = [Q.b[0] - Q.a[0], Q.b[1] - Q.a[1]], den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-12) return [];
    const q = [Q.a[0] - P.a[0], Q.a[1] - P.a[1]], t = (q[0] * s[1] - q[1] * s[0]) / den;
    return [[P.a[0] + r[0] * t, P.a[1] + r[1] * t]];
  }
  if (P.kind === 'line' && Q.kind === 'arc') return lineCircle(P.a, P.b, Q.c, Q.r).map((t) => [P.a[0] + (P.b[0] - P.a[0]) * t, P.a[1] + (P.b[1] - P.a[1]) * t] as P2);
  if (P.kind === 'arc' && Q.kind === 'line') return crossings(Q, P);
  if (P.kind === 'arc' && Q.kind === 'arc') return circleCircle(P.c, P.r, Q.c, Q.r);
  return [];
}

interface Vert { p: P2; edges: GEdge[] }
interface GEdge { A: Vert; B: Vert; geom: Edge2; len: number; alive: boolean }
interface Half { from: Vert; to: Vert; e: GEdge; fwd: boolean; twin: Half; ang: number }

/** Point at arc-length s from the start of an oriented edge. */
function along(g: Edge2, s: number): P2 {
  if (g.type === 'line') { const L = d2(g.a, g.b) || 1; return [g.a[0] + ((g.b[0] - g.a[0]) * s) / L, g.a[1] + ((g.b[1] - g.a[1]) * s) / L]; }
  const t = angOf(g.c, g.a) + ((g.ccw ? 1 : -1) * s) / g.r;
  return [g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)];
}
const reversed = (g: Edge2): Edge2 => (g.type === 'line' ? { type: 'line', a: g.b, b: g.a, parent: g.parent } : { type: 'arc', a: g.b, b: g.a, c: g.c, r: g.r, ccw: !g.ccw, parent: g.parent });
/** Signed sweep of an oriented arc edge. */
export function arcDelta(g: Edge2 & { type: 'arc' }): number {
  const d = normAng(angOf(g.c, g.b) - angOf(g.c, g.a)); // counter-clockwise angle from a to b
  if (g.ccw) return d < 1e-12 ? TAU : d;
  return d < 1e-12 ? -TAU : -(TAU - d);
}
/** Exact signed area enclosed by a closed chain of edges (positive = counter-clockwise). */
function chainArea(edges: Edge2[]): number {
  let A = 0;
  for (const g of edges) {
    A += (g.a[0] * g.b[1] - g.b[0] * g.a[1]) / 2;
    if (g.type === 'arc') { const d = arcDelta(g); A += (g.r * g.r * (d - Math.sin(d))) / 2; }
  }
  return A;
}
function facet(g: Edge2): P2[] {
  if (g.type === 'line') return [g.a];
  const d = arcDelta(g), n = Math.max(2, Math.ceil(Math.abs(d) / ARC_STEP)), t0 = angOf(g.c, g.a), out: P2[] = [g.a];
  for (let i = 1; i < n; i++) { const t = t0 + (d * i) / n; out.push([g.c[0] + g.r * Math.cos(t), g.c[1] + g.r * Math.sin(t)]); }
  return out;
}

export function sketchLoops(sk: SketchData): Loop[] {
  const prims: Prim[] = [];
  const freeCircles: Curve[] = [];
  sk.curves.forEach((c) => {
    if (c.construction) return;
    if (c.type === 'line') { const a = PT(sk, c.p1), b = PT(sk, c.p2); if (d2(a, b) > 1e-9) prims.push({ kind: 'line', id: c.id, a, b, cuts: [] }); }
    else if (c.type === 'arc') { const s = arcSweep(sk, c); if (c.r > 1e-6) prims.push({ kind: 'arc', id: c.id, c: s.q, r: c.r, a1: s.a1, sw: s.sw, full: false, cuts: [] }); }
    else if (c.r > 1e-6) prims.push({ kind: 'arc', id: c.id, c: PT(sk, c.c), r: c.r, a1: 0, sw: TAU, full: true, cuts: [] });
  });

  // split every curve where another one crosses or touches it
  for (let i = 0; i < prims.length; i++) {
    for (let j = i + 1; j < prims.length; j++) {
      for (const p of crossings(prims[i], prims[j])) {
        const ti = paramOf(prims[i], p), tj = paramOf(prims[j], p);
        if (ti === null || tj === null) continue;
        prims[i].cuts.push(ti);
        prims[j].cuts.push(tj);
      }
    }
  }

  const verts: Vert[] = [];
  const vget = (p: P2): Vert => {
    for (const v of verts) if (Math.abs(v.p[0] - p[0]) < 1e-6 && Math.abs(v.p[1] - p[1]) < 1e-6) return v;
    const v: Vert = { p, edges: [] };
    verts.push(v);
    return v;
  };
  const edges: GEdge[] = [];
  const addEdge = (geom: Edge2, len: number): void => {
    const A = vget(geom.a), B = vget(geom.b);
    if (A === B) return;
    const g: Edge2 = geom.type === 'line' ? { ...geom, a: A.p, b: B.p } : { ...geom, a: A.p, b: B.p };
    const mid = along(g, len / 2);
    // the same piece drawn twice counts once
    if (A.edges.some((e) => (e.A === B || e.B === B) && e.geom.type === g.type && d2(along(e.geom, e.len / 2), mid) < 1e-6)) return;
    const e: GEdge = { A, B, geom: g, len, alive: true };
    edges.push(e); A.edges.push(e); B.edges.push(e);
  };

  const loops: Loop[] = [];
  for (const P of prims) {
    if (P.kind === 'line') {
      const L = d2(P.a, P.b), tol = 1e-7 / L;
      const ts = [0, 1, ...P.cuts.filter((t) => t > tol && t < 1 - tol)].sort((x, y) => x - y);
      const at = (t: number): P2 => [P.a[0] + (P.b[0] - P.a[0]) * t, P.a[1] + (P.b[1] - P.a[1]) * t];
      for (let k = 0; k + 1 < ts.length; k++) if ((ts[k + 1] - ts[k]) * L > 1e-7) addEdge({ type: 'line', a: at(ts[k]), b: at(ts[k + 1]), parent: P.id }, (ts[k + 1] - ts[k]) * L);
    } else {
      const tol = 1e-7 / P.r;
      const at = (t: number): P2 => [P.c[0] + P.r * Math.cos(P.a1 + t), P.c[1] + P.r * Math.sin(P.a1 + t)];
      let ts: number[];
      if (P.full) {
        const cuts = [...new Set(P.cuts.map((t) => normAng(t)))].sort((x, y) => x - y).filter((t, i, a) => i === 0 || t - a[i - 1] > tol);
        if (cuts.length > 1 && TAU - cuts[cuts.length - 1] + cuts[0] <= tol) cuts.pop();
        if (!cuts.length) { freeCircles.push(sk.curves.find((c) => c.id === P.id)!); continue; }
        if (cuts.length === 1) cuts.push(normAng(cuts[0] + Math.PI)); // never leave a piece that starts and ends at one point
        cuts.sort((x, y) => x - y);
        ts = cuts.concat([cuts[0] + TAU]);
      } else ts = [0, P.sw, ...P.cuts.filter((t) => t > tol && t < P.sw - tol)].sort((x, y) => x - y);
      for (let k = 0; k + 1 < ts.length; k++) if ((ts[k + 1] - ts[k]) * P.r > 1e-7) addEdge({ type: 'arc', a: at(ts[k]), b: at(ts[k + 1]), c: P.c, r: P.r, ccw: true, parent: P.id }, (ts[k + 1] - ts[k]) * P.r);
    }
  }

  // drop dead ends: they cannot bound a region
  let changed = true;
  while (changed) {
    changed = false;
    verts.forEach((v) => { const alive = v.edges.filter((e) => e.alive); if (alive.length === 1) { alive[0].alive = false; changed = true; } });
  }

  const hes: Half[] = [];
  const out = new Map<Vert, Half[]>();
  edges.filter((e) => e.alive).forEach((e) => {
    const h1 = { from: e.A, to: e.B, e, fwd: true, ang: 0 } as Half, h2 = { from: e.B, to: e.A, e, fwd: false, ang: 0 } as Half;
    h1.twin = h2; h2.twin = h1;
    hes.push(h1, h2);
  });
  hes.forEach((h) => { if (!out.has(h.from)) out.set(h.from, []); out.get(h.from)!.push(h); });
  out.forEach((list, v) => {
    // leaving direction, sampled a short way along each edge so tangent curves sort correctly
    const s = Math.min(0.01, 0.25 * Math.min(...list.map((h) => h.e.len)));
    list.forEach((h) => { const q = along(h.fwd ? h.e.geom : reversed(h.e.geom), s); h.ang = Math.atan2(q[1] - v.p[1], q[0] - v.p[0]); });
    list.sort((x, y) => x.ang - y.ang);
  });

  const used = new Set<Half>();
  hes.forEach((h0) => {
    if (used.has(h0)) return;
    const cyc: Half[] = [];
    let h = h0, guard = 0;
    while (!used.has(h) && guard++ < 10000) {
      used.add(h); cyc.push(h);
      const l = out.get(h.to)!, i = l.indexOf(h.twin);
      h = l[(i - 1 + l.length) % l.length];
    }
    if (h !== h0) return;
    const chain = cyc.map((x) => (x.fwd ? x.e.geom : reversed(x.e.geom)));
    const area = chainArea(chain);
    if (area <= 1e-9) return; // the outside of the shape runs clockwise
    const pts: P2[] = [], arcSeg: boolean[] = [];
    chain.forEach((g) => { const f = facet(g); f.forEach((p) => { pts.push(p); arcSeg.push(g.type === 'arc'); }); });
    loops.push({ key: '', kind: 'poly', edges: chain, pts, poly: pts, arcSeg, parents: [...new Set(chain.map((g) => g.parent))].sort(), area, parent: null });
  });

  const counts: Record<string, number> = {};
  loops.forEach((L) => { let k = 'F' + L.parents.join('+'); counts[k] = (counts[k] || 0) + 1; if (counts[k] > 1) k += '#' + counts[k]; L.key = k; });
  freeCircles.forEach((c) => {
    if (c.type !== 'circle') return;
    const q = PT(sk, c.c), poly = circlePts(q, c.r, 72);
    loops.push({ key: c.id, kind: 'circle', edges: [], pts: poly, poly, arcSeg: poly.map(() => true), parents: [c.id], c: q, r: c.r, area: Math.PI * c.r * c.r, parent: null });
  });
  return loops;
}

function containsPoly(outer: P2[], inner: P2[]): boolean {
  const step = Math.max(1, Math.floor(inner.length / 12));
  for (let i = 0; i < inner.length; i += step) if (!pip(inner[i], outer)) return false;
  return true;
}

/** Regions with their holes: each loop minus the loops directly inside it. */
export function sketchProfiles(sk: SketchData): Profile[] {
  const loops = sketchLoops(sk);
  loops.forEach((L) => {
    let best: Loop | null = null;
    loops.forEach((M) => { if (M !== L && M.area > L.area && containsPoly(M.poly, L.poly) && (!best || M.area < best.area)) best = M; });
    L.parent = best;
  });
  return loops.map((L) => {
    const holes = loops.filter((M) => M.parent === L);
    return { key: L.key, loop: L, holes, area: L.area - holes.reduce((s, h) => s + h.area, 0), outer: !L.parent };
  });
}

export const inProfile = (q: P2, pr: Profile): boolean => pip(q, pr.loop.poly) && !pr.holes.some((h) => pip(q, h.poly));
