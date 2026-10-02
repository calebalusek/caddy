// Shared by the tools that work on whole bodies (Combine, Move/Rotate/Scale, Split, Offset body):
// clicking a body in the view or the Browser picks it, clicking it again lets it go, picked bodies show bold blue.
import { emit } from '../app/hub';
import { baseBodies, whenBuilt } from '../app/solids';
import { bodyById, state } from '../app/state';
import type { OtherFeature } from '../model/types';
import { message } from '../ui/message';
import { setHoverFace, setSelectedFaces } from '../view/bodies';
import { faceAtCursor } from '../view/hit';

/** Show these bodies as selected (every face bold blue). */
export function drawBodies(ids: string[]): void {
  const faces: { bodyId: string; faceId: number }[] = [];
  baseBodies().forEach((b) => { if (ids.includes(b.id)) b.faces.forEach((f) => faces.push({ bodyId: b.id, faceId: f.id })); });
  setSelectedFaces(faces);
}

/** Orange on the body under the cursor. Returns true when there is one. */
export function hoverBody(): boolean {
  const fh = faceAtCursor();
  if (fh) { setHoverFace(fh.bodyId, fh.face.id); return true; }
  setHoverFace(null);
  return false;
}

export const toggle = (list: string[], id: string): void => { const i = list.indexOf(id); if (i >= 0) list.splice(i, 1); else list.push(id); };

/** "Body1, Body2" or a few words saying what is missing. */
export const bodyNames = (ids: string[]): string => ids.map((id) => bodyById(id)?.name || 'a body').join(', ');

/** The body ids for a tool that makes new bodies: add or take away slots so the feature has exactly `need`. */
export function syncSlots(f: OtherFeature, need: number): void {
  const ids = f.bodyIds || (f.bodyIds = []);
  while (ids.length < need) { const bn = ++state.counters.body; state.bodies.push({ id: 'b' + bn, name: 'Body' + bn, visible: true }); ids.push('b' + bn); }
  while (ids.length > need) { const gone = ids.pop()!; state.bodies = state.bodies.filter((b) => b.id !== gone); }
}

/** After OK: say if the kernel did not like it. */
export function reportLater(f: { name: string; error?: unknown; note?: string }): void {
  setTimeout(() => void whenBuilt().then(() => { if (f.error) { message(`${f.name} needs attention: ${f.note}`, 'warn'); emit('doc'); } }), 0);
}
