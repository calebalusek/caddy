// Geometry worker: loads OpenCascade (WebAssembly) off the UI thread and answers requests.
import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { attachKernel, buildDraft, buildModel, exportMeshes, exportStep, testBox } from './ops';
import type { BodyMesh, BuildStep, KernelOps, KernelRequest, KernelResponse } from './protocol';

const loading = (opencascade as (opts: object) => Promise<unknown>)({ locateFile: () => wasmUrl }).then(attachKernel);

const meshBuffers = (m: BodyMesh): Transferable[] => [m.positions.buffer, m.normals.buffer, m.indices.buffer, m.edgeLines.buffer];

type Out = { result: unknown; transfer: Transferable[] };
function run(req: KernelRequest): Out | Promise<Out> {
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
    case 'buildDraft': {
      const [steps, draft, haveKey] = req.args as KernelOps['buildDraft']['args'];
      const result = buildDraft(steps, draft, haveKey);
      return { result, transfer: (result.base ? result.base.bodies.flatMap((b) => meshBuffers(b.mesh)) : []).concat(result.removed.concat(result.added).flatMap(meshBuffers)) };
    }
    case 'exportMesh': {
      const [steps, quality, ids] = req.args as KernelOps['exportMesh']['args'];
      const result = exportMeshes(steps, quality, ids);
      return { result, transfer: result.flatMap((m) => [m.positions.buffer, m.indices.buffer]) };
    }
    case 'exportStep': {
      const [steps, bodies] = req.args as KernelOps['exportStep']['args'];
      return exportStep(steps, bodies).then((bytes) => ({ result: bytes, transfer: [bytes.buffer] }));
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
    const out = await run(req);
    res = { id: req.id, ok: true, result: out.result };
    transfer = out.transfer;
  } catch (err) {
    res = { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  (self as unknown as Worker).postMessage(res, transfer);
};
