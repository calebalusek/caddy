// Sketch data: points, curves that reference point ids (shared ids = coincident), and constraints.
// The shapes match the prototype's version 1 files exactly, so old sketches open unchanged.

export type P2 = [number, number];
export interface SkPoint { x: number; y: number }

export interface LineCurve { id: string; type: 'line'; p1: string; p2: string; construction?: boolean }
export interface ArcCurve { id: string; type: 'arc'; c: string; p1: string; p2: string; r: number; construction?: boolean }
export interface CircleCurve { id: string; type: 'circle'; c: string; r: number; construction?: boolean }
export type Curve = LineCurve | ArcCurve | CircleCurve;

/**
 * A constraint or dimension. Fields depend on `type` (see conResid in solver.ts):
 * l/a/b/c/src are curve ids, p/p1/p2 are point ids, v is the dimension value.
 */
export interface Constraint {
  id: string;
  type: string;
  v?: number;
  driven?: boolean;
  [key: string]: any;
}

export interface SketchData {
  /** Point "O" is the fixed sketch origin. */
  pts: Record<string, SkPoint>;
  curves: Curve[];
  cons: Constraint[];
  /** Counter for new ids. */
  nid: number;
}

export interface SketchStatus { dof: number; ptFixed: Set<string>; curveFixed: Set<string> }

export const newSketchData = (): SketchData => ({ pts: { O: { x: 0, y: 0 } }, curves: [], cons: [], nid: 0 });

export const d2 = (a: P2, b: P2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const newId = (sk: SketchData, prefix: string): string => prefix + ++sk.nid;
export function addPt(sk: SketchData, x: number, y: number): string { const id = newId(sk, 'p'); sk.pts[id] = { x, y }; return id; }
export function addLine(sk: SketchData, a: string, b: string): string { const id = newId(sk, 'l'); sk.curves.push({ id, type: 'line', p1: a, p2: b }); return id; }
export const cmap = (sk: SketchData): Map<string, Curve> => { const m = new Map<string, Curve>(); sk.curves.forEach((c) => m.set(c.id, c)); return m; };
export const PT = (sk: SketchData, id: string): P2 => { const p = sk.pts[id]; return [p.x, p.y]; };
export const curvePtIds = (c: Curve): string[] => (c.type === 'line' ? [c.p1, c.p2] : c.type === 'arc' ? [c.c, c.p1, c.p2] : [c.c]);
export const isEdgeCurve = (c: Curve): c is LineCurve | ArcCurve => c.type === 'line' || c.type === 'arc';
export function usedPoints(sk: SketchData): Set<string> { const s = new Set<string>(); sk.curves.forEach((c) => curvePtIds(c).forEach((p) => s.add(p))); return s; }

/** Arcs run counter-clockwise from p1 to p2: start angle a1 and sweep sw in (0, 2π]. */
export function arcSweep(sk: SketchData, c: ArcCurve): { q: P2; a1: number; sw: number } {
  const q = PT(sk, c.c), a = PT(sk, c.p1), b = PT(sk, c.p2);
  const a1 = Math.atan2(a[1] - q[1], a[0] - q[0]);
  let sw = Math.atan2(b[1] - q[1], b[0] - q[0]) - a1;
  while (sw <= 1e-9) sw += Math.PI * 2;
  while (sw > Math.PI * 2) sw -= Math.PI * 2;
  return { q, a1, sw };
}
export function arcPts(sk: SketchData, c: ArcCurve, step?: number): P2[] {
  const { q, a1, sw } = arcSweep(sk, c), n = Math.max(6, Math.ceil(sw / (step || Math.PI / 36))), out: P2[] = [];
  for (let i = 0; i <= n; i++) { const t = a1 + (sw * i) / n; out.push([q[0] + c.r * Math.cos(t), q[1] + c.r * Math.sin(t)]); }
  out[0] = PT(sk, c.p1);
  out[n] = PT(sk, c.p2);
  return out;
}
export const circlePts = (c: P2, r: number, n: number): P2[] => { const p: P2[] = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; p.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } return p; };
export const curvePts = (sk: SketchData, c: Curve): P2[] => (c.type === 'line' ? [PT(sk, c.p1), PT(sk, c.p2)] : c.type === 'arc' ? arcPts(sk, c) : circlePts(PT(sk, c.c), c.r, 72));
export const normAng = (a: number): number => { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; };
export function inSweep(sk: SketchData, c: ArcCurve, ang: number): boolean { const { a1, sw } = arcSweep(sk, c); return normAng(ang - a1) <= sw + 1e-9; }

export const snapshot = (sk: SketchData): string => JSON.stringify({ pts: sk.pts, curves: sk.curves, cons: sk.cons, nid: sk.nid });
export function restore(sk: SketchData, s: string): void { const o = JSON.parse(s); sk.pts = o.pts; sk.curves = o.curves; sk.cons = o.cons; sk.nid = o.nid; }

const DIM_TYPES = new Set(['radius', 'length', 'diameter', 'hdist', 'vdist', 'dist', 'angle', 'pldist', 'flats', 'coff']);
export const isDim = (c: Constraint): boolean => DIM_TYPES.has(c.type);
export const shownDim = (c: Constraint): boolean => isDim(c) && !c.ref;
export const conCurves = (c: Constraint): string[] => [c.l, c.c, c.a, c.b, c.src, c.ref && c.ref.l].filter(Boolean);
export const conPoints = (c: Constraint): string[] => [c.p, c.p1, c.p2, c.ref && c.ref.id].filter(Boolean);

// ---- 2D helpers ----
export function pip(pt: P2, poly: P2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
export function signedArea(p: P2[]): number { let a = 0; for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += p[j][0] * p[i][1] - p[i][0] * p[j][1]; return a / 2; }
export function segDist(p: P2, a: P2, b: P2): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
