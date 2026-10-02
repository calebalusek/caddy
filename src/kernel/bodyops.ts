// Operations on whole bodies: split a body with a plane (and key the two halves together), offset a body
// (grow it or shrink it, for fits and clearances). Kernel code: runs in the worker and in Node tests.
import { basicFaceExtrusion, cast, getOC, isShape3D, makeCylinder, makePolygon, measureVolume, Vector, type Face, type Shape3D } from 'replicad';
import { vadd, vcross, vdot, vlen, vnorm, vsc, vsub } from '../model/frames';
import type { Vec3 } from '../model/types';
import { tup, type Scope } from './scope';
import { slab } from './sweep';

export type KeyKind = 'None' | 'Pins' | 'Rib' | 'Dovetail';
export interface Keys { type: KeyKind; /** Pin diameter, or the width of a rib or dovetail. */ size: number; count: number; depth: number; clearance: number }

const boxOf = (s: Shape3D): [Vec3, Vec3] => { const bb = s.boundingBox, [lo, hi] = bb.bounds; bb.delete(); return [lo as Vec3, hi as Vec3]; };
const keep = <T extends { delete: () => void }>(sc: Scope, s: T): T => sc.add(s);

/** Two perpendicular directions in a plane. */
function planeAxes(n: Vec3): [Vec3, Vec3] {
  const a = vnorm(Math.abs(n[2]) < 0.9 ? vcross(n, [0, 0, 1]) : vcross(n, [1, 0, 0]));
  return [a, vcross(n, a)];
}

/** An offset copy of a solid: grown (d > 0) or shrunk (d < 0). Sharp corners keep their points; round corners are smoothed. */
export function offsetShape(shape: Shape3D, d: number, sharp: boolean, sc: Scope): Shape3D {
  const oc = getOC();
  if (d < 0) { const [l, h] = boxOf(shape); if (Math.min(h[0] - l[0], h[1] - l[1], h[2] - l[2]) <= -2 * d + 1e-6) throw new Error('shrinks away'); }
  const b = new oc.BRepOffsetAPI_MakeOffsetShape();
  try {
    b.PerformByJoin(shape.wrapped, d, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, sharp ? oc.GeomAbs_JoinType.GeomAbs_Intersection : oc.GeomAbs_JoinType.GeomAbs_Arc, false);
    const out = cast(b.Shape());
    if (!isShape3D(out)) throw new Error('could not offset');
    const v0 = measureVolume(shape), v1 = measureVolume(out);
    if (!(v1 > 0) || (d < 0 ? v1 >= v0 : v1 <= v0)) throw new Error('offset went wrong');
    return keep(sc, out);
  } finally { b.delete(); }
}

export interface SplitResult { pos: Shape3D; neg: Shape3D; info: string }

/**
 * Cut a body in two with a plane. The side the plane's normal points to is `pos`. Keys (pins, a rib or a dovetail)
 * stand out of `pos` into `neg`, and `neg` gets a matching pocket, with the clearance all round.
 */
export function splitBody(shape: Shape3D, plane: { o: Vec3; n: Vec3 }, keys: Keys, sc: Scope): SplitResult {
  const n = vnorm(plane.n), o = plane.o;
  const [lo, hi] = boxOf(shape), diag = vlen(vsub(hi, lo));
  const S = diag * 2 + 20;
  const pos = keep(sc, shape.cut(slab(o, vsc(n, -1), S, sc)));
  const neg = keep(sc, shape.cut(slab(o, n, S, sc)));
  if (!(measureVolume(pos) > 1e-6) || !(measureVolume(neg) > 1e-6)) throw new Error('the plane does not cut through the body');
  if (keys.type === 'None') return { pos, neg, info: 'Split in two' };

  const { size, depth, clearance: c } = keys, h = depth;
  if (!(size > 0)) throw new Error('give the keys a size');
  if (!(h > 0)) throw new Error('give the keys a depth');
  // the cut face: its size along the plane tells where keys can go
  let lo2: Vec3 = [Infinity, Infinity, Infinity], hi2: Vec3 = [-Infinity, -Infinity, -Infinity], faces = 0;
  sc.all(pos.faces).forEach((f: Face) => {
    if (f.geomType !== 'PLANE' || Math.abs(vdot(vnorm(tup(f.normalAt())), n)) < 0.999 || Math.abs(vdot(vsub(tup(f.center), o), n)) > 1e-4) return;
    const bb = f.boundingBox, [a, b] = bb.bounds;
    bb.delete();
    lo2 = lo2.map((v, i) => Math.min(v, a[i])) as Vec3; hi2 = hi2.map((v, i) => Math.max(v, b[i])) as Vec3; faces++;
  });
  if (!faces) throw new Error('the cut has no flat face to put keys on');
  const [u, v] = planeAxes(n);
  const corners: Vec3[] = [];
  for (const x of [lo2[0], hi2[0]]) for (const y of [lo2[1], hi2[1]]) for (const z of [lo2[2], hi2[2]]) corners.push([x, y, z]);
  const ext = (d: Vec3): [number, number] => { const t = corners.map((p) => vdot(vsub(p, o), d)); return [Math.min(...t), Math.max(...t)]; };
  const [u0, u1] = ext(u), [v0, v1] = ext(v);
  // keys run along the longer way of the cut
  const alongU = u1 - u0 >= v1 - v0, A = alongU ? u : v, B = alongU ? v : u;
  const [a0, a1] = alongU ? [u0, u1] : [v0, v1], [b0, b1] = alongU ? [v0, v1] : [u0, u1];
  const bMid = (b0 + b1) / 2, point = (a: number, b: number): Vec3 => vadd(vadd(o, vsc(A, a)), vsc(B, b));
  const down = vsc(n, -1);
  // solids for the male key (reaching into neg) and the pocket (a little bigger), starting a little inside pos so they fuse cleanly
  const inside = 0.5, tg = Math.tan((15 * Math.PI) / 180);
  const male = (cx: number, cy: number, len: number): Shape3D => {
    const base = vadd(point(cx, cy), vsc(n, inside));
    if (keys.type === 'Pins') return keep(sc, makeCylinder(size / 2, h + inside, base, down));
    const top = (w: number): Vec3[] => [vsub(point(cx, cy), vsc(B, w / 2)), vadd(point(cx, cy), vsc(B, w / 2))];
    if (keys.type === 'Rib') {
      const [p, q] = top(size), start = vsc(A, -len / 2), shift = (x: Vec3, k: number): Vec3 => vadd(vadd(x, vsc(A, k)), vsc(n, inside));
      const face = keep(sc, makePolygon([shift(p, -len / 2), shift(q, -len / 2), vadd(shift(q, -len / 2), vsc(down, h + inside)), vadd(shift(p, -len / 2), vsc(down, h + inside))]));
      void start;
      return keep(sc, basicFaceExtrusion(face, sc.add(new Vector(vsc(A, len)))));
    }
    // dovetail: narrow at the cut, wider deeper in, so the halves cannot be pulled apart
    const ctr = point(cx, cy), wide = size + 2 * h * tg;
    const at = (w: number, dd: number, k: number): Vec3 => vadd(vadd(vadd(ctr, vsc(B, w)), vsc(down, dd)), vsc(A, k));
    const face = keep(sc, makePolygon([at(-size / 2, -inside, -len / 2), at(size / 2, -inside, -len / 2), at(wide / 2, h, -len / 2), at(-wide / 2, h, -len / 2)]));
    return keep(sc, basicFaceExtrusion(face, sc.add(new Vector(vsc(A, len)))));
  };
  const pocket = (cx: number, cy: number, len: number): Shape3D => {
    if (keys.type === 'Pins') return keep(sc, makeCylinder(size / 2 + c, h + c + inside, vadd(point(cx, cy), vsc(n, inside)), down));
    const ctr = point(cx, cy);
    if (keys.type === 'Rib') {
      const w = size + 2 * c, L = len + 2 * c, p = vsub(ctr, vsc(B, w / 2)), q = vadd(ctr, vsc(B, w / 2)), s = (x: Vec3, k: number): Vec3 => vadd(vadd(x, vsc(A, k)), vsc(n, inside));
      const face = keep(sc, makePolygon([s(p, -L / 2), s(q, -L / 2), vadd(s(q, -L / 2), vsc(down, h + c + inside)), vadd(s(p, -L / 2), vsc(down, h + c + inside))]));
      return keep(sc, basicFaceExtrusion(face, sc.add(new Vector(vsc(A, L)))));
    }
    const w0 = size + 2 * c, dd = h + c, wide = w0 + 2 * dd * tg, L = len + 2 * c;
    const at = (w: number, d2: number, k: number): Vec3 => vadd(vadd(vadd(ctr, vsc(B, w)), vsc(down, d2)), vsc(A, k));
    const face = keep(sc, makePolygon([at(-w0 / 2, -inside, -L / 2), at(w0 / 2, -inside, -L / 2), at(wide / 2, dd, -L / 2), at(-wide / 2, dd, -L / 2)]));
    return keep(sc, basicFaceExtrusion(face, sc.add(new Vector(vsc(A, L)))));
  };
  // does a key sit wholly inside the body on both sides of the cut? (pos above, neg below, with a wall around it)
  const within = (m: Shape3D): boolean => {
    const vm = measureVolume(m);
    return vm > 0 && measureVolume(keep(sc, m.intersect(pos))) + measureVolume(keep(sc, m.intersect(neg))) > vm * 0.999;
  };
  const fits = (m: Shape3D, p: Shape3D): boolean => within(m) && within(p);
  const placed: { m: Shape3D; p: Shape3D }[] = [];
  const wall = 0.8;
  if (keys.type === 'Pins') {
    const n0 = Math.max(1, Math.round(keys.count));
    for (let i = 0; i < n0; i++) {
      const a = a0 + ((a1 - a0) * (i + 1)) / (n0 + 1);
      let ok: { m: Shape3D; p: Shape3D } | null = null;
      for (const sh of [0, 1, -1, 2, -2].map((k) => k * (b1 - b0) * 0.12)) {
        const m = male(a, bMid + sh, 0), p = pocket(a, bMid + sh, 0);
        const guard = keep(sc, makeCylinder(size / 2 + c + wall, h + c + inside + wall, vadd(point(a, bMid + sh), vsc(n, inside)), down));
        if (fits(guard, p)) { ok = { m, p }; break; }
      }
      if (ok) placed.push(ok);
    }
  } else {
    // one rib or dovetail along the cut, as long as fits (up to 60 % of the cut)
    for (const frac of [0.6, 0.45, 0.3, 0.2]) {
      const len = (a1 - a0) * frac, m = male((a0 + a1) / 2, bMid, len), p = pocket((a0 + a1) / 2, bMid, len);
      if (fits(p, p)) { placed.push({ m, p }); break; }
    }
  }
  if (!placed.length) throw new Error('no room for the keys on that cut. Make them smaller or shallower');
  let P = pos, N = neg;
  placed.forEach(({ m, p }) => { P = keep(sc, P.fuse(m)); N = keep(sc, N.cut(p)); });
  const want = keys.type === 'Pins' ? Math.max(1, Math.round(keys.count)) : 1;
  return { pos: P, neg: N, info: `Split in two with ${placed.length} ${keys.type === 'Pins' ? 'pin' : keys.type === 'Rib' ? 'rib' : 'dovetail'}${placed.length > 1 ? 's' : ''}` + (placed.length < want ? ` (only ${placed.length} of ${want} fit)` : '') };
}
