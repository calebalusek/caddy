// Builds every body from the timeline with the real kernel (exact B-rep: true planes, cylinders, arcs).
// Runs wherever the kernel is loaded: the Web Worker in the app, Node in tests.
import {
  assembleWire, basicFaceExtrusion, exportSTEP, makeCircle, makeFace, makeLine, makePolygon, makeThreePointArc, makeVertex, revolution, measureArea, measureDistanceBetween, measureVolume, Vector,
  type Edge, type Face, type Shape3D, type Wire,
} from 'replicad';
import { toWorld, vadd, vcross, vdot, vlen, vnorm, vsc, vsub } from '../model/frames';
import type { Frame, Vec3 } from '../model/types';
import type { P2 } from '../sketch/model';
import { arcDelta } from '../sketch/profiles';
import { matchEdge } from './match';
import type { BodyMesh, BodyResult, BuildResult, BuildStep, EdgeInfo, FaceInfo, LoopSpec, Operation, ProfileSpec, StepResult } from './protocol';
import { Scope, tup } from './scope';
import { rawBoolean, sweepSolid, unifyKeeping, type Disk } from './sweep';

/** Display tessellation: chord error in mm and angle step in radians. */
export const DISPLAY_QUALITY = { tolerance: 0.02, angularTolerance: 0.2 };

const r4 = (v: number): number => Math.round(v * 1e4) / 1e4 + 0; // + 0 turns -0 into 0

// ---- profiles → kernel faces ----
function loopWire(frame: Frame, loop: LoopSpec, z: number, reversed: boolean, sc: Scope): Wire {
  const W = (p: P2): Vec3 => toWorld(frame, p[0], p[1], z);
  if ('circle' in loop) return assembleWire([sc.add(makeCircle(loop.circle.r, W(loop.circle.c), reversed ? vsc(frame.n, -1) : frame.n))]);
  const edges = (reversed ? loop.edges.slice().reverse() : loop.edges).map((e) => {
    const a = reversed ? e.b : e.a, b = reversed ? e.a : e.b;
    if (e.type === 'line') return sc.add(makeLine(W(a), W(b)));
    const a0 = Math.atan2(e.a[1] - e.c[1], e.a[0] - e.c[0]), tm = a0 + arcDelta(e) / 2;
    return sc.add(makeThreePointArc(W(a), W([e.c[0] + e.r * Math.cos(tm), e.c[1] + e.r * Math.sin(tm)]), W(b)));
  });
  return assembleWire(edges);
}
/** The outer boundary runs counter-clockwise; holes must run the other way or the kernel adds them. */
function profileFace(p: ProfileSpec, z: number, sc: Scope): Face {
  const outer = sc.add(loopWire(p.frame, p.outer, z, false, sc));
  const holes = p.holes.map((h) => sc.add(loopWire(p.frame, h, z, true, sc)));
  return makeFace(outer, holes);
}

/** Points along a loop (ends, and a few along each arc), enough to tell which side of a line it is on. */
function loopSamples(loop: LoopSpec): P2[] {
  if ('circle' in loop) { const { c, r } = loop.circle; return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => [c[0] + r * Math.cos((i * Math.PI) / 4), c[1] + r * Math.sin((i * Math.PI) / 4)] as P2); }
  return loop.edges.flatMap((e) => {
    if (e.type === 'line') return [e.a];
    const a0 = Math.atan2(e.a[1] - e.c[1], e.a[0] - e.c[0]), dl = arcDelta(e);
    return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => { const t = a0 + (dl * i) / 8; return [e.c[0] + e.r * Math.cos(t), e.c[1] + e.r * Math.sin(t)] as P2; });
  });
}

// ---- which feature made which face ----
/** A surface's identity that does not depend on which way the face points: used to carry tags through booleans. */
function signature(f: Face): string {
  const type = f.geomType;
  try {
    if (type === 'PLANE') {
      let n = vnorm(tup(f.normalAt()));
      const c = tup(f.center);
      const lead = Math.abs(n[0]) > 1e-6 ? n[0] : Math.abs(n[1]) > 1e-6 ? n[1] : n[2];
      if (lead < 0) n = vsc(n, -1);
      return 'P' + n.map(r4).join(',') + '|' + r4(vdot(n, c));
    }
    if (type === 'CYLINDRE') {
      const cyl = (f.surface as any).wrapped.Cylinder(), ax = cyl.Axis(), d0 = ax.Direction(), l0 = ax.Location();
      let d: Vec3 = [d0.X(), d0.Y(), d0.Z()];
      const loc: Vec3 = [l0.X(), l0.Y(), l0.Z()];
      const lead = Math.abs(d[0]) > 1e-6 ? d[0] : Math.abs(d[1]) > 1e-6 ? d[1] : d[2];
      if (lead < 0) d = vsc(d, -1);
      const foot = vsub(loc, vsc(d, vdot(loc, d)));
      const sig = 'C' + d.map(r4).join(',') + '|' + foot.map(r4).join(',') + '|' + r4(cyl.Radius());
      [cyl, ax, d0, l0].forEach((o) => o.delete && o.delete());
      return sig;
    }
  } catch { /* fall through to the generic signature */ }
  const b = f.boundingBox, [lo, hi] = b.bounds;
  b.delete();
  return type + lo.concat(hi).map(r4).join(',');
}

/** keeps: section boundaries of sweeps in this body, which later joins and cuts must not merge away. */
interface BodyState { id: string; shape: Shape3D | null; tags: Map<string, string>; keeps: Disk[] }

function retag(result: Shape3D, old: Map<string, string>, tool: Map<string, string> | null, fresh: (f: Face) => string, sc: Scope): Map<string, string> {
  const tags = new Map<string, string>();
  sc.all(result.faces).forEach((f) => {
    const sig = signature(f);
    if (tags.has(sig)) return;
    tags.set(sig, old.get(sig) || (tool && tool.get(sig)) || fresh(f));
  });
  return tags;
}

// ---- topology for the UI ----
export function meshBody(shape: Shape3D): BodyMesh {
  const faces = shape.mesh(DISPLAY_QUALITY), edges = shape.meshEdges(DISPLAY_QUALITY);
  return {
    positions: new Float32Array(faces.vertices),
    normals: new Float32Array(faces.normals),
    indices: new Uint32Array(faces.triangles),
    faceGroups: faces.faceGroups.map((g) => ({ start: g.start, count: g.count, faceId: g.faceId })),
    edgeLines: new Float32Array(edges.lines),
    edgeGroups: edges.edgeGroups.map((g) => ({ start: g.start, count: g.count, edgeId: g.edgeId })),
    volume: measureVolume(shape),
  };
}

function edgeInfos(shape: Shape3D, sc: Scope): { infos: EdgeInfo[]; byId: Map<number, Edge> } {
  const faces = sc.all(shape.faces);
  const facesOf = new Map<number, Face[]>();
  faces.forEach((f) => sc.all(f.edges).forEach((e) => { const h = e.hashCode; if (!facesOf.has(h)) facesOf.set(h, []); const l = facesOf.get(h)!; if (!l.includes(f)) l.push(f); }));
  const infos: EdgeInfo[] = [], byId = new Map<number, Edge>();
  sc.all(shape.edges).forEach((e) => {
    const id = e.hashCode;
    if (byId.has(id)) return;
    byId.set(id, e);
    const type = e.geomType, a = tup(e.startPoint), b = tup(e.endPoint), mid = tup(e.pointAt(0.5));
    const adj = facesOf.get(id) || [];
    const nAt = (f: Face | undefined): Vec3 => (f ? vnorm(tup(f.normalAt(mid))) : [0, 0, 0]);
    const info: EdgeInfo = { id, kind: type === 'LINE' ? 'line' : type === 'CIRCLE' ? 'round' : 'other', a, b, mid, faces: adj.map((f) => f.hashCode), n1: nAt(adj[0]), n2: nAt(adj[1]) };
    if (type === 'CIRCLE') {
      try {
        const ad = (e as any)._geomAdaptor(), c = ad.Circle(), ax = c.Axis(), d = ax.Direction(), l = c.Location();
        info.center = [l.X(), l.Y(), l.Z()]; info.axis = [d.X(), d.Y(), d.Z()]; info.R = c.Radius(); info.closed = e.isClosed;
        [c, ax, d, l, ad].forEach((o) => o.delete && o.delete());
      } catch { info.kind = 'other'; }
    }
    infos.push(info);
  });
  return { infos, byId };
}

function faceInfos(shape: Shape3D, mesh: BodyMesh, tags: Map<string, string>, sc: Scope): FaceInfo[] {
  const group = new Map(mesh.faceGroups.map((g) => [g.faceId, g]));
  return sc.all(shape.faces).map((f) => {
    const id = f.hashCode, planar = f.geomType === 'PLANE', g = group.get(id);
    // a point that is really on the face: the middle of one of its triangles
    let p: Vec3 = tup(f.center);
    if (g && g.count >= 3) {
      const i = g.start + Math.floor(g.count / 6) * 3, P = mesh.positions, I = mesh.indices;
      p = [0, 1, 2].map((k) => (P[I[i] * 3 + k] + P[I[i + 1] * 3 + k] + P[I[i + 2] * 3 + k]) / 3) as Vec3;
    }
    const n = vnorm(tup(planar ? f.normalAt() : f.normalAt(p)));
    return { id, surf: tags.get(signature(f)) || '', planar, n, p, area: measureArea(f) };
  });
}

/**
 * Round faces have a "seam" where the surface closes on itself. The kernel lists it as an edge,
 * but it is not a crease or a boundary between faces, so it is neither drawn nor pickable.
 */
function dropSeams(mesh: BodyMesh, edges: EdgeInfo[]): EdgeInfo[] {
  const real = edges.filter((e) => e.faces.length >= 2), keep = new Set(real.map((e) => e.id));
  if (real.length === edges.length) return edges;
  const lines: number[] = [], groups: BodyMesh['edgeGroups'] = [];
  mesh.edgeGroups.forEach((g) => {
    if (!keep.has(g.edgeId)) return;
    const start = lines.length / 3;
    for (let k = g.start * 3; k < (g.start + g.count) * 3; k++) lines.push(mesh.edgeLines[k]);
    groups.push({ start, count: g.count, edgeId: g.edgeId });
  });
  mesh.edgeLines = new Float32Array(lines);
  mesh.edgeGroups = groups;
  return real;
}

function bodyResult(b: BodyState, sc: Scope): BodyResult {
  const shape = b.shape!, mesh = meshBody(shape), bb = shape.boundingBox, [lo, hi] = bb.bounds;
  bb.delete();
  const edges = dropSeams(mesh, edgeInfos(shape, sc).infos);
  return { id: b.id, mesh, faces: faceInfos(shape, mesh, b.tags, sc), edges, volume: mesh.volume, box: [lo as Vec3, hi as Vec3] };
}

const boxesTouch = (a: [Vec3, Vec3], b: [Vec3, Vec3], pad = 1e-3): boolean => [0, 1, 2].every((k) => a[0][k] - pad <= b[1][k] && b[0][k] - pad <= a[1][k]);
function boxOf(s: Shape3D): [Vec3, Vec3] { const bb = s.boundingBox, [lo, hi] = bb.bounds; bb.delete(); return [lo as Vec3, hi as Vec3]; }
const errText = (e: unknown): string => (e instanceof Error ? e.message : 'the geometry engine could not compute it');

/** The flat body face a press-pull started from. */
function findFace(shape: Shape3D, spec: { n: Vec3; w: number; p: Vec3; surf?: string }, tags: Map<string, string>, sc: Scope): Face | null {
  let best: Face | null = null, bd = Infinity;
  const pt = sc.add(makeVertex(spec.p));
  sc.all(shape.faces).forEach((f) => {
    if (f.geomType !== 'PLANE') return;
    const n = vnorm(tup(f.normalAt()));
    if (vdot(n, vnorm(spec.n)) < 0.9999) return;
    const d = measureDistanceBetween(pt, f) + (spec.surf && tags.get(signature(f)) === spec.surf ? 0 : 0.5);
    if (d < bd) { bd = d; best = f; }
  });
  return best;
}

/** Run the timeline's solid features in order. Everything created is tracked in sc and freed by the caller. */
function runSteps(steps: BuildStep[], sc: Scope): { bodies: BodyState[]; results: StepResult[] } {
  const bodies: BodyState[] = [];
  const body = (id: string): BodyState => { let b = bodies.find((x) => x.id === id); if (!b) { b = { id, shape: null, tags: new Map(), keeps: [] }; bodies.push(b); } return b; };
  const results: StepResult[] = [];
  const keep = <T extends Shape3D>(s: T): T => sc.add(s);
  /** Join the tool to a body, cut it from every body it touches, or make it a new body. Returns what went wrong, if anything. */
  /** Join or cut. A body with sweep sections keeps their boundary lines; everything else merges as usual. */
  const bool = (op: 'fuse' | 'cut', b: BodyState, tool: Shape3D): Shape3D =>
    keep(b.keeps.length ? unifyKeeping(sc.add(rawBoolean(op, b.shape!, tool)), b.keeps, sc) : op === 'fuse' ? b.shape!.fuse(tool) : b.shape!.cut(tool));
  const combine = (op: Operation, bodyId: string | null, tool: Shape3D, toolTags: Map<string, string>, tbox: [Vec3, Vec3], tag: string, toolKeeps: Disk[] = []): string | null => {
    const fresh = (): string => tag;
    if (op === 'Cut') {
      const targets = bodies.filter((b) => b.shape && boxesTouch(boxOf(b.shape), tbox));
      if (!targets.length) return 'nothing to cut';
      targets.forEach((b) => { b.keeps = b.keeps.concat(toolKeeps); const out = bool('cut', b, tool); b.tags = retag(out, b.tags, toolTags, fresh, sc); b.shape = out; });
      return null;
    }
    if (!bodyId) return 'it has no body';
    const b = body(bodyId);
    if (op === 'Join' && b.shape) { b.keeps = b.keeps.concat(toolKeeps); const out = bool('fuse', b, tool); b.tags = retag(out, b.tags, toolTags, fresh, sc); b.shape = out; }
    else { b.shape = tool; b.tags = toolTags; b.keeps = toolKeeps.slice(); }
    return null;
  };

  for (const st of steps) {
    const res: StepResult = { id: st.id };
    results.push(res);
    try {
      if (st.kind === 'extrude') {
        if (st.depth < 0.01) { res.error = true; res.note = 'its distance is 0'; continue; }
        let tool: Shape3D, normal: Vec3;
        if (st.face) {
          const src = bodies.find((b) => b.id === st.face!.bodyId);
          const f = src && src.shape ? findFace(src.shape, st.face, src.tags, sc) : null;
          if (!f) { res.error = true; res.note = 'its face is gone'; continue; }
          normal = vnorm(st.face.n);
          const moved = Math.abs(st.z0) > 1e-9 ? sc.add(f.clone().translate(vsc(normal, st.z0))) : f;
          tool = keep(basicFaceExtrusion(moved, sc.add(new Vector(vsc(normal, st.depth)))));
        } else if (st.profile) {
          normal = st.profile.frame.n;
          tool = keep(basicFaceExtrusion(sc.add(profileFace(st.profile, st.z0, sc)), sc.add(new Vector(vsc(normal, st.depth)))));
        } else { res.error = true; res.note = 'its profile is gone'; continue; }
        const tbox = boxOf(tool);
        res.box = tbox;
        const toolTags = new Map<string, string>();
        let side = 0;
        sc.all(tool.faces).forEach((f) => {
          const sig = signature(f);
          if (toolTags.has(sig)) return;
          const d = f.geomType === 'PLANE' ? vdot(vnorm(tup(f.normalAt())), normal) : 0;
          toolTags.set(sig, st.id + ':' + (d > 0.999 ? 'top' : d < -0.999 ? 'bot' : 's' + side++));
        });
        const bad = combine(st.operation, st.bodyId, tool, toolTags, tbox, st.id + ':x');
        if (bad) { res.error = true; res.note = bad; }
      } else if (st.kind === 'revolve') {
        if (!st.profile) { res.error = true; res.note = 'its profile is gone'; continue; }
        if (!st.axis) { res.error = true; res.note = 'pick an axis to revolve around'; continue; }
        const ang = Math.min(360, Math.abs(st.angle));
        if (ang < 0.01) { res.error = true; res.note = 'the angle needs to be more than 0°'; continue; }
        const fr = st.profile.frame, A = st.axis.A, d = vnorm(st.axis.d);
        if (Math.abs(vdot(d, fr.n)) > 1e-5 || Math.abs(vdot(fr.n, vsub(A, fr.o))) > 1e-3) { res.error = true; res.note = "the axis has to lie in the sketch's plane"; continue; }
        // the whole profile must sit on one side of the axis (touching it is fine)
        const e0 = vnorm(vcross(fr.n, d));
        let side = 0, crosses = false;
        [st.profile.outer, ...st.profile.holes].forEach((L) => loopSamples(L).forEach((p) => {
          const s = vdot(vsub(toWorld(fr, p[0], p[1]), A), e0);
          if (Math.abs(s) > 1e-6) { if (side && Math.sign(s) !== side) crosses = true; side = side || Math.sign(s); }
        }));
        if (crosses) { res.error = true; res.note = 'the profile crosses the axis. Move the axis to one side of the shape'; continue; }
        let face = sc.add(profileFace(st.profile, 0, sc));
        if (Math.abs(st.ang0) > 1e-9) face = sc.add(face.clone().rotate(st.ang0, A, d));
        const tool = keep(revolution(face, A, d, ang));
        const tbox = boxOf(tool);
        res.box = tbox;
        const toolTags = new Map<string, string>();
        let k = 0;
        sc.all(tool.faces).forEach((f) => { const sig = signature(f); if (!toolTags.has(sig)) toolTags.set(sig, st.id + ':r' + k++); });
        const bad = combine(st.operation, st.bodyId, tool, toolTags, tbox, st.id + ':x');
        if (bad) { res.error = true; res.note = bad; }
      } else if (st.kind === 'sweep') {
        let face: Face | null = null;
        if (st.face) {
          const src = bodies.find((b) => b.id === st.face!.bodyId);
          const f = src && src.shape ? findFace(src.shape, st.face, src.tags, sc) : null;
          if (!f) { res.error = true; res.note = 'its face is gone'; continue; }
          face = sc.add(f.clone());
        } else if (st.profile) face = sc.add(profileFace(st.profile, 0, sc));
        if (!face) { res.error = true; res.note = 'its profile is gone'; continue; }
        const r = sweepSolid(face, st, sc);
        if ('note' in r) { res.error = true; res.note = r.note; continue; }
        const tool = r.tool, tbox = boxOf(tool);
        res.box = tbox;
        const toolTags = new Map<string, string>();
        r.caps.forEach((c, k) => toolTags.set(signature(c), st.id + ':cap' + k));
        let k = 0;
        sc.all(tool.faces).forEach((f) => { const sig = signature(f); if (!toolTags.has(sig)) toolTags.set(sig, st.id + ':w' + k++); });
        const bad = combine(st.operation, st.bodyId, tool, toolTags, tbox, st.id + ':x', r.keeps);
        if (bad) { res.error = true; res.note = bad; }
      } else if (st.kind === 'hole') {
        const R = st.d / 2;
        if (!(R > 0)) { res.error = true; res.note = 'give the hole a diameter'; continue; }
        if (!st.at.length) { res.error = true; res.note = 'place the hole: click a flat face or a sketch point'; continue; }
        // "through all" drills far enough to come out of anything
        let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
        bodies.forEach((b) => { if (!b.shape) return; const bx = boxOf(b.shape); lo = lo.map((v, i) => Math.min(v, bx[0][i])) as Vec3; hi = hi.map((v, i) => Math.max(v, bx[1][i])) as Vec3; });
        const D = st.through ? (isFinite(lo[0]) ? vlen(vsub(hi, lo)) * 2 + 10 : 100) : st.depth;
        if (!(D > 0)) { res.error = true; res.note = 'give the hole a depth, or choose Through all'; continue; }
        // the drill's outline as (radius, depth); it starts a hair above the surface so the cut is clean
        let prof: [number, number][];
        if (st.type === 'Counterbore') {
          const Rc = st.cbD / 2, h = st.cbDepth;
          if (!(Rc > R) || !(h > 0) || h >= D) { res.error = true; res.note = 'counterbore needs a larger diameter and a depth smaller than the hole'; continue; }
          prof = [[0, -0.05], [Rc, -0.05], [Rc, h], [R, h], [R, D], [0, D]];
        } else if (st.type === 'Countersink') {
          const Rs = st.csD / 2;
          if (!(Rs > R)) { res.error = true; res.note = 'countersink needs a larger diameter than the hole'; continue; }
          prof = [[0, -0.05], [Rs + 0.05, -0.05], [R, Rs - R], [R, D], [0, D]];
        } else prof = [[0, -0.05], [R, -0.05], [R, D], [0, D]];
        let gone = 0, drilled = 0;
        st.at.forEach((spot, k) => {
          let c: Vec3, dir: Vec3;
          if (!spot) { gone++; return; }
          if ('face' in spot) {
            // on a body face: stay on that face even if it moved along its normal
            const src = bodies.find((b) => b.id === spot.face.bodyId), f = src && src.shape ? findFace(src.shape, spot.face, src.tags, sc) : null;
            if (!f) { gone++; return; }
            const n = vnorm(spot.face.n), w = vdot(n, tup(f.center));
            c = vadd(spot.face.p, vsc(n, w - spot.face.w)); dir = vsc(n, -1);
          } else { c = spot.c; dir = vnorm(spot.dir); }
          const e = vnorm(Math.abs(dir[0]) < 0.9 ? vcross(dir, [1, 0, 0]) : vcross(dir, [0, 1, 0]));
          const drill = keep(revolution(sc.add(makePolygon(prof.map(([r, z]) => vadd(vadd(c, vsc(e, r)), vsc(dir, z))))), c, dir, 360));
          const tbox = boxOf(drill);
          const targets = bodies.filter((b) => b.shape && boxesTouch(boxOf(b.shape), tbox));
          targets.forEach((b) => { const out = bool('cut', b, drill); b.tags = retag(out, b.tags, null, () => st.id + ':h' + k, sc); b.shape = out; });
          if (targets.length) drilled++;
        });
        if (gone === st.at.length) { res.error = true; res.note = 'its hole points are gone'; }
        else if (gone) { res.error = true; res.note = `${gone} of its hole points are gone`; }
        else if (!drilled) { res.error = true; res.note = 'nothing to cut'; }
      } else if (st.kind === 'fillet') {
        if (!(st.r > 0)) { res.error = true; res.note = 'its size is 0'; continue; }
        let bad = 0;
        const byBody = new Map<string, number[]>();
        st.edges.forEach((ref, k) => { if (!byBody.has(ref.bodyId)) byBody.set(ref.bodyId, []); byBody.get(ref.bodyId)!.push(k); });
        byBody.forEach((ks, bid) => {
          const b = bodies.find((x) => x.id === bid);
          if (!b || !b.shape) { bad += ks.length; return; }
          const { infos } = edgeInfos(b.shape, sc);
          const picked = new Map<number, number>(); // edge id → index in the feature's edge list
          ks.forEach((k) => { const e = matchEdge(infos, st.edges[k]); if (e) picked.set(e.id, k); else bad++; });
          if (!picked.size) return;
          const sizeOf = (e: Edge): number | null => (picked.has(e.hashCode) ? st.r : null);
          let out: Shape3D;
          try { out = keep(st.mode === 'chamfer' ? b.shape.chamfer(sizeOf) : b.shape.fillet(sizeOf)); }
          catch { res.error = true; res.note = `${st.mode === 'chamfer' ? 'that distance' : 'that radius'} is too big for ${picked.size > 1 ? 'these edges' : 'this edge'}`; return; }
          if (!(measureVolume(out) > 1e-9)) { res.error = true; res.note = 'that size is too big for this body'; return; }
          // each new face belongs to the picked edge it sits closest to
          const mids = [...picked.entries()].map(([id, k]) => ({ k, v: sc.add(makeVertex(infos.find((i) => i.id === id)!.mid)) }));
          const fresh = (f: Face): string => { let bk = mids[0].k, bd = Infinity; mids.forEach((m) => { const d = measureDistanceBetween(m.v, f); if (d < bd) { bd = d; bk = m.k; } }); return `F:${st.id}:${bk}`; };
          b.tags = retag(out, b.tags, null, fresh, sc);
          b.shape = out;
        });
        if (bad && !res.error) { res.error = true; res.note = bad === st.edges.length ? 'its edges are gone' : `${bad} of its edges are gone`; }
      }
    } catch (e) {
      res.error = true;
      res.note = errText(e);
    }
  }

  return { bodies: bodies.filter((b) => b.shape), results };
}

/** Rebuild every body for display and picking. */
export function buildModel(steps: BuildStep[]): BuildResult {
  const sc = new Scope();
  try {
    const { bodies, results } = runSteps(steps, sc);
    return { bodies: bodies.map((b) => bodyResult(b, sc)), steps: results };
  } finally {
    sc.end();
  }
}

/** Triangles for print files, cut as finely as asked. Only the listed bodies, or all of them. */
export function exportMeshes(steps: BuildStep[], quality: { tolerance: number; angularTolerance: number }, ids: string[] | null): { id: string; positions: Float32Array; indices: Uint32Array; volume: number }[] {
  const sc = new Scope();
  try {
    return runSteps(steps, sc).bodies.filter((b) => !ids || ids.includes(b.id)).map((b) => {
      const m = b.shape!.mesh(quality);
      return { id: b.id, positions: new Float32Array(m.vertices), indices: new Uint32Array(m.triangles), volume: measureVolume(b.shape!) };
    });
  } finally {
    sc.end();
  }
}

/** A STEP file (exact geometry, for other CAD programs) of the listed bodies. */
export async function exportStep(steps: BuildStep[], names: { id: string; name: string }[]): Promise<Uint8Array> {
  const sc = new Scope();
  try {
    const built = runSteps(steps, sc).bodies;
    const shapes = names.flatMap((n) => { const b = built.find((x) => x.id === n.id); return b ? [{ shape: b.shape!, name: n.name }] : []; });
    const blob = exportSTEP(shapes, { unit: 'MM', modelUnit: 'MM' });
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    sc.end();
  }
}

