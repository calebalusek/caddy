// From the timeline to what the kernel builds: resolving planes and sketch regions, and turning
// each solid feature into a build step. No DOM, no three.js: runs in the app and in Node tests.
import type { BuildStep, EdgeRef, FaceSpec, HoleSpot } from '../kernel/protocol';
import { extrudeRange, profileSpec } from '../kernel/spec';
import { profileHint } from '../sketch/geom';
import { inProfile, sketchProfiles, type Profile } from '../sketch/profiles';
import { PT } from '../sketch/model';
import { sweepPath } from './path';
import type { PatternParams } from './pattern';

const DEFAULT_PATTERN: PatternParams = {
  ptype: 'Rectangular', what: 'Features', feats: [], bodies: [], layout: 'Spacing', dir1: 'X', n1: 2, d1: 0, dir2: 'None', n2: 2, d2: 0, v1: null, v2: null, e1: null, e2: null,
  cols: 2, rows: 2, gaps: 'Equal', m1: 0, m2: 0, axis: 'Z', axC: null, axD: null, radius: 0, count: 4, angle: 360,
};
import { ORIGIN, offsetFrame, toWorld, vnorm, vsc, vsub } from './frames';
import type { Feature, Frame, PlaneRef, SketchFeature, Vec3 } from './types';

/** The frame a plane reference points at right now; null if what it refers to is gone or broken. */
export function resolveRefIn(features: Feature[], ref: PlaneRef | null | undefined): Frame | null {
  if (!ref) return null;
  if (ref.kind === 'origin') return ORIGIN[ref.id];
  if (ref.kind === 'plane') {
    const id = ref.id, p = features.find((f) => f.id === id);
    return p && p.type === 'plane' && p.frame && !p.error ? p.frame : null;
  }
  return ref.frame;
}

/** Walk the timeline in order and place every plane and sketch. */
export function resolveFrames(features: Feature[]): void {
  for (const f of features) {
    f.error = false;
    f.note = '';
    if (f.type === 'plane') {
      const base = resolveRefIn(features, f.params.ref);
      if (!base) { f.error = true; f.note = 'its reference plane is gone'; f.frame = null; continue; }
      f.frame = offsetFrame(base, f.params.distance);
    } else if (f.type === 'sketch') {
      f.frame = resolveRefIn(features, f.params.ref);
      if (!f.frame) { f.error = true; f.note = 'its plane is gone'; }
    }
  }
}

/** Work out every sketch's regions (the app does this while drawing the sketch; tests call it directly). */
export function computeProfiles(features: Feature[]): void {
  features.forEach((f) => { if (f.type === 'sketch') f.profiles = f.frame ? sketchProfiles(f) : []; });
}

export interface ProfileParams { sketchId?: string | null; key?: string | null; hint?: { pts: [number, number][]; area: number }; face?: FaceSpec | null }

/** The sketch region a feature uses. Remembers where it was, so it is found again after the sketch is edited. */
export function findProfileIn(features: Feature[], sel: ProfileParams | null | undefined): { sk: SketchFeature; pr: Profile } | null {
  if (!sel || !sel.sketchId) return null;
  const id = sel.sketchId, sk = features.find((f) => f.id === id);
  if (!sk || sk.type !== 'sketch' || sk.error || !sk.profiles || !sk.frame) return null;
  const hint = sel.hint && sel.hint.pts && sel.hint.pts.length ? sel.hint : null;
  const score = (p: Profile): number => (hint ? hint.pts.filter((q) => inProfile(q, p)).length : 0);
  let pr = sk.profiles.find((p) => p.key === sel.key);
  if (hint && (!pr || score(pr) === 0)) {
    // the sketch changed: take the region that best overlaps where this profile used to be
    let best: Profile | null = null, bs = 0;
    sk.profiles.forEach((p) => {
      const s = score(p);
      if (s > bs || (s === bs && s > 0 && best && Math.abs(p.area - hint.area) < Math.abs(best.area - hint.area))) { bs = s; best = p; }
    });
    if (best) pr = best;
  }
  return pr ? { sk, pr } : null;
}

/** Which rebuild step brings back a feature type that is not rebuilt yet. */
export const LATER: Record<string, number> = {};

/** How a revolve's axis is saved (same as version 1 files). */
export type AxisRef = { kind: 'origin'; id: 'X' | 'Y' | 'Z' } | { kind: 'line'; sketchId: string; lineId: string } | { kind: 'edge'; bodyId: string; a: Vec3; b: Vec3 };
/** The axis in space, with a name for messages. Null if what it pointed at is gone. */
export function axisWorld(features: Feature[], bodyName: (id: string) => string, ax: AxisRef | null | undefined): { A: Vec3; d: Vec3; name: string } | null {
  if (!ax) return null;
  if (ax.kind === 'origin') return { A: [0, 0, 0], d: ax.id === 'X' ? [1, 0, 0] : ax.id === 'Y' ? [0, 1, 0] : [0, 0, 1], name: ax.id + ' axis' };
  if (ax.kind === 'line') {
    const sk = features.find((f) => f.id === ax.sketchId);
    if (!sk || sk.type !== 'sketch' || !sk.frame) return null;
    const l = sk.curves.find((c) => c.id === ax.lineId);
    if (!l || l.type !== 'line') return null;
    const a = toWorld(sk.frame, ...PT(sk, l.p1)), b = toWorld(sk.frame, ...PT(sk, l.p2)), ab = vsub(b, a);
    if (Math.hypot(ab[0], ab[1], ab[2]) < 1e-6) return null;
    return { A: a, d: vnorm(ab), name: 'a line in ' + sk.name };
  }
  return { A: ax.a, d: vnorm(vsub(ax.b, ax.a)), name: 'an edge of ' + bodyName(ax.bodyId) };
}

/** How a hole's position is saved (same as version 1 files). */
export type HoleRef = { kind: 'spt'; sketchId: string; pointId: string } | ({ kind: 'face' } & FaceSpec);
/** Where a hole is: on a sketch point (drilling into the sketch plane) or on a body face. */
export function holeSpot(features: Feature[], ref: HoleRef): HoleSpot | null {
  if (ref.kind === 'face') return { face: { bodyId: ref.bodyId, n: ref.n, w: ref.w, p: ref.p, surf: ref.surf } };
  const sk = features.find((f) => f.id === ref.sketchId);
  if (!sk || sk.type !== 'sketch' || !sk.frame || !sk.pts[ref.pointId]) return null;
  return { c: toWorld(sk.frame, sk.pts[ref.pointId].x, sk.pts[ref.pointId].y), dir: vsc(sk.frame.n, -1) };
}

/** The kernel build step for one feature; null if its tool is not rebuilt yet. */
export function stepFor(features: Feature[], f: Feature): BuildStep | null {
  if (f.type === 'extrude') {
    const P = f.params as any;
    const range = extrudeRange(+P.distance || 0, P.direction, +P.offset || 0);
    if (P.face) return { kind: 'extrude', id: f.id, profile: null, face: P.face, ...range, operation: P.operation, bodyId: f.bodyId || null };
    const r = findProfileIn(features, P);
    if (r) { if (r.pr.key !== P.key) P.key = r.pr.key; P.hint = profileHint(r.pr); }
    return { kind: 'extrude', id: f.id, profile: r ? profileSpec(r.sk.frame!, r.pr) : null, face: null, ...range, operation: P.operation, bodyId: f.bodyId || null };
  }
  if (f.type === 'revolve') {
    const P = f.params as any, r = findProfileIn(features, P);
    if (r) { if (r.pr.key !== P.key) P.key = r.pr.key; P.hint = profileHint(r.pr); }
    const ax = axisWorld(features, () => 'a body', P.axis), ang = Math.abs(+P.angle || 0);
    return { kind: 'revolve', id: f.id, profile: r ? profileSpec(r.sk.frame!, r.pr) : null, axis: ax ? { A: ax.A, d: ax.d } : null, ang0: P.direction === 'Symmetric' ? -ang / 2 : (+P.angle || 0) < 0 ? -ang : 0, angle: ang, operation: P.operation, bodyId: f.bodyId || null };
  }
  if (f.type === 'sweep') {
    const P = f.params as any;
    let profile = null;
    if (!P.face) {
      const r = findProfileIn(features, P);
      if (r) { if (r.pr.key !== P.key) P.key = r.pr.key; P.hint = profileHint(r.pr); profile = profileSpec(r.sk.frame!, r.pr); }
    }
    const path = sweepPath(features, P.path);
    return { kind: 'sweep', id: f.id, profile, face: P.face || null, path: path.path || null, pathNote: path.err, orientation: P.orientation === 'Parallel' ? 'Parallel' : 'Perpendicular', corners: P.corners === 'Mitered' ? 'Mitered' : 'Round', operation: P.operation, bodyId: f.bodyId || null };
  }
  if (f.type === 'thread') {
    const P = f.params as any;
    return P.face ? { kind: 'thread', id: f.id, face: P.face, pitch: P.size === 'Custom' ? +P.pitch || 0 : 0, depth: +P.depth || 0, length: +P.length || 0, hand: P.hand === 'Left' ? 'Left' : 'Right' } : null;
  }
  if (f.type === 'text') {
    const P = f.params as any, fr = resolveRefIn(features, P.ref);
    // text on a flat face goes where the user clicked (the middle of that face's frame); on a plane, at its origin
    const base: [number, number] = P.ref && P.ref.kind === 'face' && fr ? [(fr.ext[0] + fr.ext[1]) / 2, (fr.ext[2] + fr.ext[3]) / 2] : [0, 0];
    return { kind: 'text', id: f.id, text: String(P.text ?? ''), font: String(P.font || 'Barlow Bold'), size: +P.size || 0, height: +P.height || 0, frame: fr, anchor: [base[0] + (+P.x || 0), base[1] + (+P.y || 0)], angle: +P.angle || 0, operation: P.operation || 'New body', bodyId: f.bodyId || null };
  }
  if (f.type === 'mirror') {
    const P = f.params as any, fr = resolveRefIn(features, P.ref);
    return { kind: 'mirror', id: f.id, bodies: P.bodies || [], plane: fr ? { o: fr.o, n: fr.n } : null, operation: P.operation === 'Join' ? 'Join' : 'New body', bodyIds: (f.bodyIds as string[]) || [] };
  }
  if (f.type === 'pattern') {
    const P = f.params as any;
    return { kind: 'pattern', id: f.id, params: { ...DEFAULT_PATTERN, ...P, feats: P.feats || [], bodies: P.bodies || [] }, bodyIds: (f.bodyIds as string[]) || [] };
  }
  if (f.type === 'shell') {
    const P = f.params as any, bodyId = (P.bodyId || f.bodyId || null) as string | null;
    return { kind: 'shell', id: f.id, bodyId, faces: ((P.faces || []) as any[]).map((s) => ({ bodyId: bodyId || '', surf: s.surf, n: s.n, w: s.w, p: s.p })), thickness: +P.thickness || 0, direction: P.direction === 'Outside' ? 'Outside' : 'Inside' };
  }
  if (f.type === 'hole') {
    const P = f.params as any;
    return { kind: 'hole', id: f.id, at: ((P.pts || []) as HoleRef[]).map((ref) => holeSpot(features, ref)), d: +P.d || 0, through: P.extent !== 'Distance', depth: +P.depth || 0, type: P.type || 'Simple', cbD: +P.cbD || 0, cbDepth: +P.cbDepth || 0, csD: +P.csD || 0 };
  }
  if (f.type === 'fillet') {
    const P = f.params as any;
    return { kind: 'fillet', id: f.id, mode: P.kind === 'chamfer' ? 'chamfer' : 'fillet', r: +P.r || 0, edges: (P.edges || []) as EdgeRef[] };
  }
  return null;
}

/** Build steps for a run of the timeline. Features whose tools are not rebuilt yet are flagged, not built. */
export function featureSteps(all: Feature[], upTo = all.length): BuildStep[] {
  const steps: BuildStep[] = [];
  all.slice(0, upTo).forEach((f) => {
    if (f.type === 'plane' || f.type === 'sketch') return;
    const st = stepFor(all, f);
    if (st) steps.push(st);
    else { f.error = true; f.note = `${f.type} features arrive in step ${LATER[f.type] || '?'} of the rebuild`; }
  });
  return steps;
}
