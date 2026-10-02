// Sketch tools added for 3D-printed parts: Slot, corner Fillet / Chamfer, Mirror and Project body edges.
import { expect, test, type Page } from '@playwright/test';
import { openApp, settle, typeCommand } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const curves = (page: Page) => page.evaluate(() => (window as any).__caddy.state.sketch.curves.map((c: any) => c.type) as string[]);
const click = async (page: Page, x: number, y: number): Promise<void> => { const p = await at(page, x, y); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); };

async function startSketch(page: Page): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
}
async function rectangle(page: Page, x: number, y: number, w: number, h: number): Promise<void> {
  await typeCommand(page, 'rec');
  await click(page, x, y);
  const q = await at(page, x + w * 0.6, y + h * 0.6); await page.mouse.move(q.x, q.y);
  await page.keyboard.type(String(w)); await page.keyboard.press('Tab'); await page.keyboard.type(String(h)); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
}

test.describe('sketch tools for printed parts', () => {
  test('Slot: two centers, then a width; makes two lines and two half circles', async ({ page }) => {
    const errors = await openApp(page);
    await startSketch(page);
    await typeCommand(page, 'slo');
    await click(page, 0, 0);
    await click(page, 20, 0);
    await page.keyboard.type('6'); await page.keyboard.press('Enter');
    expect((await curves(page)).sort()).toEqual(['arc', 'arc', 'line', 'line']);
    await page.keyboard.press('Escape');
    // it is a real closed profile: extrude it
    await typeCommand(page, 'fs');
    await typeCommand(page, 'ex');
    await page.keyboard.type('5'); await page.keyboard.press('Enter');
    await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 450)); await (window as any).__caddy.whenBuilt(); });
    const v = await page.evaluate(() => (window as any).__caddy.baseBodies()[0].volume as number);
    expect(v).toBeCloseTo((20 * 6 + Math.PI * 9) * 5, 2);
    expect(errors).toEqual([]);
  });

  test('Corner fillet and chamfer: type a size, click corners', async ({ page }) => {
    const errors = await openApp(page);
    await startSketch(page);
    await rectangle(page, 0, 0, 40, 20);
    await typeCommand(page, 'sfi');
    await page.keyboard.type('5'); await page.keyboard.press('Enter');
    await click(page, 40, 20);
    expect((await curves(page)).filter((t) => t === 'arc')).toHaveLength(1);
    await click(page, 0, 20);
    expect((await curves(page)).filter((t) => t === 'arc')).toHaveLength(2); // the same size works for more corners
    await page.keyboard.press('Escape');
    await typeCommand(page, 'sch');
    await page.keyboard.type('3'); await page.keyboard.press('Enter');
    await click(page, 0, 0);
    expect((await curves(page)).filter((t) => t === 'line')).toHaveLength(4 + 1); // a bevel line is added
    // too big says so and changes nothing
    await page.keyboard.press('Escape');
    await typeCommand(page, 'sfi');
    await page.keyboard.type('50'); await page.keyboard.press('Enter');
    await click(page, 40, 0);
    await expect(page.locator('#msg')).toContainText('too big');
    expect(await curves(page)).toHaveLength(7); // 4 lines + 2 arcs + the bevel line: unchanged
    expect(errors).toEqual([]);
  });

  test('Mirror: pick a shape, press Enter, click the line to mirror across', async ({ page }) => {
    const errors = await openApp(page);
    await startSketch(page);
    await typeCommand(page, 'l');
    await click(page, 0, 0);
    await click(page, 0, 14);
    await page.keyboard.press('Escape');
    await rectangle(page, 8, 0, 12, 8);
    await typeCommand(page, 'smi');
    await click(page, 14, 0); // one click takes the whole rectangle
    await page.keyboard.press('Enter');
    await click(page, 0, 7);
    expect(await curves(page)).toHaveLength(1 + 4 + 4);
    expect(errors).toEqual([]);
  });

  test('Project: hover a body edge, click it, and it is in the sketch', async ({ page }) => {
    const errors = await openApp(page);
    await startSketch(page);
    await rectangle(page, 0, 0, 40, 30);
    await typeCommand(page, 'fs');
    await typeCommand(page, 'ex');
    await page.keyboard.type('10'); await page.keyboard.press('Enter');
    await page.evaluate(async () => { await new Promise((r) => setTimeout(r, 450)); await (window as any).__caddy.whenBuilt(); });
    await startSketch(page);
    await typeCommand(page, 'prj');
    await click(page, 20, 0);
    expect(await curves(page)).toEqual(['line']);
    await click(page, 20, 0); // again: it is already there
    await expect(page.locator('#msg')).toContainText('already');
    expect(await curves(page)).toEqual(['line']);
    expect(errors).toEqual([]);
  });
});
