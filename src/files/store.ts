// The project library lives in this browser (IndexedDB). No accounts, no cloud.
import type { ProjectFile } from './format';

export interface ProjectRecord {
  id: string;
  name: string;
  created: number;
  modified: number;
  data: ProjectFile;
  thumb: string | null;
  summary: { features: number; bodies: number };
}

let dbp: Promise<IDBDatabase> | null = null;
const open = (): Promise<IDBDatabase> =>
  dbp || (dbp = new Promise((res, rej) => {
    if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
    const r = indexedDB.open('caddy', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return open().then((db) => new Promise((res, rej) => {
    const t = db.transaction('projects', mode), req = fn(t.objectStore('projects'));
    t.oncomplete = () => res(req ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const store = {
  all: (): Promise<ProjectRecord[]> => tx<ProjectRecord[]>('readonly', (s) => s.getAll()).then((r) => r || []),
  get: (id: string): Promise<ProjectRecord | undefined> => tx<ProjectRecord>('readonly', (s) => s.get(id)),
  put: (rec: ProjectRecord): Promise<unknown> => tx('readwrite', (s) => s.put(rec)),
  del: (id: string): Promise<unknown> => tx('readwrite', (s) => { s.delete(id); }),
};
