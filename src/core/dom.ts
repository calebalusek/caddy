export const $ = <T extends HTMLElement = HTMLElement>(s: string): T => document.querySelector<T>(s)!;
export const root = document.documentElement;
export const cssv = (n: string): string => getComputedStyle(root).getPropertyValue(n).trim();
export const esc = (s: unknown): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
export { fmt } from './format';
export const reduceMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const storage = {
  get(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch { /* private mode: nothing to remember */ }
  },
  remove(key: string): void {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};
