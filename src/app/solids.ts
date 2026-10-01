// Rebuilding the bodies from the timeline. The kernel runs in a Web Worker, so this is asynchronous:
// the UI stays responsive and the bodies update when the result arrives.
import { Kernel } from '../kernel/client';
import type { BodyResult, BuildResult, BuildStep } from '../kernel/protocol';
import { featureSteps, findProfileIn, type ProfileParams } from '../model/steps';
import { clearBodyHighlights, showBodies } from '../view/bodies';
import { emit } from './hub';
import { featById, state } from './state';

export const kernel = new Kernel();

export type { ProfileParams };
/** The sketch region a feature uses (see model/steps.ts). */
export const findProfile = (sel: ProfileParams | null | undefined): ReturnType<typeof findProfileIn> => findProfileIn(state.features, sel);

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
  const steps: BuildStep[] = featureSteps(state.features, upTo < 0 ? state.features.length : upTo);
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
