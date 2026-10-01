// A sketch that lies on a body face can snap to that face's edges: corners, edge midpoints,
// centers of round edges and their quarter points. Worked out from the bodies each time the sketch
// is opened, so the points follow the body when it changes.
import type { BodyResult } from '../kernel/protocol';
import { toLocal, vdot } from '../model/frames';
import type { ExtSnap, Frame, Vec3 } from '../model/types';

export function faceSnaps(frame: Frame, bodies: BodyResult[], refIsFace: boolean): { onFace: boolean; ext: ExtSnap[] } {
  const n = frame.n, w = vdot(n, frame.o);
  const inPlane = (p: Vec3): boolean => Math.abs(vdot(n, p) - w) < 1e-3;
  // on a face if it was started on one, or if a flat body face lies in the sketch's plane
  const onFace = refIsFace || bodies.some((b) => b.faces.some((f) => f.planar && Math.abs(Math.abs(vdot(f.n, n)) - 1) < 1e-6 && inPlane(f.p)));
  const out: ExtSnap[] = [], seen = new Set<string>();
  const add = (p: [number, number], kind: ExtSnap['kind']): void => {
    const k = kind + Math.round(p[0] * 1e3) + ',' + Math.round(p[1] * 1e3);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ p, kind, ext: true });
  };
  const L = (p: Vec3): [number, number] => toLocal(frame, p);
  bodies.forEach((b) => b.edges.forEach((e) => {
    if (e.kind === 'line') {
      if (!inPlane(e.a) || !inPlane(e.b)) return;
      const a = L(e.a), c = L(e.b);
      add(a, 'end'); add(c, 'end'); add([(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], 'mid');
    } else if (e.kind === 'round' && e.center && e.axis && e.R) {
      if (!inPlane(e.center) || Math.abs(Math.abs(vdot(e.axis, n)) - 1) > 1e-6) return;
      const c = L(e.center);
      add(c, 'center');
      if (e.closed) for (let i = 0; i < 4; i++) { const t = (i * Math.PI) / 2; add([c[0] + e.R * Math.cos(t), c[1] + e.R * Math.sin(t)], 'quad'); }
      else { add(L(e.a), 'end'); add(L(e.b), 'end'); add(L(e.mid), 'mid'); }
    }
  }));
  return { onFace, ext: out };
}
