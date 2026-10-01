// Makes version 1 project files with the PROTOTYPE itself, so the rebuild is tested against real
// old files. Run: node tests/fixtures/make-v1.mjs   (needs Chrome; writes tests/fixtures/v1/*.json)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const proto = pathToFileURL(resolve(here, '../../reference/caddy-prototype.html')).href;
const outDir = resolve(here, 'v1');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.goto(proto);
await page.waitForTimeout(1200);
await page.locator('#startClose').click();

const cmd = async (t) => { await page.keyboard.type(t); await page.keyboard.press('Enter'); await page.waitForTimeout(80); };
/** Sketch coordinates → page pixels for the sketch being edited. */
const at = (x, y) => page.evaluate(([a, b]) => {
  const c = window.__caddy, sk = c.state.sketch, f = sk.frame;
  const w = f.o.clone().addScaledVector(f.u, a).addScaledVector(f.v, b);
  const cv = document.querySelector('#viewport canvas'), r = cv.getBoundingClientRect();
  // the prototype keeps its camera private: read the projection off a throwaway probe through the hook's scene objects
  const cam = c.state._cam;
  const v = w.clone().project(cam);
  return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
}, [x, y]);

// The prototype does not expose its camera, so sketches here are built through its own test hooks
// (the same functions the UI calls), not by clicking.
async function sketchOn(ref, build) {
  await page.evaluate(({ ref, build }) => {
    const c = window.__caddy;
    const sk = c.createSketch(ref);
    const addPt = (x, y) => { const id = 'p' + (++sk.nid); sk.pts[id] = { x, y }; return id; };
    const line = (a, b) => { const id = 'l' + (++sk.nid); sk.curves.push({ id, type: 'line', p1: a, p2: b }); return id; };
    const con = (o) => { sk.cons.push(Object.assign({ id: 'k' + (++sk.nid) }, o)); };
    for (const s of build) {
      if (s.rect) {
        const [x, y, w, h] = s.rect, origin = x === 0 && y === 0;
        const p = [origin ? 'O' : addPt(x, y), addPt(x + w, y), addPt(x + w, y + h), addPt(x, y + h)];
        const l = [0, 1, 2, 3].map((i) => line(p[i], p[(i + 1) % 4]));
        con({ type: 'horizontal', l: l[0] }); con({ type: 'vertical', l: l[1] }); con({ type: 'horizontal', l: l[2] }); con({ type: 'vertical', l: l[3] });
        con({ type: 'length', l: l[0], v: w, off: -8 }); con({ type: 'length', l: l[1], v: h, off: -8 });
      }
      if (s.circle) { const [x, y, r] = s.circle, id = 'c' + (++sk.nid); sk.curves.push({ id, type: 'circle', c: addPt(x, y), r }); con({ type: 'diameter', c: id, v: r * 2, ang: 0.785 }); }
    }
    c.solveSketch(sk);
    c.finishSketch(true);
  }, { ref, build });
}
const save = async (name) => {
  const data = await page.evaluate((n) => { const c = window.__caddy; c.state.doc.name = n; return c.serializeProject(); }, name);
  writeFileSync(resolve(outDir, name + '.caddy.json'), JSON.stringify(data, null, 1));
  console.log('wrote', name, data.features.map((f) => f.type).join(','));
};
/** Run a feature dialog through the prototype's own code. */
const feature = (type, set) => page.evaluate(({ type, set }) => {
  const c = window.__caddy;
  c.openDialog(type);
  Object.assign(c.state.active.params, set);
  c.commit();
}, { type, set });
/** Edge references exactly as the prototype stores them, for edges whose middle is near the given points. */
const edgeRefs = (mids) => page.evaluate((mids) => {
  const list = window.__caddy.getEdgeCache();
  const mid = (e) => (e.kind === 'round' ? (e.closed ? e.center : e.mid) : [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2]);
  return mids.map((m) => {
    const e = list.slice().sort((p, q) => Math.hypot(...mid(p).map((v, i) => v - m[i])) - Math.hypot(...mid(q).map((v, i) => v - m[i])))[0];
    return e.kind === 'round'
      ? { kind: 'round', bodyId: e.bodyId, center: e.center.slice(), axis: e.axis.slice(), R: e.R, sr: e.sr, closed: e.closed, mid: e.mid.slice(), pts: e.pts.map((p) => p.slice()) }
      : { kind: 'line', bodyId: e.bodyId, a: e.a.slice(), b: e.b.slice(), n1: e.n1.slice(), n2: e.n2.slice() };
  });
}, mids);

// ---- 1. plate with a hole, a pocket cut from an offset plane, a fillet and a chamfer ----
await sketchOn({ kind: 'origin', id: 'XY' }, [{ rect: [0, 0, 60, 40] }, { circle: [20, 20, 3] }]);
await page.evaluate(() => { const c = window.__caddy, sk = c.state.features[0]; const pr = sk.profiles.find((p) => p.outer); c.state.selected = { sketchId: sk.id, key: pr.key }; });
await feature('extrude', { distance: 8 });
await page.evaluate(() => { const c = window.__caddy; c.openDialog('plane'); c.state.active.params.ref = { kind: 'origin', id: 'XY' }; c.state.active.params.distance = 8; c.commit(); });
await sketchOn({ kind: 'plane', id: 'p1' }, [{ rect: [35, 10, 15, 20] }]);
await page.evaluate(() => { const c = window.__caddy, sk = c.state.features.filter((f) => f.type === 'sketch')[1]; c.state.selected = { sketchId: sk.id, key: sk.profiles[0].key }; });
await feature('extrude', { distance: -3, operation: 'Cut', opAuto: false });
await feature('fillet', { edges: await edgeRefs([[60, 20, 8]]), r: 2 });
await feature('chamfer', { edges: await edgeRefs([[0, 20, 8]]), r: 1.5 });
await save('plate-pocket-fillet');

await browser.close();
void cmd; void at;
