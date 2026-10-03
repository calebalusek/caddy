// Wall-thickness check: how thick is the part behind every spot of its surface? From each spot a ray goes straight
// into the body; the distance to the far side is the wall there. Thin walls print badly (or not at all).
// Pure maths on triangle meshes (no DOM, no kernel), so it is tested against exact sizes.
import type { Vec3 } from './types';

export interface MeshLike { positions: ArrayLike<number>; normals: ArrayLike<number>; indices: ArrayLike<number> }
export interface Thickness {
  /** Triangles thinner than the limit: 9 numbers each. */
  tris: number[];
  /** 0 (just under the limit) to 1 (nothing there), one per flagged triangle. */
  severity: number[];
  /** Area that is too thin, and the area of the whole surface (mm²). */
  area: number;
  total: number;
  /** The thinnest wall found and where (Infinity / null when there is no body). */
  thinnest: number;
  at: Vec3 | null;
}

interface Node { lo: Vec3; hi: Vec3; left: Node | null; right: Node | null; tris: number[] }

/** A bounding-box tree over the triangles, so a ray only tests the few triangles near it. */
function buildTree(P: ArrayLike<number>, I: ArrayLike<number>): { root: Node | null; n: number } {
  const n = Math.floor(I.length / 3), boxes = new Float64Array(n * 6), cen = new Float64Array(n * 3);
  for (let t = 0; t < n; t++) {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let k = 0; k < 3; k++) for (let d = 0; d < 3; d++) { const v = P[I[t * 3 + k] * 3 + d]; lo[d] = Math.min(lo[d], v); hi[d] = Math.max(hi[d], v); }
    for (let d = 0; d < 3; d++) { boxes[t * 6 + d] = lo[d]; boxes[t * 6 + 3 + d] = hi[d]; cen[t * 3 + d] = (lo[d] + hi[d]) / 2; }
  }
  const make = (ids: number[]): Node => {
    const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    ids.forEach((t) => { for (let d = 0; d < 3; d++) { lo[d] = Math.min(lo[d], boxes[t * 6 + d]); hi[d] = Math.max(hi[d], boxes[t * 6 + 3 + d]); } });
    if (ids.length <= 6) return { lo, hi, left: null, right: null, tris: ids };
    let axis = 0;
    for (let d = 1; d < 3; d++) if (hi[d] - lo[d] > hi[axis] - lo[axis]) axis = d;
    const sorted = ids.slice().sort((a, b) => cen[a * 3 + axis] - cen[b * 3 + axis]), mid = sorted.length >> 1;
    return { lo, hi, left: make(sorted.slice(0, mid)), right: make(sorted.slice(mid)), tris: [] };
  };
  return { root: n ? make(Array.from({ length: n }, (_, i) => i)) : null, n };
}

/** Distance along a ray to the nearest triangle (other than `skip`) beyond a hair's width; Infinity when it hits nothing. */
function castRay(P: ArrayLike<number>, I: ArrayLike<number>, root: Node, o: Vec3, d: Vec3, skip: number): number {
  let best = Infinity;
  const inv: Vec3 = [1 / (d[0] || 1e-30), 1 / (d[1] || 1e-30), 1 / (d[2] || 1e-30)], stack: Node[] = [root];
  while (stack.length) {
    const nd = stack.pop()!;
    let t0 = 0, t1 = best;
    for (let k = 0; k < 3; k++) {
      let a = (nd.lo[k] - o[k]) * inv[k], b = (nd.hi[k] - o[k]) * inv[k];
      if (a > b) { const s = a; a = b; b = s; }
      if (a > t0) t0 = a;
      if (b < t1) t1 = b;
      if (t0 > t1) break;
    }
    if (t0 > t1) continue;
    if (nd.left) { stack.push(nd.left!, nd.right!); continue; }
    for (const t of nd.tris) {
      if (t === skip) continue;
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2], e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-14) continue;
      const f = 1 / det, sx = o[0] - P[a], sy = o[1] - P[a + 1], sz = o[2] - P[a + 2], u = f * (sx * px + sy * py + sz * pz);
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x, v = f * (d[0] * qx + d[1] * qy + d[2] * qz);
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const tt = f * (e2x * qx + e2y * qy + e2z * qz);
      if (tt > 1e-6 && tt < best) best = tt;
    }
  }
  return best;
}

/** Flag every spot of the surface where the wall is thinner than `minWall` (mm). */
export function analyzeThickness(meshes: MeshLike[], minWall: number): Thickness {
  const out: Thickness = { tris: [], severity: [], area: 0, total: 0, thinnest: Infinity, at: null };
  const lim = Math.max(0, minWall), EPS = 1e-3;
  meshes.forEach((m) => {
    const P = m.positions, N = m.normals, I = m.indices, { root, n } = buildTree(P, I);
    if (!root) return;
    // a few spots per triangle; big meshes (threads) get one so the check stays quick
    const spots: [number, number, number][] = n > 40000 ? [[1 / 3, 1 / 3, 1 / 3]] : [[1 / 3, 1 / 3, 1 / 3], [0.7, 0.15, 0.15], [0.15, 0.7, 0.15], [0.15, 0.15, 0.7]];
    for (let t = 0; t < n; t++) {
      const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
      const ab: Vec3 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], ac: Vec3 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
      const area = Math.hypot(ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]) / 2;
      if (area < 1e-12) continue;
      out.total += area;
      let thin = Infinity, where: Vec3 | null = null;
      for (const [wa, wb, wc] of spots) {
        const p: Vec3 = [0, 1, 2].map((d) => wa * P[a + d] + wb * P[b + d] + wc * P[c + d]) as Vec3;
        let nx = wa * N[a] + wb * N[b] + wc * N[c], ny = wa * N[a + 1] + wb * N[b + 1] + wc * N[c + 1], nz = wa * N[a + 2] + wb * N[b + 2] + wc * N[c + 2];
        const l = Math.hypot(nx, ny, nz);
        if (l < 1e-9) continue;
        nx /= l; ny /= l; nz /= l;
        const d = castRay(P, I, root, [p[0] - nx * EPS, p[1] - ny * EPS, p[2] - nz * EPS], [-nx, -ny, -nz], t) + EPS;
        if (d < thin) { thin = d; where = p; }
      }
      if (!isFinite(thin)) continue;
      if (thin < out.thinnest) { out.thinnest = thin; out.at = where; }
      if (thin < lim) {
        out.tris.push(P[a], P[a + 1], P[a + 2], P[b], P[b + 1], P[b + 2], P[c], P[c + 1], P[c + 2]);
        out.severity.push(Math.min(1, 1 - thin / lim));
        out.area += area;
      }
    }
  });
  return out;
}
