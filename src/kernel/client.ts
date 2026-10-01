// UI-side handle to the geometry worker. Every call returns a promise; the UI never blocks.
import type { KernelOps, KernelRequest, KernelResponse, OpName } from './protocol';

export class Kernel {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  constructor() {
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<KernelResponse>) => {
      const res = e.data;
      const p = this.pending.get(res.id);
      if (!p) return;
      this.pending.delete(res.id);
      if (res.ok) p.resolve(res.result);
      else p.reject(new Error(res.error));
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'The geometry engine stopped unexpectedly');
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
    };
  }

  call<K extends OpName>(op: K, ...args: KernelOps[K]['args']): Promise<KernelOps[K]['result']> {
    const id = this.nextId++;
    const req: KernelRequest<K> = { id, op, args };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage(req);
    });
  }
}
