// Geometry worker: loads OpenCascade (WebAssembly) off the UI thread and answers requests.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { attachKernel, buildModel, testBox } from './ops';
import type { BodyMesh, BuildStep, KernelRequest, KernelResponse } from './protocol';

const loading = (opencascade as (opts: object) => Promise<unknown>)({ locateFile: () => wasmUrl }).then(attachKernel);

const meshBuffers = (m: BodyMesh): Transferable[] => [m.positions.buffer, m.normals.buffer, m.indices.buffer, m.edgeLines.buffer];

function run(req: KernelRequest): { result: unknown; transfer: Transferable[] } {
  switch (req.op) {
    case 'ping':
      return { result: 'ready', transfer: [] };
    case 'testBox': {
      const [w, d, h] = req.args as [number, number, number];
      const mesh = testBox(w, d, h);
      return { result: mesh, transfer: meshBuffers(mesh) };
    }
    case 'build': {
      const result = buildModel(req.args[0] as BuildStep[]);
      return { result, transfer: result.bodies.flatMap((b) => meshBuffers(b.mesh)) };
    }
  }
  throw new Error('Unknown kernel request: ' + req.op);
}

self.onmessage = async (e: MessageEvent<KernelRequest>) => {
  const req = e.data;
  let res: KernelResponse;
  let transfer: Transferable[] = [];
  try {
    await loading;
    const out = run(req);
    res = { id: req.id, ok: true, result: out.result };
    transfer = out.transfer;
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res, transfer);
};
