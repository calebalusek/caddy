// Kernel entry points shared by the Web Worker (app) and Node (tests).
import { makeBaseBox, setOC } from 'replicad';
import { buildModel, exportMeshes, exportStep, meshBody } from './model';
import type { BodyMesh } from './protocol';

let ready = false;

/** Hand the loaded OpenCascade module to replicad. Call once before any op. */
export function attachKernel(oc: unknown): void {
  setOC(oc as Parameters<typeof setOC>[0]);
  ready = true;
}

export function isKernelReady(): boolean {
  return ready;
}

export function testBox(w: number, d: number, h: number): BodyMesh {
  const box = makeBaseBox(w, d, h).translate([w / 2, d / 2, 0]);
  try {
    return meshBody(box);
  } finally {
    box.delete();
  }
}

export { buildModel, exportMeshes, exportStep };
