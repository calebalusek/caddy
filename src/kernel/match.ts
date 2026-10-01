// Finding "the same edge again" after the model changed. Saved features point at edges
// geometrically (the format of version 1 files), so this works on plain edge data.
import { vadd, vdot, vlen, vnorm, vsc, vsub } from '../model/frames';
import type { Vec3 } from '../model/types';
import type { EdgeInfo, EdgeRef } from './protocol';

const same = (a: Vec3, b: Vec3): boolean => vdot(vnorm(a), vnorm(b)) > 0.995;

/** The edge a saved reference points at, or null if nothing fits any more. */
export function matchEdge(edges: EdgeInfo[], ref: EdgeRef): EdgeInfo | null {
  let best: EdgeInfo | null = null, bd = Infinity;
  if (ref.kind === 'round') {
    edges.forEach((e) => {
      if (e.kind !== 'round' || !e.axis || !e.center) return;
      if (Math.abs(vdot(e.axis, vnorm(ref.axis))) < 0.995 || !!e.closed !== !!ref.closed) return;
      const dd = vlen(vsub(e.closed ? e.center : e.mid, ref.closed ? ref.center : ref.mid)) + 2 * Math.abs(e.R! - ref.R);
      if (dd < bd) { bd = dd; best = e; }
    });
    // a different circle that merely shares the axis is not "the same edge"
    return best && bd < Math.max(1, ref.R * 0.5) ? best : null;
  }
  const mid = vsc(vadd(ref.a, ref.b), 0.5);
  edges.forEach((e) => {
    if (e.kind !== 'line') return;
    if (!((same(e.n1, ref.n1) && same(e.n2, ref.n2)) || (same(e.n1, ref.n2) && same(e.n2, ref.n1)))) return;
    const ab = vsub(e.b, e.a), t = Math.max(0, Math.min(1, vdot(vsub(mid, e.a), ab) / (vdot(ab, ab) || 1)));
    const dd = vlen(vsub(mid, vadd(e.a, vsc(ab, t))));
    if (dd < bd) { bd = dd; best = e; }
  });
  return best;
}

/** The saved form of an edge. */
export function edgeToRef(e: EdgeInfo, bodyId: string): EdgeRef {
  return e.kind === 'round'
    ? { kind: 'round', bodyId, center: e.center!, axis: e.axis!, R: e.R!, closed: !!e.closed, mid: e.mid }
    : { kind: 'line', bodyId, a: e.a, b: e.b, n1: e.n1, n2: e.n2 };
}

/** Is this edge the one a reference points at? (exact, for toggling selections) */
export function refIs(e: EdgeInfo, bodyId: string, r: EdgeRef): boolean {
  if (r.bodyId !== bodyId) return false;
  if (e.kind === 'round') return r.kind === 'round' && vlen(vsub(e.closed ? e.center! : e.mid, r.closed ? r.center : r.mid)) < 1e-3 && Math.abs(e.R! - r.R) < 1e-3;
  if (r.kind === 'round' || e.kind !== 'line') return false;
  const close = (p: Vec3, q: Vec3): boolean => vlen(vsub(p, q)) < 1e-3;
  return (close(e.a, r.a) && close(e.b, r.b)) || (close(e.a, r.b) && close(e.b, r.a));
}
