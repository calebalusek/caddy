// Rebuilding the bodies from the timeline. The kernel runs in a Web Worker, so this is asynchronous:
// the UI stays responsive and the bodies update when the result arrives.
import { Kernel } from '../kernel/client';
import type { BodyResult, BuildResult, BuildStep, DraftResult, PreviewBody } from '../kernel/protocol';
import { featureSteps, findProfileIn, type ProfileParams } from '../model/steps';
import { clearBodyHighlights, setDiffPreview, showBodies } from '../view/bodies';
import { emit } from './hub';
import { featById, state } from './state';

export const kernel = new Kernel();

export type { ProfileParams };
/** The sketch region a feature uses (see model/steps.ts). */
export const findProfile = (sel: ProfileParams | null | undefined): ReturnType<typeof findProfileIn> => findProfileIn(state.features, sel);

let shown: BuildResult = { bodies: [], steps: [] };
let base: BuildResult = shown;
let draftShown: PreviewBody[] | null = null;
let pending: Promise<void> = Promise.resolve();
let busy = 0;

/** Resolves when the bodies on screen match the timeline. */
export const whenBuilt = (): Promise<void> => pending;
export const isBuilding = (): boolean => busy > 0;
/** The bodies on screen: always the model as it is; a tool's live preview is drawn over it (red = removed, blue = added). */
export const shownBodies = (): BodyResult[] => shown.bodies;
/** The model with the open tool's preview applied (what OK would make). */
export const previewBodies = (): PreviewBody[] => draftShown || shown.bodies;
/** The bodies before the tool being used: what its picks (edges, faces) refer to. */
export const baseBodies = (): BodyResult[] => base.bodies;
export const baseBody = (id: string): BodyResult | undefined => base.bodies.find((b) => b.id === id);

let running = false, again = false;
/** The model the geometry engine last sent, and the key it is kept under there (so a preview does not resend it). */
let held: { key: string; res: BuildResult } | null = null;

/**
 * Bring the bodies up to date with the timeline (and the open tool's live preview, if it has one).
 * Only one build runs at a time: if the model changes again meanwhile (dragging an arrow), the
 * old result is dropped and just the newest state is built next, so the preview never falls behind.
 */
export function rebuildSolids(): Promise<void> {
  if (running) { again = true; return pending; }
  running = true;
  pending = (async (): Promise<void> => {
    try {
      do { again = false; await buildOnce(); } while (again);
    } finally { running = false; }
  })();
  return pending;
}

async function buildOnce(): Promise<void> {
  const A = state.active;
  // editing a feature rolls the timeline back to just before it, like the History marker in other CAD apps
  const upTo = A && A.edit ? state.features.indexOf(A.edit) : state.features.length;
  const steps: BuildStep[] = featureSteps(state.features, upTo < 0 ? state.features.length : upTo);
  const draft = A && A.def.draftStep ? A.def.draftStep(A) : null;
  busy++;
  if (!draft && !(A && A.def.draftStep)) emit('doc'); // a live preview changes nothing in the document: no need to redraw the Browser
  try {
    let baseRes: BuildResult, out: DraftResult | null = null;
    if (draft || (A && A.def.draftStep)) {
      out = await kernel.call('buildDraft', steps, draft, held ? held.key : null);
      if (out.base) held = { key: out.baseKey, res: out.base };
      baseRes = held!.res;
    } else { baseRes = await kernel.call('build', steps); held = null; }
    if (again) return; // the model changed while this was building: skip showing it
    const sameBase = baseRes === base;
    base = baseRes;
    shown = baseRes;
    draftShown = out && draft ? out.draft.bodies : null;
    baseRes.steps.forEach((s) => { const f = featById(s.id); if (f) { f.error = !!s.error; f.note = s.note || ''; } });
    if (A && state.active === A) A.note = out && draft ? out.draft.step.note || '' : '';
    if (!sameBase) {
      state.selection = state.selection.filter((s) => s.kind === 'plane'); // face and edge ids are new after a rebuild
      clearBodyHighlights();
      showBodies(shown.bodies);
    }
    setDiffPreview(out ? out.removed : [], out ? out.added : []);
    if (!out || !sameBase) emit('doc', 'select', 'built'); else emit('built');
  } catch (err) {
    console.error('Rebuild failed', err);
  } finally {
    busy--;
    if (!busy && !draft && !(A && A.def.draftStep)) emit('doc');
  }
}

/** What a build step reported for a feature (the tool's own bounding box, for picking the body to join). */
export const stepResult = (id: string): BuildResult['steps'][number] | undefined => base.steps.find((s) => s.id === id);
