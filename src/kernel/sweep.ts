// Sweep: move a flat profile along a path of lines and arcs. Built from exact pieces, one per path
// section: a straight run is a prism, an arc is a revolve (true cylinders and tori), and the pieces
// are joined. Sharp corners get a mitre joint, or (Round) the path corner is replaced by a true
// arc first. The line where one section hands over to the next is kept, so each section is its own face.
import { assembleWire, basicFaceExtrusion, cast, getOC, isShape3D, makeAx2, makePolygon, makeThreePointArc, measureVolume, revolution, Vector, type Face, type Shape3D, type Wire } from 'replicad';
import { toLocal, toWorld, vadd, vcross, vdot, vlen, vnorm, vsc, vsub } from '../model/frames';
import { reversePath, roundPath, segAngle, segLength, segTangent, SHARP, startNear, turnAt } from '../model/path';
import type { Vec3 } from '../model/types';
import type { P2 } from '../sketch/model';
import type { PathSeg, PathSpec, SweepStep } from './protocol';
import { tup, type Scope } from './scope';

/** A flat patch in space. Edges lying in it are section boundaries and are never merged away. */
export interface Disk { p: Vec3; n: Vec3; r: number }

const DEG = 180 / Math.PI;
/** v turned by ang (radians) around the unit axis k. */
const turn = (v: Vec3, k: Vec3, ang: number): Vec3 => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return vadd(vadd(vsc(v, c), vsc(vcross(k, v), s)), vsc(k, vdot(k, v) * (1 - c)));
};

/** Join or cut two shapes without tidying the result (so section boundaries are still there). */
export function rawBoolean(op: 'fuse' | 'cut' | 'common', a: { wrapped: any }, b: { wrapped: any }): any {
  const oc = getOC();
  const builder = op === 'fuse' ? new oc.BRepAlgoAPI_Fuse(a.wrapped, b.wrapped) : op === 'cut' ? new oc.BRepAlgoAPI_Cut(a.wrapped, b.wrapped) : new oc.BRepAlgoAPI_Common(a.wrapped, b.wrapped);
  try {
    builder.Build();
    if (builder.HasErrors()) throw new Error('the geometry engine could not combine the pieces');
    return cast(builder.Shape());
  } finally { builder.delete(); }
}

/** Merge faces that lie on the same surface, like every join does, but leave the section boundaries alone. */
export function unifyKeeping(shape: Shape3D, keeps: Disk[], sc: Scope): Shape3D {
  const oc = getOC();
  const up = new oc.ShapeUpgrade_UnifySameDomain(shape.wrapped, true, true, false);
  try {
    up.SetAngularTolerance(1e-3);
    if (keeps.length) sc.all(shape.edges).forEach((e) => {
      const pts = [tup(e.startPoint), tup(e.pointAt(0.5)), tup(e.endPoint)];
      if (keeps.some((d) => pts.every((p) => { const q = vsub(p, d.p); return Math.abs(vdot(q, d.n)) < 1e-4 && vlen(q) < d.r; }))) up.KeepShape(e.wrapped);
    });
    up.Build();
    const out = cast(up.Shape());
    if (!isShape3D(out)) throw new Error('the geometry engine could not tidy the result');
    return out;
  } finally { up.delete(); }
}

/** A block covering the side of the plane through C that m points to, S wide and deep. */
function slab(C: Vec3, m: Vec3, S: number, sc: Scope): Shape3D {
  const u = vnorm(Math.abs(m[0]) < 0.9 ? vcross(m, [1, 0, 0]) : vcross(m, [0, 1, 0])), v = vcross(m, u);
  const sq = sc.add(makePolygon(([[S, S], [-S, S], [-S, -S], [S, -S]] as P2[]).map(([a, b]) => vadd(C, vadd(vsc(u, a), vsc(v, b))))));
  return sc.add(basicFaceExtrusion(sq, sc.add(new Vector(vsc(m, S)))));
}

export type SweepResult = { tool: Shape3D; keeps: Disk[]; caps: Face[] } | { note: string };

/** The swept solid for one sweep feature. `face` is the profile where it was drawn. */
export function sweepSolid(face: Face, st: SweepStep, sc: Scope): SweepResult {
  if (!st.path || !st.path.segs.length) return { note: st.pathNote || 'its path is gone' };
  const perp = st.orientation !== 'Parallel';
  const fr = st.path.frame, n = fr.n;
  const W = (q: P2): Vec3 => toWorld(fr, q[0], q[1]);

  // the profile's outline, its middle, and which way it faces
  const samples: Vec3[] = [];
  sc.all(face.edges).forEach((e) => { const k = e.geomType === 'LINE' ? 1 : 48; for (let i = 0; i <= k; i++) samples.push(tup(e.pointAt(i / k))); });
  const cen = tup(face.center), nF = vnorm(tup(face.normalAt()));
  const profR = Math.max(...samples.map((p) => vlen(vsub(p, cen)))) + 1e-3;

  // the sweep starts at the end of the path nearest the profile
  let path: PathSpec = st.path;
  if (path.closed) {
    if (path.segs.length === 1 && path.segs[0].type === 'arc' && path.segs[0].full) {
      const s = path.segs[0], l = toLocal(fr, cen), d: P2 = [l[0] - s.c[0], l[1] - s.c[1]], dl = Math.hypot(d[0], d[1]);
      if (dl > 1e-9) { const a: P2 = [s.c[0] + (d[0] / dl) * s.r, s.c[1] + (d[1] / dl) * s.r]; path = { ...path, segs: [{ ...s, a, b: a }] }; }
    } else path = startNear(path, cen);
  } else {
    const first = W(path.segs[0].a), last = W(path.segs[path.segs.length - 1].b);
    if (vlen(vsub(last, cen)) < vlen(vsub(first, cen))) path = reversePath(path);
  }
  const P0 = W(path.segs[0].a);
  const dir3 = (t: P2): Vec3 => vadd(vsc(fr.u, t[0]), vsc(fr.v, t[1]));
  const t0 = dir3(segTangent(path.segs[0], false));
  const reach = Math.max(...samples.map((p) => vlen(vsub(p, P0))));
  if (perp && st.corners !== 'Mitered') {
    const side = vcross(n, t0); // to the left of the direction of travel
    path = roundPath(path, (s) => Math.max(...samples.map((p) => vdot(vsub(p, P0), side) * s)));
  }
  const segs = path.segs, m = segs.length, closed = path.closed && !(m === 1 && segs[0].type === 'arc' && segs[0].full);

  // how far the profile has turned at the start and end of each piece
  const phi0: number[] = [], phi1: number[] = [], turns: number[] = []; // turns[j]: corner where piece j begins
  for (let i = 0; i < m; i++) {
    turns[i] = i > 0 ? turnAt(segs[i - 1], segs[i]) : closed ? turnAt(segs[m - 1], segs[0]) : 0;
    if (Math.abs(turns[i]) > (170 * Math.PI) / 180) return { note: 'the path doubles back on itself' };
    phi0[i] = !perp ? 0 : i === 0 ? 0 : phi1[i - 1] + turns[i];
    const s = segs[i];
    phi1[i] = !perp ? 0 : phi0[i] + (s.type === 'arc' ? (s.ccw ? 1 : -1) * segAngle(s) : 0);
  }
  type Joint = 'none' | 'smooth' | 'mitre' | 'pivot';
  const jointAt = (j: number): Joint => { // j = 0..m; the joint where piece j begins (j = m: after the last piece)
    if (j === 0 || j === m) { if (!closed) return 'none'; j = 0; }
    const d = Math.abs(turns[j]);
    if (!perp || d < 1e-6) return 'smooth';
    return d > SHARP && st.corners !== 'Mitered' ? 'pivot' : 'mitre';
  };
  const turnOf = (j: number): number => turns[j === m ? 0 : j];

  /** The profile moved to path point q, turned by phi. */
  const place = (q: P2, phi: number, shift?: Vec3): Face => {
    let f = face.clone();
    if (Math.abs(phi) > 1e-12) f = f.rotate(phi * DEG, P0, n);
    let d = vsub(W(q), P0);
    if (shift) d = vadd(d, shift);
    if (vlen(d) > 1e-12) f = f.translate(d);
    return sc.add(f);
  };
  const placePt = (x: Vec3, q: P2, phi: number): Vec3 => vadd(W(q), turn(vsub(x, P0), n, phi));
  const keep = <T extends Shape3D>(s: T): T => sc.add(s);
  const prism = (f: Face, v: Vec3): Shape3D => keep(basicFaceExtrusion(f, sc.add(new Vector(v))));
  /** Spin a face around an axis; a face that reaches across the axis is split there so each half makes a clean solid. */
  const spin = (f: Face, pts: Vec3[], C: Vec3, d: Vec3, e: Vec3, angDeg: number, outerOnly = false): Shape3D | null => {
    const lo = Math.min(...pts.map((p) => vdot(vsub(p, C), e))), hi = Math.max(...pts.map((p) => vdot(vsub(p, C), e)));
    if (hi <= 1e-7) return outerOnly ? null : keep(revolution(f, C, d, angDeg));
    if (lo >= -1e-7) return keep(revolution(f, C, d, angDeg));
    const S = (Math.max(-lo, hi) + vlen(vsub(cen, P0)) + profR) * 4 + 10;
    let out: Shape3D | null = null;
    (outerOnly ? [1] : [1, -1]).forEach((sg) => {
      const half = sc.add(rawBoolean('common', f, slab(C, vsc(e, sg), S, sc)));
      sc.all(half.faces as Face[]).forEach((hf: Face) => { const part = keep(revolution(hf, C, d, angDeg)); out = out ? keep(rawBoolean('fuse', out, part)) : part; });
    });
    return out;
  };

  const E = (j: number): number => reach * Math.tan(Math.abs(turnOf(j)) / 2) + 1;
  const mitreN = (j: number): Vec3 => { // the mitre plane's normal at joint j, pointing along the path
    const tin = dir3(segTangent(segs[j === 0 || j === m ? m - 1 : j - 1], true)), tout = dir3(segTangent(segs[j === m ? 0 : j], false));
    return vnorm(vadd(tin, tout));
  };
  /** Cut away what lies beyond (side = 1) or before (side = -1) the mitre plane at joint j. */
  const trim = (s: Shape3D, j: number, C: Vec3, side: number): Shape3D => keep(s.cut(slab(C, vsc(mitreN(j), side), (E(j) + reach) * 2 + 2, sc)));

  const pieces: Shape3D[] = [], keeps: Disk[] = [];
  for (let i = 0; i < m; i++) {
    const s = segs[i], j0 = jointAt(i), j1 = jointAt(i + 1), ta = dir3(segTangent(s, false)), tb = dir3(segTangent(s, true));
    const A = W(s.a), B = W(s.b);
    const nNow = turn(nF, n, phi0[i]);
    // a line is kept where one path curve hands over to the next (not where one curve was only split)
    if (j0 === 'smooth' && m > 1 && segs[(i + m - 1) % m].cid !== s.cid) keeps.push({ p: placePt(cen, s.a, phi0[i]), n: nNow, r: profR });
    if (s.type === 'line') {
      if (Math.abs(vdot(nNow, ta)) < 1e-4) return { note: perp ? 'the profile lies flat along the path. Draw the profile across the start of the path' : 'the path runs flat along the profile there. Try Perpendicular' };
      const e0 = j0 === 'mitre' ? E(i) : 0, e1 = j1 === 'mitre' ? E(i + 1) : 0;
      let p = prism(place(s.a, phi0[i], vsc(ta, -e0)), vsc(ta, segLength(s) + e0 + e1));
      if (e0) p = trim(p, i, A, -1);
      if (e1) p = trim(p, i + 1, B, 1);
      pieces.push(p);
    } else if (perp) {
      if (Math.abs(vdot(nNow, ta)) < 1e-4) return { note: 'the profile lies flat along the path. Draw the profile across the start of the path' };
      const C = W(s.c), d = s.ccw ? n : vsc(n, -1), total = segAngle(s);
      // only the stretch next to a mitred corner is trimmed, so a long arc is never cut where it curls back
      const head = j0 === 'mitre' && total > 1 ? 0.75 : 0, tail = j1 === 'mitre' && total - head > 1 ? 0.75 : 0;
      const cuts = [0, head, total - tail, total].filter((v, k, a) => k === 0 || v > a[k - 1] + 1e-9);
      for (let k = 0; k + 1 < cuts.length; k++) {
        const g0 = cuts[k], g1 = cuts[k + 1], sgn = s.ccw ? 1 : -1;
        const q = segPointAt(s, g0), ph = phi0[i] + sgn * g0;
        const f = place(q, ph), pts = samples.map((x) => placePt(x, q, ph));
        let p = spin(f, pts, C, d, vnorm(vsub(W(q), C)), (g1 - g0) * DEG);
        if (!p) continue;
        if (j0 === 'mitre' && k === 0) p = trim(p, i, A, -1);
        if (j1 === 'mitre' && k === cuts.length - 2) p = trim(p, i + 1, B, 1);
        pieces.push(p);
      }
      // a mitre next to an arc: continue straight along the tangent up to the mitre plane
      if (j0 === 'mitre') pieces.push(trim(prism(place(s.a, phi0[i], vsc(ta, -E(i))), vsc(ta, E(i))), i, A, -1));
      if (j1 === 'mitre') pieces.push(trim(prism(place(s.b, phi1[i]), vsc(tb, E(i + 1))), i + 1, B, 1));
    } else {
      // Parallel along an arc: the profile slides without turning
      const along = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1].map((f) => vdot(nF, f === 0 ? ta : dir3(segTangent({ ...s, b: segPointAt(s, segAngle(s) * f), full: false }, true))));
      if (along.some((v) => Math.abs(v) < 1e-4 || Math.sign(v) !== Math.sign(along[0]))) return { note: 'the path turns flat along the profile. Try Perpendicular' };
      pieces.push(slide(place(s.a, 0), s, W, sc));
    }
    // Round, where a corner had no room for a bend: the profile pivots around the corner point
    if (j1 === 'pivot' && (i + 1 < m || closed)) {
      const dl = turnOf(i + 1), sg = Math.sign(dl), out = vsc(vcross(n, tb), -sg);
      const f = place(s.b, phi1[i]), pts = samples.map((x) => placePt(x, s.b, phi1[i]));
      const p = spin(f, pts, B, vsc(n, sg), out, Math.abs(dl) * DEG, true);
      if (p) pieces.push(p);
    }
  }
  if (!pieces.length) return { note: 'nothing to sweep' };

  let tool = pieces[0];
  for (let k = 1; k < pieces.length; k++) tool = keep(rawBoolean('fuse', tool, pieces[k]));
  tool = keep(unifyKeeping(tool, keeps, sc));
  if (!(measureVolume(tool) > 1e-9)) return { note: 'nothing to sweep' };
  return { tool, keeps, caps: closed || path.closed ? [] : [face, place(segs[m - 1].b, phi1[m - 1])] };
}

/** A point on an arc piece, ang radians along from its start. */
function segPointAt(s: Extract<PathSeg, { type: 'arc' }>, ang: number): P2 {
  const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]), t = a0 + (s.ccw ? 1 : -1) * ang;
  return [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)];
}

/** Slide a face along an arc without turning it. Holes are slid the same way and cut out. */
function slide(f: Face, s: Extract<PathSeg, { type: 'arc' }>, W: (q: P2) => Vec3, sc: Scope): Shape3D {
  const oc = getOC();
  const half = segPointAt(s, segAngle(s) / 2);
  const spine = sc.add(assembleWire([sc.add(makeThreePointArc(W(s.a), W(half), W(s.b)))]));
  const ax = makeAx2([0, 0, 0], [0, 0, 1]);
  const pipe = (w: Wire): Shape3D => {
    const b = new oc.BRepOffsetAPI_MakePipeShell(spine.wrapped);
    try {
      b.SetMode(ax);
      b.Add(w.wrapped, false, false);
      b.Build();
      b.MakeSolid();
      const out = cast(b.Shape());
      if (!isShape3D(out)) throw new Error('the geometry engine could not sweep along that arc');
      return sc.add(out);
    } finally { b.delete(); }
  };
  try {
    const outer = sc.add(f.clone().outerWire());
    let out = pipe(outer);
    sc.all(f.wires).forEach((w) => { if (!w.isSame(outer)) out = sc.add(out.cut(pipe(w))); });
    return out;
  } finally { ax.delete(); }
}
