import { expect, test, type Page } from '@playwright/test';
import { openApp, pixelAt, screenOf, settle, typeCommand, type RGB } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const built = (page: Page) => page.evaluate(async () => {
  const c = (window as any).__caddy;
  await new Promise((r) => setTimeout(r, 450));
  await c.whenBuilt();
  return {
    bodies: c.shownBodies().map((b: any) => ({ id: b.id, volume: b.volume, box: b.box, faces: b.faces.length })),
    features: c.state.features.map((f: any) => ({ id: f.id, type: f.type, name: f.name, error: !!f.error, note: f.note || '', params: f.params })),
  };
});
const orangeish = (c: RGB): boolean => c[0] > c[2] + 40;
const dialog = (page: Page) => page.locator('section.dialog');

/** A path on the Front plane (up 50, then across 50) and a 10 × 10 square profile on the Top plane. */
async function pathAndProfile(page: Page): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XZ"]').click();
  await settle(page);
  await typeCommand(page, 'l');
  for (const [x, y] of [[0, 0], [0, 50], [50, 50]]) { const p = await at(page, x, y); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y); }
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await typeCommand(page, 'fs');
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
  await typeCommand(page, 'rec');
  let p = await at(page, -5, -5); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  p = await at(page, 3, 3); await page.mouse.move(p.x, p.y);
  await page.keyboard.type('10'); await page.keyboard.press('Tab'); await page.keyboard.type('10'); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await typeCommand(page, 'fs');
  await typeCommand(page, 'home');
  await settle(page);
}

const RHO = (10.5 * (1 + Math.SQRT1_2)) / 2;
const ROUND_L = 100 * (2 * (50 - RHO) + (Math.PI / 2) * RHO);

test.describe('sweep', () => {
  test('profile + path: orange chain on hover, live preview, exact volumes for both corner styles, Ctrl+Z reopens it', async ({ page }) => {
    const errors = await openApp(page);
    await pathAndProfile(page);
    await typeCommand(page, 'sw');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#selChip')).toHaveText('Profile in Sketch2');
    await expect(page.locator('#pathChip')).toHaveText('Click a sketch line, arc or circle');
    await expect(page.locator('#pathChip')).toHaveClass(/picking/); // the path box has the next click
    await expect(page.locator('#okBtn')).toBeDisabled();

    // hover the path: the whole chain turns orange
    const a = await screenOf(page, [0, 0, 25]), b = await screenOf(page, [25, 0, 50]);
    await page.mouse.move(a.x + 40, a.y); await page.mouse.move(a.x, a.y); await page.mouse.move(a.x + 0.5, a.y);
    expect(orangeish(await pixelAt(page, a.x, a.y))).toBe(true);
    await page.mouse.click(b.x, b.y);
    await expect(page.locator('#pathChip')).toHaveText('2 curves in Sketch1');
    await expect(page.locator('#okBtn')).toBeEnabled();
    await expect(page.locator('input[name="f-corners"][value="Round"]')).toBeChecked(); // Round is the default
    await expect(page.locator('input[name="f-operation"][value="New body"]')).toBeChecked();
    let s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(ROUND_L, 3); // live preview on the real body

    await page.locator('input[name="f-corners"][value="Mitered"]').check({ force: true });
    s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(10000, 4);
    await page.keyboard.press('Enter');
    s = await built(page);
    expect(s.features.find((f: any) => f.type === 'sweep')).toMatchObject({ name: 'Sweep1', error: false, params: { orientation: 'Perpendicular', corners: 'Mitered', operation: 'New body' } });
    expect(s.bodies).toHaveLength(1);
    expect(s.bodies[0].volume).toBeCloseTo(10000, 4);
    expect(s.bodies[0].box[1].map((v: number) => +v.toFixed(3))).toEqual([50, 5, 55]);

    // Ctrl+Z reopens the menu with the values still in it; switch to Round and finish again
    await page.keyboard.press('Control+z');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('input[name="f-corners"][value="Mitered"]')).toBeChecked();
    await page.locator('input[name="f-corners"][value="Round"]').check({ force: true });
    await page.keyboard.press('Enter');
    s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(ROUND_L, 3);
    expect(s.features.filter((f: any) => f.type === 'sweep')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  test('pick from the Browser (standing rule 2); a deleted path sketch leaves a clear note', async ({ page }) => {
    const errors = await openApp(page);
    await pathAndProfile(page);
    await typeCommand(page, 'sw');
    await page.locator('#tree .rowbtn[data-ref="sketch:s1"]').click();
    await expect(page.locator('#pathChip')).toHaveText('2 curves in Sketch1');
    await expect(page.locator('#msg')).toHaveText('Path set from Sketch1');
    await page.locator('#okBtn').click();
    const s = await built(page);
    expect(s.features.find((f: any) => f.type === 'sweep')!.error).toBe(false);
    expect(s.bodies[0].volume).toBeCloseTo(ROUND_L, 3);
    await page.evaluate(() => { const c = (window as any).__caddy; c.state.features.splice(c.state.features.findIndex((f: any) => f.id === 's1'), 1); c.regenerate(); });
    const t = await built(page);
    expect(t.features.find((f: any) => f.type === 'sweep')!.note).toBe('its path sketch is gone');
    expect(errors).toEqual([]);
  });
});
