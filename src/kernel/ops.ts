// Geometry operations. Runs wherever the kernel is loaded: the Web Worker in the app, Node in tests.
import { makeBaseBox, measureVolume, setOC, type Shape3D } from 'replicad';
import type { BodyMesh } from './protocol';

/** Display tessellation: chord error in mm and angle step in radians. */
export const DISPLAY_QUALITY = { tolerance: 0.02, angularTolerance: 0.2 };

let ready = false;

/** Hand the loaded OpenCascade module to replicad. Call once before any op. */
export function attachKernel(oc: unknown): void {
  setOC(oc as Parameters<typeof setOC>[0]);
  ready = true;
}

export function isKernelReady(): boolean {
  return ready;
}

export function meshBody(shape: Shape3D, quality = DISPLAY_QUALITY): BodyMesh {
  const faces = shape.mesh(quality);
  const edges = shape.meshEdges(quality);
  return {
    positions: new Float32Array(faces.vertices),
    normals: new Float32Array(faces.normals),
    indices: new Uint32Array(faces.triangles),
    faceGroups: faces.faceGroups.map((g) => ({ start: g.start, count: g.count, faceId: g.faceId })),
    edgeLines: new Float32Array(edges.lines),
    edgeGroups: edges.edgeGroups.map((g) => ({ start: g.start, count: g.count, edgeId: g.edgeId })),
    volume: measureVolume(shape),
  };
}

export function testBox(w: number, d: number, h: number): BodyMesh {
  const box = makeBaseBox(w, d, h).translate([w / 2, d / 2, 0]);
  try {
    return meshBody(box);
  } finally {
    box.delete();
  }
}
