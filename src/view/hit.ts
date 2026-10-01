// What is under the cursor: body faces, body edges and sketch regions.
import * as THREE from 'three';
import type { ProfileSel } from '../app/state';
import type { BodyResult, EdgeInfo, FaceInfo } from '../kernel/protocol';
import type { Vec3 } from '../model/types';
import { profileFills, toScreen } from '../sketch/visuals';
import { mouse, pickScale, ray } from '../tools/pick';
import { edgeSegments, faceOfTriangle, visibleBodies, type BodyVis } from './bodies';
import { camera, V3 } from './scene';

export interface FaceHit { vis: BodyVis; bodyId: string; face: FaceInfo; point: V3; distance: number }
export interface EdgeHit { bodyId: string; edge: EdgeInfo; segs: [Vec3, Vec3][] }

/** The body face under the cursor. */
export function faceAtCursor(): FaceHit | null {
  const list = visibleBodies();
  const h = ray.intersectObjects(list.map((v) => v.mesh), false)[0];
  if (!h || h.faceIndex == null) return null;
  const vis = list.find((v) => v.mesh === h.object)!;
  const face = faceOfTriangle(vis, h.faceIndex);
  return face ? { vis, bodyId: vis.id, face, point: h.point, distance: h.distance } : null;
}

const occRay = new THREE.Raycaster();
/**
 * The body edge nearest the cursor (within 9 px) that is not hidden behind a body.
 * `tol` is how far behind a surface an edge may sit and still count as visible.
 */
export function edgeAtCursor(bodies: BodyResult[], tol = 0.6): EdgeHit | null {
  const meshes = visibleBodies().map((v) => v.mesh);
  let best: EdgeHit | null = null, bd = 9 * pickScale();
  const a = new V3(), b = new V3();
  bodies.forEach((body) => {
    if (!visibleBodies().some((v) => v.id === body.id)) return;
    body.edges.forEach((edge) => {
      const segs = edgeSegments(body, edge.id);
      segs.forEach(([sa, sb]) => {
        const pa = toScreen(a.set(...sa)), pb = toScreen(b.set(...sb));
        if (pa.behind || pb.behind) return;
        const dx = pb.x - pa.x, dy = pb.y - pa.y, L2 = dx * dx + dy * dy;
        let t = L2 ? ((mouse.x - pa.x) * dx + (mouse.y - pa.y) * dy) / L2 : 0;
        t = Math.max(0, Math.min(1, t));
        const dd = Math.hypot(mouse.x - pa.x - dx * t, mouse.y - pa.y - dy * t);
        if (dd >= bd) return;
        const w = new V3(sa[0] + (sb[0] - sa[0]) * t, sa[1] + (sb[1] - sa[1]) * t, sa[2] + (sb[2] - sa[2]) * t);
        const dir = w.clone().sub(camera.position), dist = dir.length();
        occRay.set(camera.position, dir.normalize());
        const hit = occRay.intersectObjects(meshes, false)[0];
        if (hit && hit.distance < dist - tol) return;
        bd = dd;
        best = { bodyId: body.id, edge, segs };
      });
    });
  });
  return best;
}

/** The sketch region under the cursor, and how far along the cursor ray it is. */
export function profileAtCursor(): { sel: ProfileSel; distance: number } | null {
  const h = ray.intersectObjects(profileFills(), false)[0];
  return h ? { sel: h.object.userData.profile as ProfileSel, distance: h.distance } : null;
}
