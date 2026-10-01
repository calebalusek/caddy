// iPad: fingers move the view, the Apple Pencil draws. Real touch and pen input through the browser's own input pipeline.
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { openApp, screenOf, settle, typeCommand } from './helpers';

test.use({ hasTouch: true });

const built = (page: Page) => page.evaluate(async () => { await new Promise((r) => setTimeout(r, 400)); await (window as any).__caddy.whenBuilt(); });
const camState = (page: Page) => page.evaluate(() => { const c = (window as any).__caddy.cam; return { theta: c.theta, phi: c.phi, r: c.r, tx: c.target.x, ty: c.target.y, tz: c.target.z }; });

type Pt = { x: number; y: number };
class Hand {
  constructor(private cdp: CDPSession) {}
  private send(type: string, pts: Pt[]): Promise<unknown> { return this.cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p.x, y: p.y, id: i + 1 })) } as any); }
  down(pts: Pt[]): Promise<unknown> { return this.send('touchStart', pts); }
  move(pts: Pt[]): Promise<unknown> { return this.send('touchMove', pts); }
  up(): Promise<unknown> { return this.send('touchEnd', []); }
  /** Fingers move together from a to b in steps. */
  async drag(from: Pt[], to: Pt[], steps = 8): Promise<void> {
    await this.down(from);
    for (let i = 1; i <= steps; i++) await this.move(from.map((p, k) => ({ x: p.x + ((to[k].x - p.x) * i) / steps, y: p.y + ((to[k].y - p.y) * i) / steps })));
    await this.up();
  }
  async tap(pts: Pt[]): Promise<void> { await this.down(pts); await this.up(); }
}
async function hand(page: Page): Promise<Hand> { return new Hand(await page.context().newCDPSession(page)); }
async function pen(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const m = (type: string, p: Pt, buttons: number, extra = {}): Promise<unknown> => cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: buttons || type === 'mouseReleased' ? 'left' : 'none', buttons, clickCount: buttons || type === 'mouseReleased' ? 1 : 0, pointerType: 'pen', force: buttons ? 0.5 : 0, ...extra } as any);
  return {
    hover: (p: Pt) => m('mouseMoved', p, 0),
    async draw(a: Pt, b: Pt, steps = 8): Promise<void> {
      await m('mouseMoved', a, 0);
      await m('mousePressed', a, 1);
      for (let i = 1; i <= steps; i++) await m('mouseMoved', { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }, 1);
      await m('mouseReleased', b, 0);
    },
    async tap(p: Pt): Promise<void> { await m('mouseMoved', p, 0); await m('mousePressed', p, 1); await m('mouseReleased', p, 0); },
  };
}
const center = async (page: Page): Promise<Pt> => page.evaluate(() => { const r = document.querySelector('#viewport canvas')!.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });

async function box(page: Page): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
  await typeCommand(page, 'rec');
  const at = (x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<Pt>;
  const p = await at(0, 0); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  const q = await at(36, 24); await page.mouse.move(q.x, q.y);
  await page.keyboard.type('60'); await page.keyboard.press('Tab'); await page.keyboard.type('40'); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await typeCommand(page, 'fs');
  await typeCommand(page, 'ex');
  await page.keyboard.type('10'); await page.keyboard.press('Enter');
  await typeCommand(page, 'home');
  await settle(page);
  await built(page);
}

test.describe('fingers move the view', () => {
  test('one finger orbits the 3D view', async ({ page }) => {
    const errors = await openApp(page);
    const h = await hand(page), c = await center(page), before = await camState(page);
    await h.drag([c], [{ x: c.x + 120, y: c.y + 60 }]);
    const after = await camState(page);
    expect(after.theta).toBeLessThan(before.theta - 0.5); // dragging right turns the model with it
    expect(after.phi).toBeLessThan(before.phi - 0.2);
    expect(after.r).toBeCloseTo(before.r, 6);
    expect(errors).toEqual([]);
  });

  test('two fingers: drag pans, spreading zooms in, pinching zooms out, twisting turns the model', async ({ page }) => {
    const errors = await openApp(page);
    const h = await hand(page), c = await center(page);
    const L = { x: c.x - 60, y: c.y }, R = { x: c.x + 60, y: c.y };
    let a = await camState(page);
    await h.drag([L, R], [{ x: L.x + 90, y: L.y + 40 }, { x: R.x + 90, y: R.y + 40 }]); // both fingers move together
    let b = await camState(page);
    expect(Math.hypot(b.tx - a.tx, b.ty - a.ty, b.tz - a.tz)).toBeGreaterThan(5); // panned
    expect(b.r).toBeCloseTo(a.r, 1); // no zoom
    expect(b.theta).toBeCloseTo(a.theta, 1); // no turn
    a = b;
    await h.drag([L, R], [{ x: L.x - 70, y: L.y }, { x: R.x + 70, y: R.y }]); // spread
    b = await camState(page);
    expect(b.r).toBeLessThan(a.r * 0.6); // zoomed in
    a = b;
    await h.drag([{ x: c.x - 120, y: c.y }, { x: c.x + 120, y: c.y }], [{ x: c.x - 40, y: c.y }, { x: c.x + 40, y: c.y }]); // pinch
    b = await camState(page);
    expect(b.r).toBeGreaterThan(a.r * 1.8); // zoomed out
    a = b;
    await h.drag([{ x: c.x - 80, y: c.y }, { x: c.x + 80, y: c.y }], [{ x: c.x, y: c.y - 80 }, { x: c.x, y: c.y + 80 }]); // a quarter turn, same spread
    b = await camState(page);
    expect(Math.abs(b.theta - a.theta)).toBeGreaterThan(1.2); // twisted: about a quarter turn
    expect(Math.abs(b.r - a.r) / a.r).toBeLessThan(0.1);
    expect(errors).toEqual([]);
  });

  test('in a sketch one finger pans (the view stays square-on) and a tap still places points', async ({ page }) => {
    const errors = await openApp(page);
    await typeCommand(page, 'sk');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    await settle(page);
    const h = await hand(page), c = await center(page), a = await camState(page);
    await h.drag([c], [{ x: c.x + 100, y: c.y + 50 }]);
    const b = await camState(page);
    expect(b.phi).toBeCloseTo(a.phi, 6); // no tilt
    expect(b.theta).toBeCloseTo(a.theta, 6);
    expect(Math.hypot(b.tx - a.tx, b.ty - a.ty)).toBeGreaterThan(3);
    // a finger tap with the Line tool starts a line
    await typeCommand(page, 'l');
    const p = await page.evaluate(() => (window as any).__caddy.sketchScreen(10, 10)) as Pt;
    await h.tap([p]);
    const first = await page.evaluate(() => (window as any).__caddy.state.tool.pts.map((q: any) => q.p));
    expect(first).toHaveLength(1);
    expect(first[0][0]).toBeCloseTo(10, 0); // exactly where the finger tapped, not where a hover last was
    expect(first[0][1]).toBeCloseTo(10, 0);
    expect(errors).toEqual([]);
  });

  test('a quick 2-finger tap is Undo (it reopens the last tool); a quick 3-finger tap fits the model to the screen', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    await expect(page.locator('section.dialog')).toHaveCount(0);
    const h = await hand(page), c = await center(page);
    await h.tap([{ x: c.x - 50, y: c.y + 100 }, { x: c.x + 50, y: c.y + 100 }]);
    await expect(page.locator('section.dialog')).toBeVisible(); // Undo brought the Extrude menu back with its value
    await expect(page.locator('#f-distance')).toHaveValue('10');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { (window as any).__caddy.cam.r = 900; });
    const far = (await camState(page)).r;
    await h.tap([{ x: c.x - 80, y: c.y + 100 }, { x: c.x, y: c.y + 100 }, { x: c.x + 80, y: c.y + 100 }]);
    await settle(page);
    expect((await camState(page)).r).toBeLessThan(far * 0.6);
    expect(errors).toEqual([]);
  });

  test('touch and hold is a right-click (the context menu); a double-tap edits a sketch like a double-click', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    const top = await screenOf(page, [30, 20, 10]);
    const h = await hand(page);
    await h.down([top]);
    await page.waitForTimeout(800);
    await h.up();
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
});

test.describe('the Apple Pencil', () => {
  test('in a sketch, drag with the pencil to draw: a rectangle from corner to corner, a circle from center to edge', async ({ page }) => {
    const errors = await openApp(page);
    await typeCommand(page, 'sk');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    await settle(page);
    const sk = (x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<Pt>;
    const pn = await pen(page);
    await typeCommand(page, 'rec');
    await pn.draw(await sk(0, 0), await sk(40, 25));
    let s = await page.evaluate(() => { const k = (window as any).__caddy.state.sketch; return { curves: k.curves.length, xs: Object.values(k.pts).map((p: any) => p.x), ys: Object.values(k.pts).map((p: any) => p.y) }; });
    expect(s.curves).toBe(4);
    expect(Math.max(...s.xs) - Math.min(...s.xs)).toBeCloseTo(40, 0);
    expect(Math.max(...s.ys) - Math.min(...s.ys)).toBeCloseTo(25, 0);
    await typeCommand(page, 'c');
    await pn.draw(await sk(70, 15), await sk(80, 15));
    const circle = await page.evaluate(() => (window as any).__caddy.state.sketch.curves.find((c: any) => c.type === 'circle'));
    expect(circle.r).toBeCloseTo(10, 0);
    expect(errors).toEqual([]);
  });

  test('tapping with the pencil also works (tap, tap), and a hovering pencil shows what it would pick', async ({ page }) => {
    const errors = await openApp(page);
    await typeCommand(page, 'sk');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    await settle(page);
    const sk = (x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<Pt>;
    const pn = await pen(page);
    await typeCommand(page, 'l');
    await pn.tap(await sk(0, 0));
    await pn.tap(await sk(30, 0));
    await pn.hover(await sk(30, 20));
    const n = await page.evaluate(() => (window as any).__caddy.state.sketch.curves.length);
    expect(n).toBe(1); // one line placed by two taps, the chain goes on from its end
    expect(errors).toEqual([]);
  });

  test('the pencil in the 3D view picks like a mouse: tap a face to select it', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    const pn = await pen(page), top = await screenOf(page, [30, 20, 10]);
    await pn.tap(top);
    expect(await page.evaluate(() => (window as any).__caddy.state.selection.length)).toBe(1);
    expect(errors).toEqual([]);
  });
});

test.describe('iPad mode', () => {
  const goTablet = async (page: Page): Promise<void> => { await page.locator('#devSwitch button[data-device="tablet"]').click(); await expect(page.locator('html')).toHaveAttribute('data-device', 'tablet'); };

  test('bigger touch targets, and the Browser panel can be put away', async ({ page }) => {
    const errors = await openApp(page);
    const size = async (sel: string) => page.evaluate((s) => { const r = document.querySelector(s)!.getBoundingClientRect(); return [r.width, r.height]; }, sel);
    const before = await size('.tbtn');
    await goTablet(page);
    const after = await size('.tbtn');
    expect(after[1]).toBeGreaterThanOrEqual(56); // at least about a fingertip (44 pt) tall
    expect(after[1]).toBeGreaterThan(before[1]);
    await expect(page.locator('#browserToggle')).toBeVisible();
    await expect(page.locator('.browser')).toBeVisible();
    await page.locator('#browserToggle').click();
    await expect(page.locator('.browser')).toBeHidden(); // the model gets the whole width
    await page.locator('#browserToggle').click();
    await expect(page.locator('.browser')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the number pad appears for size boxes: digits, math signs, back, sign, Next and Done', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    await page.keyboard.press('Control+z'); // reopen the extrude menu
    await expect(page.locator('section.dialog')).toBeVisible();
    await goTablet(page);
    await expect(page.locator('.keypad')).toBeHidden();
    await page.locator('#f-distance').focus();
    await expect(page.locator('.keypad')).toBeVisible();
    expect(await page.evaluate(() => document.querySelector<HTMLInputElement>('#f-distance')!.inputMode)).toBe('none'); // no system keyboard
    const key = (k: string) => page.locator(`.keypad [data-k="${k}"]`).click();
    for (const k of ['1', '2', '/', '4']) await key(k);
    await expect(page.locator('#f-distance')).toHaveValue('12/4'); // math works: 3 mm
    await key('back'); await key('back'); await key('back');
    await expect(page.locator('#f-distance')).toHaveValue('1');
    await key('sign');
    await expect(page.locator('#f-distance')).toHaveValue('-1');
    await key('sign');
    for (const k of ['5', '.', '5']) await key(k);
    await expect(page.locator('#f-distance')).toHaveValue('15.5');
    await key('next'); // there is only one size box in this menu, so Next stays on it
    await expect(page.locator('#f-distance')).toBeFocused();
    await key('done'); // Enter: finishes the extrude
    await expect(page.locator('section.dialog')).toHaveCount(0);
    expect(await built(page).then(() => page.evaluate(() => (window as any).__caddy.baseBodies()[0].volume))).toBeCloseTo(60 * 40 * 15.5, 3);
    await expect(page.locator('.keypad')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('drag a size\'s name sideways to change it; farther from the box is finer', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    await page.keyboard.press('Control+z');
    await goTablet(page);
    const h = await hand(page);
    const lab = await page.locator('section.dialog label[for="f-distance"]').boundingBox();
    const from = { x: lab!.x + 10, y: lab!.y + lab!.height / 2 };
    await h.drag([from], [{ x: from.x + 60, y: from.y }]); // 60 px = 20 steps of 0.1 mm
    const coarse = Number(await page.locator('#f-distance').inputValue());
    expect(coarse - 10).toBeCloseTo(2, 1); // from 10 mm to 12
    await h.drag([from], [{ x: from.x + 60, y: from.y + 100 }]); // 100 px below: ten times finer
    const fine = Number(await page.locator('#f-distance').inputValue());
    expect(fine - coarse).toBeCloseTo(0.2, 1);
    expect(errors).toEqual([]);
  });
});

test('iPad mode: Undo, Esc and Enter buttons stand in for the keys', async ({ page }) => {
  const errors = await openApp(page);
  await expect(page.locator('.touchbar')).toBeHidden();
  await page.locator('#devSwitch button[data-device="tablet"]').click();
  await expect(page.locator('.touchbar')).toBeVisible();
  await box(page);
  await page.locator('.touchbar [data-tb="undo"]').click(); // Undo reopens the extrude menu
  await expect(page.locator('section.dialog')).toBeVisible();
  await page.locator('.touchbar [data-tb="esc"]').click(); // Esc closes it
  await expect(page.locator('section.dialog')).toHaveCount(0);
  await page.locator('.touchbar [data-tb="undo"]').click();
  await page.locator('#f-distance').focus();
  await page.locator('.touchbar [data-tb="enter"]').click(); // Enter finishes it
  await expect(page.locator('section.dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});
