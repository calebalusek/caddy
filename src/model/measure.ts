// Measuring: lengths of edges, and what a part weighs. Plain maths, no DOM.
import type { EdgeInfo } from '../kernel/protocol';
import { vsub, vlen } from './frames';
import type { Vec3 } from './types';

/** Filament and resin densities in g/cm³ (typical values; brands differ by a few percent). */
export const MATERIALS: Record<string, number> = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, Nylon: 1.14 };

/** Weight in grams of `volume` mm³ at a material's density, scaled by the infill percentage. */
export const weightGrams = (volume: number, material: string, infillPct: number): number => (volume / 1000) * (MATERIALS[material] ?? MATERIALS.PLA) * (Math.max(0, infillPct) / 100);

export interface EdgeSize { length: number; kind: 'line' | 'circle' | 'arc'; diameter?: number; radius?: number }

/** The size of a body edge: a straight edge, a full circle (circumference and diameter) or an arc. null for other curves. */
export function edgeSize(e: EdgeInfo): EdgeSize | null {
  if (e.kind === 'line') return { length: vlen(vsub(e.b as Vec3, e.a as Vec3)), kind: 'line' };
  if (e.kind !== 'round' || !e.R) return null;
  if (e.closed) return { length: 2 * Math.PI * e.R, kind: 'circle', diameter: 2 * e.R, radius: e.R };
  const chord = vlen(vsub(e.b as Vec3, e.a as Vec3)), cm: Vec3 = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2];
  const sag = vlen(vsub(e.mid as Vec3, cm)), minor = Math.asin(Math.min(1, chord / (2 * e.R))) * 2;
  // the middle of an arc more than a half circle lies farther from the chord than the radius
  return { length: e.R * (sag > e.R + 1e-9 ? 2 * Math.PI - minor : minor), kind: 'arc', radius: e.R };
}
