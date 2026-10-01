// Loads the real OpenCascade kernel in Node so geometry tests check exact numbers.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import opencascade from 'replicad-opencascadejs';
import { attachKernel, isKernelReady } from '../../src/kernel/ops';

let loading: Promise<void> | null = null;

export function loadKernel(): Promise<void> {
  if (isKernelReady()) return Promise.resolve();
  if (!loading) {
    const wasmPath = createRequire(import.meta.url).resolve('replicad-opencascadejs/wasm');
    const wasmBinary = readFileSync(wasmPath);
    loading = (opencascade as (opts: object) => Promise<unknown>)({ wasmBinary }).then(attachKernel);
  }
  return loading;
}

/** Volume of a closed triangle mesh (signed tetrahedra). Independent check on the kernel's number. */
export function meshVolume(positions: Float32Array, indices: Uint32Array): number {
  let v = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    v +=
      positions[a] * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1]) -
      positions[a + 1] * (positions[b] * positions[c + 2] - positions[b + 2] * positions[c]) +
      positions[a + 2] * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
  }
  return v / 6;
}
