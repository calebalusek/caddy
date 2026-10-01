// Plane frames and small vector helpers (plain arrays, no three.js).
import type { Frame, OriginPlaneId, Vec3 } from './types';

export const vadd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vsub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vsc = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const vdot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const vcross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vlen = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const vnorm = (a: Vec3): Vec3 => { const l = vlen(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

const mk = (o: Vec3, u: Vec3, v: Vec3, n: Vec3): Frame => ({ o, u, v, n, ext: [0, 30, 0, 30] });

/** The three origin planes, exactly as the prototype defines them (XZ looks toward −Y, the Front view). */
export const ORIGIN: Record<OriginPlaneId, Frame> = {
  XY: mk([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]),
  XZ: mk([0, 0, 0], [1, 0, 0], [0, 0, 1], [0, -1, 0]),
  YZ: mk([0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0]),
};

export const toWorld = (f: Frame, x: number, y: number, z = 0): Vec3 =>
  vadd(vadd(vadd(f.o, vsc(f.u, x)), vsc(f.v, y)), vsc(f.n, z));

export const toLocal = (f: Frame, p: Vec3): [number, number] => {
  const d = vsub(p, f.o);
  return [vdot(d, f.u), vdot(d, f.v)];
};

export const offsetFrame = (f: Frame, d: number): Frame => ({
  o: vadd(f.o, vsc(f.n, d)),
  u: [...f.u],
  v: [...f.v],
  n: [...f.n],
  ext: [...f.ext],
});

/** Frame for a flat body face with normal n through point p; the drawn extent is centered on p. */
export function frameFromFace(n: Vec3, p: Vec3): Frame {
  n = vnorm(n);
  const u = Math.abs(n[2]) > 0.9 ? ([1, 0, 0] as Vec3) : vnorm(vcross([0, 0, 1], n));
  const v = vnorm(vcross(n, u));
  const o = vsc(n, vdot(n, p));
  const d = vsub(p, o), cx = vdot(d, u), cy = vdot(d, v);
  return { o, u, v, n, ext: [cx - 30, cx + 30, cy - 30, cy + 30] };
}
