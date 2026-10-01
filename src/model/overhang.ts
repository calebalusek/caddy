// Overhang check: which parts of a model hang over empty space and would need support when printed.
// Pure maths on triangle meshes (no DOM, no kernel), so it is tested against exact areas.
import { vdot, vnorm } from './frames';
import type { Vec3 } from './types';

export interface MeshLike { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number> }
export interface Overhang {
  /** Flagged triangles: 9 numbers each (three corners). */
  tris: number[];
  /** How far past the limit each flagged triangle is, 0 (just over) to 1 (a flat ceiling), one per triangle. */
  severity: number[];
  /** Area that needs support, and the area of the whole surface (mm²). */
  area: number;
  total: number;
  /** The angle (degrees from vertical) of the worst triangle. */
  worst: number;
}

/**
 * A surface leans out by an angle from vertical: 0° is a wall, 90° is a flat ceiling. Anything leaning out
 * more than `maxAngle` needs support, except flat floors that sit on the build plate.
 * `up` is the direction the print grows (the model's +Z unless a bed face was chosen).
 */
export function analyzeOverhang(meshes: MeshLike[], up: Vec3, maxAngle: number): Overhang {
  const u = vnorm(up), down: Vec3 = [-u[0], -u[1], -u[2]], out: Overhang = { tris: [], severity: [], area: 0, total: 0, worst: 0 };
  let bed = Infinity;
  meshes.forEach((m) => { for (let i = 0; i < m.positions.length; i += 3) bed = Math.min(bed, vdot([m.positions[i], m.positions[i + 1], m.positions[i + 2]], u)); });
  const lim = Math.max(0, maxAngle); // 90° or more: the printer can bridge anything
  meshes.forEach((m) => {
    const P = m.positions, N = m.normals, I = m.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const A: Vec3 = [P[a], P[a + 1], P[a + 2]], B: Vec3 = [P[b], P[b + 1], P[b + 2]], C: Vec3 = [P[c], P[c + 1], P[c + 2]];
      const ab: Vec3 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], ac: Vec3 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const cr: Vec3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const area = Math.hypot(...cr) / 2;
      if (area < 1e-12) continue;
      out.total += area;
      // the face's outward direction: the kernel's smooth normals (true for curved faces), averaged over the triangle
      const n = vnorm([N[a] + N[b] + N[c], N[a + 1] + N[b + 1] + N[c + 1], N[a + 2] + N[b + 2] + N[c + 2]]);
      const lean = (Math.asin(Math.max(-1, Math.min(1, vdot(n, down)))) * 180) / Math.PI; // > 0: facing down
      if (lean <= lim) continue;
      const onBed = [A, B, C].every((p) => vdot(p, u) < bed + 0.01);
      if (onBed) continue;
      out.tris.push(...A, ...B, ...C);
      out.severity.push(Math.min(1, (lean - lim) / (90 - lim)));
      out.area += area;
      out.worst = Math.max(out.worst, lean);
    }
  });
  return out;
}
