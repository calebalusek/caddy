// Ready-made hole sizes for 3D-printed parts: screw clearance holes (with counterbore or countersink),
// pockets for heat-set threaded inserts and pockets for round magnets. All lengths in millimeters.
// Printed holes come out a little small, so these are the "normal fit" sizes people print with.

export const PRESET_KINDS = ['Custom', 'Screw', 'Counterbored screw', 'Countersunk screw', 'Heat-set insert', 'Magnet'] as const;
export type PresetKind = (typeof PRESET_KINDS)[number];
/** Screw size (M3 …) or, for a magnet, its diameter in mm. */
export const PRESET_SIZES = ['2', '3', '4', '5', '6', '8', '10'] as const;

/** Screw clearance hole, normal fit (ISO 273 medium). */
const CLEAR: Record<string, number> = { '2': 2.4, '3': 3.4, '4': 4.5, '5': 5.5, '6': 6.6, '8': 9, '10': 11 };
/** Socket-head screw head diameter (ISO 4762). */
const HEAD: Record<string, number> = { '2': 3.8, '3': 5.5, '4': 7, '5': 8.5, '6': 10, '8': 13, '10': 16 };
/** Heat-set insert pocket: diameter and depth (typical short inserts; check the datasheet of your insert). */
const INSERT: Record<string, [number, number]> = { '2': [3.2, 4], '3': [4.2, 6], '4': [5.6, 8], '5': [6.4, 9.5], '6': [8, 12], '8': [10, 14], '10': [12, 16] };

export interface HoleFill { d: number; extent: 'Through all' | 'Distance'; depth: number; type: 'Simple' | 'Counterbore' | 'Countersink'; cbD: number; cbDepth: number; csD: number; text: string }

const r1 = (v: number): number => Math.round(v * 10) / 10;

/** The values a preset fills into the Hole menu, or null for Custom. */
export function holePreset(kind: PresetKind | undefined, size: string | undefined): HoleFill | null {
  const s = size && size in CLEAR ? size : '3', n = +s;
  const none = { cbD: 0, cbDepth: 0, csD: 0 };
  switch (kind) {
    case 'Screw': return { d: CLEAR[s], extent: 'Through all', depth: 0, type: 'Simple', ...none, text: `M${s} screw: Ø${CLEAR[s]} clearance hole` };
    case 'Counterbored screw': return { d: CLEAR[s], extent: 'Through all', depth: 0, type: 'Counterbore', cbD: r1(HEAD[s] + 0.5), cbDepth: r1(n + 0.4), csD: 0, text: `M${s} socket head: Ø${CLEAR[s]} hole, Ø${r1(HEAD[s] + 0.5)} counterbore` };
    case 'Countersunk screw': return { d: CLEAR[s], extent: 'Through all', depth: 0, type: 'Countersink', cbD: 0, cbDepth: 0, csD: r1(2.24 * n + 0.4), text: `M${s} flat head: Ø${CLEAR[s]} hole, Ø${r1(2.24 * n + 0.4)} countersink` };
    case 'Heat-set insert': { const [d, depth] = INSERT[s]; return { d, extent: 'Distance', depth, type: 'Simple', ...none, text: `M${s} heat-set insert: Ø${d} pocket, ${depth} deep. Check your insert's datasheet.` }; }
    case 'Magnet': return { d: r1(n + 0.2), extent: 'Distance', depth: 3.2, type: 'Simple', ...none, text: `Ø${n} magnet: Ø${r1(n + 0.2)} pocket, 3.2 deep (for a 3 mm magnet)` };
    default: return null;
  }
}
