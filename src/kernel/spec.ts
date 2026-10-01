// Turning document features into the plain "build steps" the kernel understands.
import type { Frame } from '../model/types';
import type { Loop, Profile } from '../sketch/profiles';
import type { LoopSpec, ProfileSpec } from './protocol';

const loopSpec = (L: Loop): LoopSpec => (L.kind === 'circle' ? { circle: { c: L.c!, r: L.r! } } : { edges: L.edges });

/** A sketch region with its exact boundary, ready for the kernel. */
export const profileSpec = (frame: Frame, pr: Profile): ProfileSpec => ({ frame, outer: loopSpec(pr.loop), holes: pr.holes.map(loopSpec) });

/**
 * Where an extrude starts and how thick it is, from the dialog's values.
 * One side: from the sketch plane (plus offset) toward +distance (negative goes the other way).
 * Symmetric: |distance| to each side.
 */
export function extrudeRange(distance: number, direction: string, offset: number): { z0: number; depth: number } {
  if (direction === 'Symmetric') return { z0: offset - Math.abs(distance), depth: 2 * Math.abs(distance) };
  return distance >= 0 ? { z0: offset, depth: distance } : { z0: offset + distance, depth: -distance };
}
