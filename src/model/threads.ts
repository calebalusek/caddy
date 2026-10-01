// Screw threads: standard sizes and the 60° ISO profile, for external threads (on a shaft) and internal ones (in a hole).
// Pure maths, shared by the kernel and the menu.

/** ISO metric coarse threads: nominal (major) diameter → pitch, in mm. */
export const COARSE: [number, number][] = [[2, 0.4], [2.5, 0.45], [3, 0.5], [4, 0.7], [5, 0.8], [6, 1], [8, 1.25], [10, 1.5], [12, 1.75], [14, 2], [16, 2], [18, 2.5], [20, 2.5], [22, 2.5], [24, 3], [27, 3], [30, 3.5]];
/** The thread's working depth as a fraction of the pitch (5/8 of the sharp-V height). */
export const DEPTH_K = 0.5413;

/**
 * The standard coarse size nearest a cylinder. A shaft is the major diameter itself; a hole is the minor diameter
 * (the tap-drill size), so its nominal size is about 1.0825 pitches bigger.
 */
export function standardSize(diameter: number, internal: boolean): { nominal: number; pitch: number } {
  let best = COARSE[0], bd = Infinity;
  COARSE.forEach(([m, p]) => { const d = Math.abs(diameter - (internal ? m - 1.0825 * p : m)); if (d < bd) { bd = d; best = [m, p]; } });
  return { nominal: best[0], pitch: best[1] };
}

/** Width of the groove at the cylinder's surface and of the flat at its bottom (flanks 60° apart). */
function widths(pitch: number, depth: number, internal: boolean): { wide: number; root: number } {
  const wide = (internal ? 0.75 : 0.875) * pitch;
  return { wide, root: Math.max(0.04 * pitch, wide - 2 * depth * Math.tan(Math.PI / 6)) };
}

/**
 * The groove that cuts a thread: a trapezoid in the plane that holds the axis, as (distance from the axis, position
 * along it) pairs. `R` is the cylinder's radius. External: the groove sinks into the shaft from R; internal: it goes
 * out into the wall from R. It starts a little outside the surface so the cut is clean.
 */
export function grooveProfile(R: number, pitch: number, depth: number, internal: boolean): [number, number][] {
  const over = 0.05 * pitch, { wide, root } = widths(pitch, depth, internal);
  const sgn = internal ? -1 : 1; // the groove sinks toward the axis for a shaft, away from it for a hole
  const outer = R + sgn * over, inner = R - sgn * depth, wo = wide / 2 + over * Math.tan(Math.PI / 6), wi = root / 2;
  return [[outer, -wo], [outer, wo], [inner, wi], [inner, -wi]];
}
/** Area of the groove inside the material (the part that is really cut), and how far its middle is from the axis. */
export function grooveSection(R: number, pitch: number, depth: number, internal: boolean): { area: number; rho: number } {
  const { wide, root } = widths(pitch, depth, internal);
  const y = (depth * (wide + 2 * root)) / (3 * (wide + root)); // centroid, measured from the surface
  return { area: ((wide + root) / 2) * depth, rho: internal ? R + y : R - y };
}
