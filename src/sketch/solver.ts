// Sketch constraint solver, carried over from the prototype: Levenberg–Marquardt with a numeric
// Jacobian, degrees-of-freedom analysis (which points/curves are fully defined) and redundancy checks.
import { cmap, curvePtIds, d2, PT, usedPoints, type ArcCurve, type CircleCurve, type Constraint, type Curve, type LineCurve, type P2, type SketchData, type SketchStatus } from './model';

type CMap = Map<string, Curve>;
const L_ = (M: CMap, id: string): LineCurve => M.get(id) as LineCurve;
const R_ = (M: CMap, id: string): ArcCurve | CircleCurve => M.get(id) as ArcCurve | CircleCurve;

/** Value of a dimension; reference dimensions follow the one they point at. */
export function cval(sk: SketchData, c: Constraint): number {
  if (!c.ref) return c.v!;
  const m = sk.cons.find((x) => x.id === c.ref);
  return m ? m.v! : c.v!;
}

/** How far a constraint is from being satisfied (0 = satisfied). */
export function conResid(sk: SketchData, c: Constraint, M: CMap): number[] {
  if (c.driven) return [];
  // dangling reference: ignore safely
  if ([c.l, c.c, c.a, c.b, c.src, c.ref && c.ref.l].filter(Boolean).some((id) => !M.get(id)) || [c.p, c.p1, c.p2, c.ref && c.ref.id].filter(Boolean).some((id) => !sk.pts[id])) return [];
  const pt = (id: string) => sk.pts[id];
  switch (c.type) {
    case 'angle': {
      const A = L_(M, c.a), B = L_(M, c.b);
      if (!A || !B) return [0];
      const u = [(pt(A.p2).x - pt(A.p1).x) * c.sa, (pt(A.p2).y - pt(A.p1).y) * c.sa], w = [(pt(B.p2).x - pt(B.p1).x) * c.sb, (pt(B.p2).y - pt(B.p1).y) * c.sb];
      const phi = Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]);
      return [20 * (c.s * phi - (c.v! * Math.PI) / 180)];
    }
    case 'pldist': {
      const l = L_(M, c.l), a = pt(l.p1), b = pt(l.p2), p = pt(c.p), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      return [((dx * (p.y - a.y) - dy * (p.x - a.x)) / L) * c.sgn - cval(sk, c)];
    }
    case 'radius': return [R_(M, c.c).r - c.v!];
    case 'align': {
      let v: number;
      const axis = c.axis as 'x' | 'y';
      if (c.ref.kind === 'pt') v = sk.pts[c.ref.id][axis];
      else { const l = L_(M, c.ref.l); v = (pt(l.p1)[axis] + pt(l.p2)[axis]) / 2; }
      return [pt(c.p)[axis] - v];
    }
    case 'ponl': { const l = L_(M, c.l), a = pt(l.p1), b = pt(l.p2), p = pt(c.p), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1; return [(dx * (p.y - a.y) - dy * (p.x - a.x)) / L]; }
    case 'midpt': { const l = L_(M, c.l), a = pt(l.p1), b = pt(l.p2), p = pt(c.p); return [p.x - (a.x + b.x) / 2, p.y - (a.y + b.y) / 2]; }
    case 'tangent': {
      const A = M.get(c.a), B = M.get(c.b);
      if (!A || !B) return [0];
      if (A.type === 'line') {
        const Bc = B as ArcCurve | CircleCurve, a = pt(A.p1), b = pt(A.p2), q = pt(Bc.c), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
        return [((dx * (q.y - a.y) - dy * (q.x - a.x)) / L) * c.sgn - Bc.r];
      }
      const Ac = A as ArcCurve | CircleCurve, Bc = B as ArcCurve | CircleCurve;
      const qa = pt(Ac.c), qb = pt(Bc.c), D = Math.hypot(qa.x - qb.x, qa.y - qb.y);
      return [c.inner ? D - c.sgn * (Ac.r - Bc.r) : D - (Ac.r + Bc.r)];
    }
    case 'ponc': { const k = R_(M, c.c), q = pt(k.c), p = pt(c.p); return [Math.hypot(p.x - q.x, p.y - q.y) - k.r]; }
    case 'flats': {
      const k = R_(M, c.c), l = L_(M, c.l), q = pt(k.c), a = pt(l.p1), b = pt(l.p2), dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      return [2 * ((dx * (q.y - a.y) - dy * (q.x - a.x)) / L) * c.sgn - c.v!];
    }
    case 'coff': { const k = R_(M, c.c), s0 = R_(M, c.src); return [k.r - (s0.r + c.s * cval(sk, c))]; }
    case 'horizontal': { const l = L_(M, c.l); return [pt(l.p2).y - pt(l.p1).y]; }
    case 'vertical': { const l = L_(M, c.l); return [pt(l.p2).x - pt(l.p1).x]; }
    case 'length': { const l = L_(M, c.l), a = pt(l.p1), b = pt(l.p2); return [Math.hypot(b.x - a.x, b.y - a.y) - c.v!]; }
    case 'diameter': return [2 * R_(M, c.c).r - c.v!];
    case 'hdist': return [(pt(c.p2).x - pt(c.p1).x) * c.sgn - c.v!];
    case 'vdist': return [(pt(c.p2).y - pt(c.p1).y) * c.sgn - c.v!];
    case 'dist': { const a = pt(c.p1), b = pt(c.p2); return [Math.hypot(b.x - a.x, b.y - a.y) - c.v!]; }
    case 'perp': case 'par': {
      const A = L_(M, c.a), B = L_(M, c.b);
      const u = [pt(A.p2).x - pt(A.p1).x, pt(A.p2).y - pt(A.p1).y], w = [pt(B.p2).x - pt(B.p1).x, pt(B.p2).y - pt(B.p1).y];
      const L = Math.hypot(u[0], u[1]) * Math.hypot(w[0], w[1]) || 1;
      return [(10 * (c.type === 'perp' ? u[0] * w[0] + u[1] * w[1] : u[0] * w[1] - u[1] * w[0])) / L];
    }
    case 'equal': {
      const A = M.get(c.a)!, B = M.get(c.b)!;
      if (A.type !== 'line') return [A.r - (B as ArcCurve | CircleCurve).r];
      const Bl = B as LineCurve;
      const la = Math.hypot(pt(A.p2).x - pt(A.p1).x, pt(A.p2).y - pt(A.p1).y), lb = Math.hypot(pt(Bl.p2).x - pt(Bl.p1).x, pt(Bl.p2).y - pt(Bl.p1).y);
      return [la - lb];
    }
  }
  return [];
}

/** What a dimension would read right now. */
export function measure(sk: SketchData, c: Constraint, M: CMap): number {
  const r = conResid(sk, Object.assign({}, c, { v: 0, driven: false, ref: undefined }), M)[0] || 0;
  return Math.abs(c.type === 'angle' ? ((r / 20) * 180) / Math.PI : r);
}
export function updateDriven(sk: SketchData): void { const M = cmap(sk); sk.cons.forEach((c) => { if (c.driven) c.v = measure(sk, c, M); }); }
export function lineUnit(sk: SketchData, l: LineCurve): P2 { const a = PT(sk, l.p1), b = PT(sk, l.p2), L = d2(a, b) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; }
export function lineInter(sk: SketchData, A: LineCurve, B: LineCurve): P2 | null {
  const a = PT(sk, A.p1), a2 = PT(sk, A.p2), b = PT(sk, B.p1), b2 = PT(sk, B.p2);
  const r = [a2[0] - a[0], a2[1] - a[1]], s = [b2[0] - b[0], b2[1] - b[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9 * Math.hypot(r[0], r[1]) * Math.hypot(s[0], s[1])) return null;
  const t = ((b[0] - a[0]) * s[1] - (b[1] - a[1]) * s[0]) / den;
  return [a[0] + r[0] * t, a[1] + r[1] * t];
}

function residuals(sk: SketchData, cons: Constraint[], M: CMap): number[] {
  const r: number[] = [];
  // an arc's two ends stay on its circle
  for (const cv of M.values()) {
    if (cv.type === 'arc') {
      const q = sk.pts[cv.c], a = sk.pts[cv.p1], b = sk.pts[cv.p2];
      r.push(Math.hypot(a.x - q.x, a.y - q.y) - cv.r, Math.hypot(b.x - q.x, b.y - q.y) - cv.r);
    }
  }
  for (const c of cons) { const x = conResid(sk, c, M); for (const v of x) r.push(v); }
  return r;
}

type Var = { p: string; k: 'x' | 'y' } | { c: string; k: 'r' };
function varsOf(sk: SketchData): { V: Var[]; fixedP: Set<string>; fixedR: Set<string> } {
  const fixedP = new Set(['O']), fixedR = new Set<string>();
  sk.cons.forEach((c) => { if (c.type === 'fix') fixedP.add(c.p); if (c.type === 'fixr') fixedR.add(c.c); });
  const V: Var[] = [];
  usedPoints(sk).forEach((id) => { if (!fixedP.has(id)) V.push({ p: id, k: 'x' }, { p: id, k: 'y' }); });
  sk.curves.forEach((c) => { if (c.type !== 'line' && !fixedR.has(c.id)) V.push({ c: c.id, k: 'r' }); });
  return { V, fixedP, fixedR };
}
const getVar = (sk: SketchData, v: Var, M: CMap): number => ('p' in v ? sk.pts[v.p][v.k] : R_(M, v.c).r);
function setVar(sk: SketchData, v: Var, val: number, M: CMap): void { if ('p' in v) sk.pts[v.p][v.k] = val; else R_(M, v.c).r = val; }
const getX = (sk: SketchData, V: Var[], M: CMap): number[] => V.map((v) => getVar(sk, v, M));
const setX = (sk: SketchData, V: Var[], x: number[], M: CMap): void => V.forEach((v, i) => setVar(sk, v, x[i], M));

function linSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length, M = A.map((r, i) => { const row = Array.from(r); row.push(b[i]); return row; });
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = c + 1; r < n; r++) { const f = M[r][c] / M[c][c]; if (!f) continue; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = M[r][n]; for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k]; x[r] = s / M[r][r]; }
  return x;
}

function jacobian(sk: SketchData, V: Var[], cons: Constraint[], M: CMap): Float64Array[] {
  const x = getX(sk, V, M), r0 = residuals(sk, cons, M), J = r0.map(() => new Float64Array(V.length));
  for (let j = 0; j < V.length; j++) {
    const h = 1e-7 * Math.max(1, Math.abs(x[j]));
    setVar(sk, V[j], x[j] + h, M);
    const r = residuals(sk, cons, M);
    setVar(sk, V[j], x[j], M);
    for (let i = 0; i < r0.length; i++) J[i][j] = (r[i] - r0[i]) / h;
  }
  return J;
}

function lm(sk: SketchData, V: Var[], cons: Constraint[], M: CMap, extra: (() => number[]) | null): number {
  const n = V.length;
  const F = (): number[] => { const r = residuals(sk, cons, M); if (extra) for (const v of extra()) r.push(v); return r; };
  let r = F(), cost = r.reduce((s, v) => s + v * v, 0);
  if (!n) return cost;
  let x = getX(sk, V, M), lam = 1e-3;
  for (let it = 0; it < 80 && cost > 1e-22; it++) {
    const m = r.length, J: Float64Array[] = [];
    for (let i = 0; i < m; i++) J.push(new Float64Array(n));
    for (let j = 0; j < n; j++) {
      const h = 1e-7 * Math.max(1, Math.abs(x[j]));
      setVar(sk, V[j], x[j] + h, M);
      const rj = F();
      setVar(sk, V[j], x[j], M);
      for (let i = 0; i < m; i++) J[i][j] = (rj[i] - r[i]) / h;
    }
    const A: Float64Array[] = [], g = new Array(n).fill(0);
    for (let a = 0; a < n; a++) A.push(new Float64Array(n));
    for (let i = 0; i < m; i++) {
      const Ji = J[i];
      for (let a = 0; a < n; a++) { const v = Ji[a]; if (!v) continue; g[a] += v * r[i]; for (let b = 0; b < n; b++) A[a][b] += v * Ji[b]; }
    }
    let improved = false, tiny = false;
    for (let tries = 0; tries < 10; tries++) {
      const Al = A.map((row, i) => { const c = Array.from(row); c[i] += lam; return c; });
      const dx = linSolve(Al, g.map((v) => -v));
      if (!dx) { lam *= 10; continue; }
      const xn = x.map((v, i) => v + dx[i]);
      setX(sk, V, xn, M);
      const rn = F(), cn = rn.reduce((s, v) => s + v * v, 0);
      if (cn < cost) { x = xn; r = rn; cost = cn; lam = Math.max(lam * 0.3, 1e-12); improved = true; tiny = Math.hypot(...dx) < 1e-12; break; }
      setX(sk, V, x, M);
      lam *= 10;
    }
    if (!improved || tiny) break;
  }
  setX(sk, V, x, M);
  return cost;
}

/** A soft pull used while dragging: a point toward (x, y) or a radius toward v. */
export type DragTarget = { p: string; x: number; y: number } | { r: string; v: number };

/** Move the sketch so every constraint holds. Returns false if it cannot be satisfied. */
export function solveSketch(sk: SketchData, drag?: DragTarget[] | null): boolean {
  const { V } = varsOf(sk), M = cmap(sk);
  if (drag && drag.length) {
    lm(sk, V, sk.cons, M, () => {
      const out: number[] = [];
      drag.forEach((d) => {
        if ('r' in d) out.push(0.4 * (R_(M, d.r).r - d.v));
        else { const p = sk.pts[d.p]; out.push(0.4 * (p.x - d.x), 0.4 * (p.y - d.y)); }
      });
      return out;
    });
  }
  const cost = lm(sk, V, sk.cons, M, null);
  return Math.sqrt(cost) < 1e-5;
}

function rref(J: Float64Array[], n: number): { rank: number; R: number[][]; piv: number[] } {
  const R = J.map((r) => Array.from(r)), m = R.length, piv: number[] = [];
  let maxAbs = 0;
  R.forEach((r) => r.forEach((v) => { maxAbs = Math.max(maxAbs, Math.abs(v)); }));
  const tol = 1e-7 * Math.max(1, maxAbs);
  let row = 0;
  for (let col = 0; col < n && row < m; col++) {
    let best = row;
    for (let i = row + 1; i < m; i++) if (Math.abs(R[i][col]) > Math.abs(R[best][col])) best = i;
    if (Math.abs(R[best][col]) < tol) continue;
    [R[row], R[best]] = [R[best], R[row]];
    const pv = R[row][col];
    for (let k = 0; k < n; k++) R[row][k] /= pv;
    for (let i = 0; i < m; i++) { if (i === row) continue; const f = R[i][col]; if (!f) continue; for (let k = 0; k < n; k++) R[i][k] -= f * R[row][k]; }
    piv.push(col);
    row++;
  }
  return { rank: row, R, piv };
}

function rankOf(sk: SketchData, cons: Constraint[]): number {
  const { V } = varsOf(sk);
  if (!V.length) return 0;
  return rref(jacobian(sk, V, cons, cmap(sk)), V.length).rank;
}
/** Would this constraint remove a degree of freedom, or is it redundant with what is already there? */
export function independent(sk: SketchData, con: Constraint): boolean {
  const { V } = varsOf(sk);
  if (!V.length) return false;
  return rankOf(sk, sk.cons.concat([con])) > rankOf(sk, sk.cons);
}

/** Degrees of freedom left, and which points/curves are fully defined (drawn dark instead of blue). */
export function analyze(sk: SketchData): SketchStatus {
  const { V, fixedP, fixedR } = varsOf(sk), M = cmap(sk), n = V.length;
  const det = new Array(n).fill(true);
  let rank = 0;
  if (n) {
    const res = rref(jacobian(sk, V, sk.cons, M), n);
    rank = res.rank;
    const pivSet = new Set(res.piv);
    for (let f = 0; f < n; f++) {
      if (pivSet.has(f)) continue;
      det[f] = false;
      res.piv.forEach((pc, i) => { if (Math.abs(res.R[i][f]) > 1e-7) det[pc] = false; });
    }
  }
  const ptFixed = new Set(fixedP), rFixed = new Set(fixedR);
  const partial: Record<string, number> = {};
  V.forEach((v, i) => { if ('p' in v) partial[v.p] = (partial[v.p] || 0) + (det[i] ? 1 : 0); else if (det[i]) rFixed.add(v.c); });
  Object.keys(partial).forEach((p) => { if (partial[p] === 2) ptFixed.add(p); });
  const curveFixed = new Set<string>();
  sk.curves.forEach((c) => { if (curvePtIds(c).every((p) => ptFixed.has(p)) && (c.type === 'line' || rFixed.has(c.id))) curveFixed.add(c.id); });
  return { dof: n - rank, ptFixed, curveFixed };
}
