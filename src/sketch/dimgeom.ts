// Where a dimension's lines, arrows and label go (in sketch coordinates). Carried over from the prototype.
import { fmt } from '../core/format';
import { arcSweep, cmap, d2, PT, type ArcCurve, type CircleCurve, type Constraint, type Curve, type LineCurve, type P2, type SketchData } from './model';
import { lineInter, lineUnit } from './solver';

type Seg = [P2, P2];
type CMap = Map<string, Curve>;

/** k = sketch units per screen pixel, so arrows and gaps keep a constant size on screen. */
export function dimGeom(sk: SketchData, c: Constraint, M: CMap, k = 0.3): { segs: Seg[]; label: P2 } {
  const segs: Seg[] = [], pt = (id: string): P2 => PT(sk, id), AH = 9 * k, GAP = 3 * k, OVER = 6 * k;
  const arrowAt = (p: P2, u: P2): void => {
    const n: P2 = [-u[1], u[0]];
    segs.push([p, [p[0] + u[0] * AH + n[0] * AH * 0.33, p[1] + u[1] * AH + n[1] * AH * 0.33]], [p, [p[0] + u[0] * AH - n[0] * AH * 0.33, p[1] + u[1] * AH - n[1] * AH * 0.33]]);
  };
  const extLine = (from: P2, to: P2): void => {
    const dx = to[0] - from[0], dy = to[1] - from[1], L = Math.hypot(dx, dy);
    if (L < GAP * 1.2) return;
    const u = [dx / L, dy / L];
    segs.push([[from[0] + u[0] * GAP, from[1] + u[1] * GAP], [to[0] + u[0] * OVER, to[1] + u[1] * OVER]]);
  };
  const dimLine = (A: P2, B: P2): P2 => {
    const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1, u: P2 = [dx / L, dy / L];
    segs.push([A, B]);
    arrowAt(A, u); arrowAt(B, [-u[0], -u[1]]);
    return [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  };
  const aligned = (a: P2, b: P2, off: number): P2 => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, n = [-dy / L, dx / L];
    const a2: P2 = [a[0] + n[0] * off, a[1] + n[1] * off], b2: P2 = [b[0] + n[0] * off, b[1] + n[1] * off];
    extLine(a, a2); extLine(b, b2);
    return dimLine(a2, b2);
  };
  const fallback = (): { segs: Seg[]; label: P2 } => ({ segs, label: [0, 0] });
  switch (c.type) {
    case 'length': { const l = M.get(c.l) as LineCurve; if (!l) return fallback(); return { segs, label: aligned(pt(l.p1), pt(l.p2), c.off != null ? c.off : 26 * k) }; }
    case 'dist': {
      const a = pt(c.p1), b = pt(c.p2), dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, n = [-dy / L, dx / L];
      const off = (c.place[0] - a[0]) * n[0] + (c.place[1] - a[1]) * n[1];
      return { segs, label: aligned(a, b, off) };
    }
    case 'hdist': case 'vdist': {
      const a = pt(c.p1), b = pt(c.p2), H = c.type === 'hdist';
      const at = (p: P2): P2 => (H ? [p[0], c.place[1]] : [c.place[0], p[1]]);
      const A = at(a), B = at(b);
      extLine(a, A); extLine(b, B);
      return { segs, label: dimLine(A, B) };
    }
    case 'diameter': {
      const cv = M.get(c.c) as CircleCurve; if (!cv) return fallback();
      const p = pt(cv.c), ang = c.ang != null ? c.ang : 0.785, u: P2 = [Math.cos(ang), Math.sin(ang)];
      const p1: P2 = [p[0] - u[0] * cv.r, p[1] - u[1] * cv.r], p2: P2 = [p[0] + u[0] * cv.r, p[1] + u[1] * cv.r];
      segs.push([p1, p2], [p2, [p2[0] + u[0] * 10 * k, p2[1] + u[1] * 10 * k]]);
      arrowAt(p1, u); arrowAt(p2, [-u[0], -u[1]]);
      return { segs, label: [p[0] + u[0] * (cv.r + 22 * k), p[1] + u[1] * (cv.r + 22 * k)] };
    }
    case 'angle': {
      const A = M.get(c.a) as LineCurve, B = M.get(c.b) as LineCurve; if (!A || !B) return fallback();
      const X = lineInter(sk, A, B); if (!X) return { segs, label: pt(A.p1) };
      const ua = lineUnit(sk, A), ub = lineUnit(sk, B), u: P2 = [ua[0] * c.sa, ua[1] * c.sa], w: P2 = [ub[0] * c.sb, ub[1] * c.sb];
      const th0 = Math.atan2(u[1], u[0]), phi = Math.atan2(u[0] * w[1] - u[1] * w[0], u[0] * w[0] + u[1] * w[1]), r = c.rad || 20;
      const n = Math.max(8, Math.ceil(Math.abs(phi) / 0.06));
      let prev: P2 | null = null;
      for (let i = 0; i <= n; i++) { const th = th0 + (phi * i) / n, P: P2 = [X[0] + r * Math.cos(th), X[1] + r * Math.sin(th)]; if (prev) segs.push([prev, P]); prev = P; }
      const ext = (L: LineCurve, dir: P2): P2 => {
        const P: P2 = [X[0] + dir[0] * r, X[1] + dir[1] * r];
        const ends = [pt(L.p1), pt(L.p2)].map((e) => ({ e, t: (e[0] - X[0]) * dir[0] + (e[1] - X[1]) * dir[1] })).sort((x, y) => x.t - y.t);
        if (r > ends[1].t) extLine(ends[1].e, P); else if (r < ends[0].t) extLine(ends[0].e, P);
        return P;
      };
      const Pu = ext(A, u), Pw = ext(B, w), sg = Math.sign(phi) || 1, th1 = th0 + phi;
      arrowAt(Pu, [-Math.sin(th0) * sg, Math.cos(th0) * sg]); arrowAt(Pw, [Math.sin(th1) * sg, -Math.cos(th1) * sg]);
      const tm = th0 + phi / 2;
      return { segs, label: [X[0] + r * Math.cos(tm), X[1] + r * Math.sin(tm)] };
    }
    case 'radius': {
      const cv = M.get(c.c) as ArcCurve | CircleCurve; if (!cv) return fallback();
      const p = pt(cv.c);
      let ang = c.ang;
      if (ang == null) { if (cv.type === 'arc') { const s = arcSweep(sk, cv); ang = s.a1 + s.sw / 2; } else ang = 0.785; }
      const u: P2 = [Math.cos(ang), Math.sin(ang)], P: P2 = [p[0] + u[0] * cv.r, p[1] + u[1] * cv.r];
      segs.push([p, P], [P, [P[0] + u[0] * 10 * k, P[1] + u[1] * 10 * k]]);
      arrowAt(P, [-u[0], -u[1]]);
      return { segs, label: [p[0] + u[0] * (cv.r + 20 * k), p[1] + u[1] * (cv.r + 20 * k)] };
    }
    case 'flats': {
      const k2 = M.get(c.c) as CircleCurve, l = M.get(c.l) as LineCurve; if (!k2 || !l) return fallback();
      const q = pt(k2.c), a = pt(l.p1), b = pt(l.p2), m: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], h = d2(m, q) || 1, u = [(m[0] - q[0]) / h, (m[1] - q[1]) / h];
      const P2_: P2 = [q[0] - u[0] * h, q[1] - u[1] * h];
      dimLine(m, P2_);
      return { segs, label: [q[0] - u[0] * h * 0.45, q[1] - u[1] * h * 0.45] };
    }
    case 'coff': {
      const cv = M.get(c.c) as CircleCurve, s0 = M.get(c.src) as CircleCurve; if (!cv || !s0) return fallback();
      const q = pt(cv.c), ang = c.ang != null ? c.ang : 0.5, u = [Math.cos(ang), Math.sin(ang)];
      const P1: P2 = [q[0] + u[0] * s0.r, q[1] + u[1] * s0.r], P2_: P2 = [q[0] + u[0] * cv.r, q[1] + u[1] * cv.r], R = Math.max(s0.r, cv.r);
      dimLine(P1, P2_);
      segs.push([[q[0] + u[0] * R, q[1] + u[1] * R], [q[0] + u[0] * (R + 10 * k), q[1] + u[1] * (R + 10 * k)]]);
      return { segs, label: [q[0] + u[0] * (R + 20 * k), q[1] + u[1] * (R + 20 * k)] };
    }
    case 'pldist': {
      const l = M.get(c.l) as LineCurve; if (!l) return fallback();
      const a = pt(l.p1), b = pt(l.p2), u = lineUnit(sk, l), P = pt(c.p), L = d2(a, b);
      const t = (P[0] - a[0]) * u[0] + (P[1] - a[1]) * u[1], F: P2 = [a[0] + u[0] * t, a[1] + u[1] * t], off = c.off || 0;
      if (t < 0) extLine(a, F); else if (t > L) extLine(b, F);
      const P2_: P2 = [P[0] + u[0] * off, P[1] + u[1] * off], F2: P2 = [F[0] + u[0] * off, F[1] + u[1] * off];
      if (Math.abs(off) > GAP) { extLine(P, P2_); extLine(F, F2); }
      return { segs, label: dimLine(P2_, F2) };
    }
  }
  return fallback();
}

export const dimText = (c: Constraint): string =>
  (c.driven ? '(' : '') + (c.type === 'diameter' ? 'Ø' : c.type === 'radius' ? 'R' : c.type === 'flats' ? 'AF ' : '') + fmt(c.v!) + (c.type === 'angle' ? '°' : '') + (c.driven ? ')' : '');

/** Dragging a dimension label to q moves its line there. */
export function moveDim(sk: SketchData, c: Constraint | undefined, q: P2): void {
  if (!c) return;
  const M = cmap(sk);
  switch (c.type) {
    case 'length': { const l = M.get(c.l) as LineCurve, a = PT(sk, l.p1), u = lineUnit(sk, l); c.off = (q[0] - a[0]) * -u[1] + (q[1] - a[1]) * u[0]; break; }
    case 'dist': case 'hdist': case 'vdist': c.place = q.slice(); break;
    case 'diameter': case 'coff': case 'radius': { const p = PT(sk, (M.get(c.c) as CircleCurve).c); c.ang = Math.atan2(q[1] - p[1], q[0] - p[0]); break; }
    case 'angle': { const X = lineInter(sk, M.get(c.a) as LineCurve, M.get(c.b) as LineCurve); if (X) c.rad = Math.max(1e-3, d2(q, X)); break; }
    case 'pldist': {
      const l = M.get(c.l) as LineCurve, a = PT(sk, l.p1), u = lineUnit(sk, l), P = PT(sk, c.p);
      const t = (P[0] - a[0]) * u[0] + (P[1] - a[1]) * u[1], F = [a[0] + u[0] * t, a[1] + u[1] * t], mid = [(P[0] + F[0]) / 2, (P[1] + F[1]) / 2];
      c.off = (q[0] - mid[0]) * u[0] + (q[1] - mid[1]) * u[1];
      break;
    }
  }
}
