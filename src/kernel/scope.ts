// Kernel objects live in WebAssembly memory and must be freed by hand.
import type { Vector } from 'replicad';
import type { Vec3 } from '../model/types';

interface Deletable { delete: () => void }
export class Scope {
  private items: Deletable[] = [];
  add<T extends Deletable>(o: T): T { this.items.push(o); return o; }
  all<T extends Deletable>(list: T[]): T[] { list.forEach((o) => this.items.push(o)); return list; }
  end(): void { this.items.forEach((o) => { try { o.delete(); } catch { /* already freed */ } }); this.items = []; }
}
export const tup = (v: Vector): Vec3 => { const t = v.toTuple() as Vec3; v.delete(); return t; };
