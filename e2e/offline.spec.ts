// The published build: served from a sub-folder (like GitHub Pages), then used with the server gone.
import { execSync } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { expect, test } from '@playwright/test';

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };
const dist = join(process.cwd(), 'dist-offline-test');
let server: Server | null = null;
let port = 0;

test.beforeAll(async () => {
  execSync(`npx vite build --outDir "${dist}" --emptyOutDir`, { stdio: 'ignore' });
  server = createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    if (!url.startsWith('/caddy/')) { res.statusCode = 404; res.end(); return; }
    let file = normalize(join(dist, url.slice('/caddy/'.length) || 'index.html'));
    if (url.endsWith('/')) file = join(dist, 'index.html');
    if (!file.startsWith(dist) || !existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  port = (server.address() as { port: number }).port;
});
test.afterAll(async () => { await new Promise<void>((r) => (server ? server.close(() => r()) : r())); });

test('works from a sub-folder, installs for offline use, and opens and models with the server gone', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${port}/caddy/`);
  await expect(page.locator('#toolbar .tbtn').first()).toBeVisible();
  const tips = page.locator('#startClose');
  if (await tips.count()) await tips.click();
  // the geometry engine loads and works
  await page.waitForFunction(() => (window as any).__caddy.kernelReady, null, { timeout: 60_000 });
  // wait until every file is saved on this device
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg || !reg.active) return false;
    const src = await (await fetch('sw.js')).text();
    const files: string[] = JSON.parse(/const FILES = (\[.*\]);/.exec(src)![1]);
    const names = await caches.keys();
    if (!names.length) return false;
    const c = await caches.open(names[0]);
    return (await c.keys()).length >= files.length;
  }, null, { timeout: 90_000 });
  expect(await page.evaluate(() => !!document.querySelector('link[rel="manifest"]'))).toBe(true);

  // the server goes away: the app must still open from the saved files
  await new Promise<void>((r) => server!.close(() => r()));
  server = null;
  await page.reload();
  await expect(page.locator('#toolbar .tbtn').first()).toBeVisible();
  await page.waitForFunction(() => (window as any).__caddy.kernelReady, null, { timeout: 60_000 });
  const vol = await page.evaluate(async () => { const m = await (window as any).__caddy.kernel.call('testBox', 10, 20, 30); return m.volume; });
  expect(vol).toBeCloseTo(6000, 6); // the geometry engine ran offline
  expect(errors).toEqual([]);
  void context;
});
