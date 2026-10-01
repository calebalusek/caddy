// From the timeline to what the kernel builds: resolving planes and sketch regions, and turning
// each solid feature into a build step. No DOM, no three.js: runs in the app and in Node tests.
import type { BuildStep, EdgeRef, FaceSpec } from '../kernel/protocol';
import { extrudeRange, profileSpec } from '../kernel/spec';
import { profileHint } from '../sketch/geom';
import { inProfile, sketchProfiles, type Profile } from '../sketch/profiles';
import { ORIGIN, offsetFrame } from './frames';
import type { Feature, Frame, PlaneRef, SketchFeature } from './types';

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
export const LATER: Record<string, number> = { revolve: 5, hole: 5, sweep: 6, shell: 7, pattern: 7 };

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
