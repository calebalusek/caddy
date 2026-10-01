// Builds every body from the timeline with the real kernel (exact B-rep: true planes, cylinders, arcs).
// Runs wherever the kernel is loaded: the Web Worker in the app, Node in tests.
import {
  assembleWire, basicFaceExtrusion, exportSTEP, makeCircle, makeFace, makeLine, makeThreePointArc, makeVertex, measureArea, measureDistanceBetween, measureVolume, Vector,
  type Edge, type Face, type Shape3D, type Wire,
} from 'replicad';
import { toWorld, vdot, vnorm, vsc, vsub } from '../model/frames';
import type { Frame, Vec3 } from '../model/types';
import type { P2 } from '../sketch/model';
import { arcDelta } from '../sketch/profiles';
import { matchEdge } from './match';
import type { BodyMesh, BodyResult, BuildResult, BuildStep, EdgeInfo, FaceInfo, LoopSpec, ProfileSpec, StepResult } from './protocol';

/** Display tessellation: chord error in mm and angle step in radians. */
export const DISPLAY_QUALITY = { tolerance: 0.02, angularTolerance: 0.2 };

interface Deletable { delete: () => void }
/** Kernel objects live in WebAssembly memory and must be freed by hand. */
class Scope {
  private items: Deletable[] = [];
  add<T extends Deletable>(o: T): T { this.items.push(o); return o; }
  all<T extends Deletable>(list: T[]): T[] { list.forEach((o) => this.items.push(o)); return list; }
  end(): void { this.items.forEach((o) => { try { o.delete(); } catch { /* already freed */ } }); this.items = []; }
}
const tup = (v: Vector): Vec3 => { const t = v.toTuple() as Vec3; v.delete(); return t; };
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

interface BodyState { id: string; shape: Shape3D | null; tags: Map<string, string> }

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
  const body = (id: string): BodyState => { let b = bodies.find((x) => x.id === id); if (!b) { b = { id, shape: null, tags: new Map() }; bodies.push(b); } return b; };
  const results: StepResult[] = [];
  const keep = <T extends Shape3D>(s: T): T => sc.add(s);

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
        const fresh = (): string => st.id + ':x';
        if (st.operation === 'Cut') {
          const targets = bodies.filter((b) => b.shape && boxesTouch(boxOf(b.shape), tbox));
          if (!targets.length) { res.error = true; res.note = 'nothing to cut'; continue; }
          targets.forEach((b) => { const out = keep(b.shape!.cut(tool)); b.tags = retag(out, b.tags, toolTags, fresh, sc); b.shape = out; });
        } else {
          if (!st.bodyId) { res.error = true; res.note = 'it has no body'; continue; }
          const b = body(st.bodyId);
          if (st.operation === 'Join' && b.shape) { const out = keep(b.shape.fuse(tool)); b.tags = retag(out, b.tags, toolTags, fresh, sc); b.shape = out; }
          else { b.shape = tool; b.tags = toolTags; }
        }
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

