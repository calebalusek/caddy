// Wall-thickness check and Measure.
import { expect, test, type Page } from '@playwright/test';
import { openApp, screenOf, settle, typeCommand } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const built = (page: Page) => page.evaluate(async () => { await new Promise((r) => setTimeout(r, 450)); await (window as any).__caddy.whenBuilt(); });

async function box(page: Page, w: number, d: number, h: number): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
  await typeCommand(page, 'rec');
  const p = await at(page, 0, 0); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  const q = await at(page, w * 0.6, d * 0.6); await page.mouse.move(q.x, q.y);
  await page.keyboard.type(String(w)); await page.keyboard.press('Tab'); await page.keyboard.type(String(d)); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await typeCommand(page, 'fs');
  await typeCommand(page, 'ex');
  await page.keyboard.type(String(h)); await page.keyboard.press('Enter');
  await typeCommand(page, 'home');
  await settle(page);
  await built(page);
}

test.describe('wall thickness and measure', () => {
  test('Wall thickness: starts at 0 and names the thinnest wall; a limit flags the thin faces; nothing is added to the History', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await typeCommand(page, 'wt');
    await expect(page.locator('#f-min')).toHaveValue('0');
    await expect(page.locator('#h-min')).toContainText('Thinnest wall: 20 mm');
    await page.locator('#f-min').fill('25');
    await expect(page.locator('#h-min')).toContainText('2400 mm² too thin'); // top and bottom: 2 x 40 x 30
    await page.locator('#f-min').fill('10');
    await expect(page.locator('#h-min')).toContainText('No wall is thinner');
    await page.locator('#okBtn').click();
    expect(await page.evaluate(() => (window as any).__caddy.state.features.map((f: any) => f.type))).toEqual(['sketch', 'extrude']);
    expect(errors).toEqual([]);
  });

  test('Measure: two corners give the distance and the axis parts; a third click starts over; weight follows material and infill', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await typeCommand(page, 'me');
    await expect(page.locator('#mBody')).toContainText('24 cm³');
    await expect(page.locator('#mWeight')).toContainText('PLA 29.8 g if solid');
    const a = await screenOf(page, [0, 0, 20]), b = await screenOf(page, [40, 0, 20]);
    await page.mouse.move(a.x, a.y); await page.mouse.click(a.x, a.y);
    await expect(page.locator('#mA')).toContainText('A: 0, 0, 20');
    await page.mouse.move(b.x, b.y); await page.mouse.click(b.x, b.y);
    await expect(page.locator('#mB')).toContainText('B: 40, 0, 20');
    await expect(page.locator('#mDist')).toContainText('Distance 40 mm');
    await expect(page.locator('#mDelta')).toContainText('ΔX 40 · ΔY 0 · ΔZ 0');
    // a third click begins a new measurement
    await page.mouse.move(a.x, a.y); await page.mouse.click(a.x, a.y);
    await expect(page.locator('#mB')).toContainText('Click the second point');
    // material and infill
    await page.locator('input[name="f-material"][value="PETG"]').check({ force: true });
    await page.locator('#f-infill').fill('20');
    await expect(page.locator('#mWeight')).toContainText('PETG 30.5 g if solid');
    await expect(page.locator('#mWeight')).toContainText('about 6.1 g at 20 % infill');
    expect(errors).toEqual([]);
  });

  test('Measure: parallel flat faces report the gap between them', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await typeCommand(page, 'me');
    const a = await screenOf(page, [10, 10, 20]), b = await screenOf(page, [20, 0, 10]); // the top face, then the front face
    await page.mouse.move(a.x, a.y); await page.mouse.click(a.x, a.y);
    await expect(page.locator('#mItem')).toContainText('Flat face: 1200 mm²');
    await page.mouse.move(b.x, b.y); await page.mouse.click(b.x, b.y);
    await expect(page.locator('#mItem')).toContainText('Flat face: 800 mm²');
    expect(errors).toEqual([]);
  });
});
