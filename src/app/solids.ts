// Rebuilding the bodies from the timeline. The kernel runs in a Web Worker, so this is asynchronous:
// the UI stays responsive and the bodies update when the result arrives.
import { Kernel } from '../kernel/client';
import type { BodyResult, BuildResult, BuildStep, EdgeRef, FaceSpec } from '../kernel/protocol';
import { extrudeRange, profileSpec } from '../kernel/spec';
import type { Feature, SketchFeature } from '../model/types';
import { profileHint } from '../sketch/geom';
import { inProfile, type Profile } from '../sketch/profiles';
import { clearBodyHighlights, showBodies } from '../view/bodies';
import { emit } from './hub';
import { featById, state } from './state';

export const kernel = new Kernel();

/** Which rebuild step brings back a feature type that is not rebuilt yet. */
const LATER: Record<string, number> = { revolve: 5, hole: 5, sweep: 6, shell: 7, pattern: 7 };

export interface ProfileParams { sketchId?: string | null; key?: string | null; hint?: { pts: [number, number][]; area: number }; face?: FaceSpec | null }

/** The sketch region a feature uses. Remembers where it was, so it is found again after the sketch is edited. */
export function findProfile(sel: ProfileParams | null | undefined): { sk: SketchFeature; pr: Profile } | null {
  if (!sel || !sel.sketchId) return null;
  const sk = featById(sel.sketchId);
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

function stepFor(f: Feature): BuildStep | null {
  if (f.type === 'extrude') {
    const P = f.params as any;
    const range = extrudeRange(+P.distance || 0, P.direction, +P.offset || 0);
    if (P.face) return { kind: 'extrude', id: f.id, profile: null, face: P.face, ...range, operation: P.operation, bodyId: f.bodyId || null };
    const r = findProfile(P);
    if (r) { if (r.pr.key !== P.key) P.key = r.pr.key; P.hint = profileHint(r.pr); }
    return { kind: 'extrude', id: f.id, profile: r ? profileSpec(r.sk.frame!, r.pr) : null, face: null, ...range, operation: P.operation, bodyId: f.bodyId || null };
  }
  if (f.type === 'fillet') {
    const P = f.params as any;
    return { kind: 'fillet', id: f.id, mode: P.kind === 'chamfer' ? 'chamfer' : 'fillet', r: +P.r || 0, edges: (P.edges || []) as EdgeRef[] };
  }
  return null;
}

let seq = 0;
let shown: BuildResult = { bodies: [], steps: [] };
let base: BuildResult = shown;
let pending: Promise<void> = Promise.resolve();
let busy = 0;

/** Resolves when the bodies on screen match the timeline. */
export const whenBuilt = (): Promise<void> => pending;
export const isBuilding = (): boolean => busy > 0;
/** The bodies as shown (including the live preview of the tool being used). */
export const shownBodies = (): BodyResult[] => shown.bodies;
/** The bodies before the tool being used: what its picks (edges, faces) refer to. */
export const baseBodies = (): BodyResult[] => base.bodies;
export const baseBody = (id: string): BodyResult | undefined => base.bodies.find((b) => b.id === id);

/** Bring the bodies up to date with the timeline (and the open tool's live preview, if it has one). */
export function rebuildSolids(): Promise<void> {
  const my = ++seq;
  const A = state.active;
  // editing a feature rolls the timeline back to just before it, like the History marker in other CAD apps
  const upTo = A && A.edit ? state.features.indexOf(A.edit) : state.features.length;
  const feats = state.features.slice(0, upTo < 0 ? state.features.length : upTo);
  const steps: BuildStep[] = [];
  feats.forEach((f) => {
    if (f.type === 'plane' || f.type === 'sketch') return;
    const st = stepFor(f);
    if (st) steps.push(st);
    else { f.error = true; f.note = `${f.type} features arrive in step ${LATER[f.type] || '?'} of the rebuild`; }
  });
  const draft = A && A.def.draftStep ? A.def.draftStep(A) : null;
  busy++;
  emit('doc');
  const run = async (): Promise<void> => {
    try {
      const baseRes = await kernel.call('build', steps);
      const draftRes = draft ? await kernel.call('build', steps.concat([draft])) : null;
      if (my !== seq) return; // a newer rebuild is on its way
      base = baseRes;
      shown = draftRes || baseRes;
      baseRes.steps.forEach((s) => { const f = featById(s.id); if (f) { f.error = !!s.error; f.note = s.note || ''; } });
      if (A && state.active === A) A.note = draftRes ? draftRes.steps[draftRes.steps.length - 1].note || '' : '';
      state.selection = state.selection.filter((s) => s.kind === 'plane'); // face and edge ids are new after a rebuild
      clearBodyHighlights();
      showBodies(shown.bodies);
      emit('doc', 'select', 'built');
    } catch (err) {
      if (my === seq) console.error('Rebuild failed', err);
    } finally {
      busy--;
      if (!busy) emit('doc');
    }
  };
  pending = run();
  return pending;
}

/** What a build step reported for a feature (the tool's own bounding box, for picking the body to join). */
export const stepResult = (id: string): BuildResult['steps'][number] | undefined => base.steps.find((s) => s.id === id);
