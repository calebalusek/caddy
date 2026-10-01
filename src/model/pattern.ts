// Pattern: where the copies go. Pure maths (no kernel, no DOM). Each copy is "move by o, then turn
// about an axis", which is exactly how the kernel places it.
import { vadd, vcross, vdot, vlen, vnorm, vsc, vsub } from './frames';
import type { Vec3 } from './types';

/** How a pattern feature is saved (same as version 1 files). */
export interface PatternParams {
  ptype: 'Rectangular' | 'Circular';
  what: 'Features' | 'Bodies';
  feats: string[];
  bodies: string[];
  layout: 'Spacing' | 'Fit to edges';
  dir1: 'X' | 'Y' | 'Z' | 'Edge';
  n1: number;
  d1: number;
  dir2: 'None' | 'X' | 'Y' | 'Z' | 'Edge';
  n2: number;
  d2: number;
  v1: Vec3 | null;
  v2: Vec3 | null;
  e1: { a: Vec3; b: Vec3 } | null;
  e2: { a: Vec3; b: Vec3 } | null;
  cols: number;
  rows: number;
  gaps: 'Equal' | 'Custom';
  m1: number;
  m2: number;
  axis: 'X' | 'Y' | 'Z' | 'Pick' | 'Edge';
  axC: Vec3 | null;
  axD: Vec3 | null;
  radius: number;
  count: number;
  angle: number;
}

export interface Xf { k: number; o: Vec3; rot?: { C: Vec3; D: Vec3; deg: number } }
export interface Transforms { list: Xf[]; /** The original moves to the first place instead of staying where it is. */ relocate: boolean; err?: string }

const AX: Record<string, Vec3> = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };
const cnt = (v: unknown): number => Math.max(1, Math.round(+(v as number) || 1));

export const patternRelocates = (P: PatternParams): boolean => (P.ptype === 'Circular' ? (+P.radius || 0) > 0 : P.layout === 'Fit to edges');

/** Centers of a fit-to-edges row: equal clear gaps, or a set clear distance from each edge to the outermost objects. */
function fitLine(L: number, n: number, w: number, m: number, custom: boolean): number[] | null {
  const out: number[] = [];
  if (custom) {
    const span = L - 2 * m - n * w;
    if (span < -1e-9) return null;
    const g = n > 1 ? span / (n - 1) : 0;
    for (let i = 0; i < n; i++) out.push(n === 1 ? L / 2 : m + w / 2 + i * (w + g));
  } else {
    const g = (L - n * w) / (n + 1);
    if (g < -1e-9) return null;
    for (let i = 0; i < n; i++) out.push(g * (i + 1) + w * i + w / 2);
  }
  return out;
}

/** Offsets that carry the object (centered at c0, `width(dir)` wide along dir) to each cell of the grid laid along two edges. */
function fitGrid(P: PatternParams, c0: Vec3, width: (d: Vec3) => number): { cells: Vec3[] } | { err: string } {
  if (!P.e1 || !P.e2) return { err: 'Click an edge along the length, then one along the height' };
  let best: { d: number; c: Vec3[] } | null = null;
  const { a: a1, b: b1 } = P.e1, { a: a2, b: b2 } = P.e2;
  ([[a1, b1, a2, b2], [b1, a1, a2, b2], [a1, b1, b2, a2], [b1, a1, b2, a2]] as Vec3[][]).forEach((c) => { const d = vlen(vsub(c[0], c[2])); if (!best || d < best.d) best = { d, c }; });
  const [O, B1, A2, B2] = best!.c, U = vsub(B1, O), V = vsub(B2, A2), L1 = vlen(U), L2 = vlen(V);
  if (L1 < 1e-6 || L2 < 1e-6) return { err: 'Those edges are too short' };
  const u = vsc(U, 1 / L1), v = vsc(V, 1 / L2), nrm = vcross(u, v);
  if (vlen(nrm) < 1e-3) return { err: 'Pick two edges that point different ways' };
  const nn = vnorm(nrm), custom = P.gaps === 'Custom';
  const S = fitLine(L1, cnt(P.cols), width(u), +P.m1 || 0, custom), T = fitLine(L2, cnt(P.rows), width(v), +P.m2 || 0, custom);
  if (!S || !T) return { err: custom ? 'Those edge distances leave no room for this many' : "That many don't fit between the edges" };
  const h = vdot(vsub(c0, O), nn), cells: Vec3[] = [];
  T.forEach((t) => S.forEach((s) => { cells.push(vsub(vadd(vadd(O, vsc(u, s)), vadd(vsc(v, t), vsc(nn, h))), c0)); }));
  return { cells };
}

/** All copies for an object centered at c0 (`width` measures it along a direction, for Fit to edges). */
export function patternTransforms(P: PatternParams, c0: Vec3, width: (d: Vec3) => number): Transforms {
  const list: Xf[] = [];
  if (P.ptype === 'Circular') {
    const pick = (P.axis === 'Edge' || P.axis === 'Pick') && P.axD;
    const C: Vec3 = pick && P.axC ? P.axC : [0, 0, 0], D = vnorm(pick ? P.axD! : AX[P.axis] || AX.Z);
    const n = cnt(P.count), ang = +P.angle || 360, full = Math.abs(Math.abs(ang) - 360) < 1e-6;
    const step = (full ? ang / n : n > 1 ? ang / (n - 1) : 0), R = +P.radius || 0;
    let off: Vec3 | null = null;
    if (R > 0) { // move the object onto the circle, keeping its angle around the axis
      const q = vsub(c0, C), h = vdot(q, D);
      let r = vsub(q, vsc(D, h));
      if (vlen(r) < 1e-6) { r = vsub(AX.X, vsc(D, D[0])); if (vlen(r) < 1e-6) r = vsub(AX.Y, vsc(D, D[1])); }
      off = vsub(vadd(C, vadd(vsc(D, h), vsc(vnorm(r), R))), c0);
    }
    for (let k = off ? 0 : 1; k < n; k++) list.push({ k, o: off || [0, 0, 0], rot: { C, D, deg: step * k } });
    return { list, relocate: !!off };
  }
  if (P.layout === 'Fit to edges') {
    const g = fitGrid(P, c0, width);
    if ('err' in g) return { list, relocate: true, err: g.err };
    g.cells.forEach((o, i) => list.push({ k: i, o }));
    return { list, relocate: true };
  }
  const v1 = vnorm(P.dir1 === 'Edge' && P.v1 ? P.v1 : AX[P.dir1] || AX.X), n1 = cnt(P.n1);
  const two = !!P.dir2 && P.dir2 !== 'None', v2 = two ? vnorm(P.dir2 === 'Edge' && P.v2 ? P.v2 : AX[P.dir2] || AX.Y) : ([0, 0, 0] as Vec3), n2 = two ? cnt(P.n2) : 1;
  for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
    if (!i && !j) continue;
    list.push({ k: list.length + 1, o: vadd(vsc(v1, i * (+P.d1 || 0)), vsc(v2, j * (+P.d2 || 0))) });
  }
  return { list, relocate: false };
}

/** How many new bodies each source makes when it copies into new bodies. */
export function newBodiesPerSource(P: PatternParams): number {
  if (P.ptype === 'Circular') return cnt(P.count) - 1;
  if (P.layout === 'Fit to edges') return cnt(P.cols) * cnt(P.rows) - 1;
  return cnt(P.n1) * (P.dir2 && P.dir2 !== 'None' ? cnt(P.n2) : 1) - 1;
}
