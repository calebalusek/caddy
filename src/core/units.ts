// Units. The model is always in millimeters (files, the kernel, exports). The unit choice only changes
// what the user sees and types: lengths shown and entered in inches are converted at the edge.
import { fmt } from './format';

export type Unit = 'mm' | 'in';
export const MM_PER_IN = 25.4;

let unit: Unit = 'mm';
export const getUnit = (): Unit => unit;
export const setUnitValue = (u: Unit): void => { unit = u; };
export const unitName = (): string => unit;

/** A length in mm → the number in the chosen unit. */
export const toUser = (mm: number): number => (unit === 'in' ? mm / MM_PER_IN : mm);
/** A length the user typed (in the chosen unit) → mm. */
export const fromUser = (v: number): number => (unit === 'in' ? v * MM_PER_IN : v);
/** Digits for a length: two decimals in mm, three in inches, no trailing zeros. */
export const fmtLen = (mm: number): string => (unit === 'in' ? String(Math.round((mm / MM_PER_IN) * 1000) / 1000) : fmt(mm));
/** A length with its unit: "12.5 mm" or "0.492 in". */
export const fmtU = (mm: number): string => fmtLen(mm) + ' ' + unit;
/** An area (mm²) in the chosen unit. */
export const fmtArea = (mm2: number): string => (unit === 'in' ? String(Math.round((mm2 / (MM_PER_IN * MM_PER_IN)) * 1000) / 1000) + ' in²' : fmt(mm2) + ' mm²');

/** The base grid: spacing of the thin and the heavy lines, and how far it reaches, in mm. */
export function gridSizes(u: Unit = unit): { minor: number; major: number; extent: number } {
  return u === 'in' ? { minor: 0.5 * MM_PER_IN, major: 2.5 * MM_PER_IN, extent: 7.5 * MM_PER_IN } : { minor: 10, major: 50, extent: 150 };
}
/** Drag-arrow steps in the chosen unit: smooth by default, Shift = coarse, Alt = fine. */
export function dragStep(shift: boolean, alt: boolean): number {
  return unit === 'in' ? (shift ? 0.1 : alt ? 0.001 : 0.005) : shift ? 1 : alt ? 0.01 : 0.1;
}
