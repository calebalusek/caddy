// Geometry worker: loads OpenCascade (WebAssembly) off the UI thread and answers requests.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { attachKernel, testBox } from './ops';
import type { BodyMesh, KernelRequest, KernelResponse } from './protocol';

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
  }
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
