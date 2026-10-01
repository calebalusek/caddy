import { expect, test, type Page } from '@playwright/test';
import { openApp, settle, typeCommand } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const built = (page: Page) => page.evaluate(async () => { await new Promise((r) => setTimeout(r, 400)); await (window as any).__caddy.whenBuilt(); return (window as any).__caddy.baseBodies().map((b: any) => b.volume); });

/** A 60 × 40 rectangle on the Top plane, typed in millimeters, and left in the sketch. */
async function rectInSketch(page: Page): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
  await typeCommand(page, 'rec');
  const p = await at(page, 0, 0); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  const q = await at(page, 36, 24); await page.mouse.move(q.x, q.y);
  await page.keyboard.type('60'); await page.keyboard.press('Tab'); await page.keyboard.type('40'); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
}

test.describe('millimeters / inches', () => {
  test('the switch at the top right: mm by default, remembered, and the base grid follows it', async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.locator('#unitSwitch button[data-unit="mm"]')).toHaveAttribute('aria-pressed', 'true');
    const mm = await page.evaluate(() => (window as any).__caddy.gridReach());
    expect(mm).toBeCloseTo(150, 6);
    await page.locator('#unitSwitch button[data-unit="in"]').click();
    await expect(page.locator('#unitSwitch button[data-unit="in"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#msg')).toContainText('Inches');
    expect(await page.evaluate(() => (window as any).__caddy.gridReach())).toBeCloseTo(190.5, 6); // 7.5 in
    // remembered after a reload
    await page.reload();
    await expect(page.locator('#toolbar .tbtn').first()).toBeVisible();
    await expect(page.locator('#unitSwitch button[data-unit="in"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => (window as any).__caddy.gridReach())).toBeCloseTo(190.5, 6);
    await page.locator('#unitSwitch button[data-unit="mm"]').click();
    expect(await page.evaluate(() => (window as any).__caddy.gridReach())).toBeCloseTo(150, 6);
    expect(errors).toEqual([]);
  });

  test('tool menus: lengths are shown and typed in inches; the model keeps millimeters; the arrow label follows', async ({ page }) => {
    const errors = await openApp(page);
    await rectInSketch(page);
    await typeCommand(page, 'fs');
    await typeCommand(page, 'ex');
    await expect(page.locator('#f-distance')).toHaveValue('0');
    await expect(page.locator('section.dialog .unit').first()).toHaveText('mm');
    await page.locator('#unitSwitch button[data-unit="in"]').click(); // switching with the menu open
    await expect(page.locator('section.dialog .unit').first()).toHaveText('in');
    await page.locator('#f-distance').fill('1'); // one inch
    let v = await built(page);
    await expect(page.locator('#dim')).toHaveText('1 in');
    await page.keyboard.press('Enter');
    v = await built(page);
    expect(v[0]).toBeCloseTo(60 * 40 * 25.4, 4); // 25.4 mm thick
    // editing it shows inches, and a typed 0.5 in is 12.7 mm
    await page.locator('#timeline [data-ref="extrude:e1"]').dblclick();
    await expect(page.locator('#f-distance')).toHaveValue('1');
    await page.locator('#f-distance').fill('0.5');
    await page.keyboard.press('Enter');
    v = await built(page);
    expect(v[0]).toBeCloseTo(60 * 40 * 12.7, 4);
    // back to millimeters: the same part reads 12.7
    await page.locator('#unitSwitch button[data-unit="mm"]').click();
    await page.locator('#timeline [data-ref="extrude:e1"]').dblclick();
    await expect(page.locator('#f-distance')).toHaveValue('12.7');
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test('sketch dimensions read in inches, and typing an inch value in a dimension sets the right millimeters', async ({ page }) => {
    const errors = await openApp(page);
    await rectInSketch(page);
    await expect(page.locator('.dimlbl', { hasText: '60' })).toBeVisible();
    await page.locator('#unitSwitch button[data-unit="in"]').click();
    await expect(page.locator('.dimlbl', { hasText: '2.362' })).toBeVisible(); // 60 mm
    await expect(page.locator('.dimlbl', { hasText: '1.575' })).toBeVisible(); // 40 mm
    await page.locator('.dimlbl', { hasText: '2.362' }).dblclick();
    await page.locator('#dimInput').fill('3');
    await page.keyboard.press('Enter');
    const w = await page.evaluate(() => { const s = (window as any).__caddy.state.sketch; return Math.max(...s.curves.flatMap((c: any) => [s.pts[c.p1].x, s.pts[c.p2].x])) - Math.min(...s.curves.flatMap((c: any) => [s.pts[c.p1].x, s.pts[c.p2].x])); });
    expect(w).toBeCloseTo(76.2, 6); // 3 in
    expect(errors).toEqual([]);
  });
});

test('typing the size of a new shape in the sketch uses the chosen unit', async ({ page }) => {
  const errors = await openApp(page);
  await page.locator('#unitSwitch button[data-unit="in"]').click();
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
  await typeCommand(page, 'rec');
  const p = await at(page, 0, 0); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  const q = await at(page, 30, 20); await page.mouse.move(q.x, q.y);
  await expect(page.locator('#hud em').first()).toHaveText('in');
  await page.keyboard.type('2'); await page.keyboard.press('Tab'); await page.keyboard.type('1'); await page.keyboard.press('Enter');
  const box = await page.evaluate(() => { const s = (window as any).__caddy.state.sketch, xs = Object.values(s.pts).map((p: any) => p.x), ys = Object.values(s.pts).map((p: any) => p.y); return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)]; });
  expect(box[0]).toBeCloseTo(50.8, 6); // 2 in
  expect(box[1]).toBeCloseTo(25.4, 6); // 1 in
  expect(errors).toEqual([]);
});
