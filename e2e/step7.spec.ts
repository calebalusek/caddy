import { expect, test, type Page } from '@playwright/test';
import { openApp, screenOf, settle, typeCommand } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const built = (page: Page) => page.evaluate(async () => {
  const c = (window as any).__caddy;
  await new Promise((r) => setTimeout(r, 450));
  await c.whenBuilt();
  return {
    bodies: c.shownBodies().map((b: any) => ({ id: b.id, volume: b.volume, faces: b.faces.length })),
    features: c.state.features.map((f: any) => ({ id: f.id, type: f.type, name: f.name, error: !!f.error, note: f.note || '', params: f.params })),
  };
});
const dialog = (page: Page) => page.locator('section.dialog');

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

test.describe('shell', () => {
  test('click the top face, type 2: open box 7152; Outside 8912; closed hollow from the Browser 9024; too thick is explained', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    const top = await screenOf(page, [20, 15, 20]);
    await page.mouse.move(top.x, top.y); await page.mouse.click(top.x, top.y);
    await typeCommand(page, 'sh');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#shellChip')).toHaveText('Body1: 1 face open');
    await expect(page.locator('#f-thickness')).toHaveValue('0'); // values start at 0
    await expect(page.locator('#okBtn')).toBeDisabled();
    await page.keyboard.type('2');
    let s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(7152, 4); // live preview
    await page.locator('input[name="f-direction"][value="Outside"]').check({ force: true });
    s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(8912, 3);
    await page.locator('input[name="f-direction"][value="Inside"]').check({ force: true });
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.features.find((f: any) => f.type === 'shell')).toMatchObject({ name: 'Shell1', error: false });
    expect(s.bodies[0].volume).toBeCloseTo(7152, 4);

    // Ctrl+Z reopens it; click the open face again to remove it (closed hollow)
    await page.keyboard.press('Control+z');
    await expect(dialog(page)).toBeVisible();
    await page.mouse.move(top.x + 30, top.y + 5); await page.mouse.move(top.x, top.y);
    await page.mouse.click(top.x, top.y);
    await expect(page.locator('#shellChip')).toHaveText('Body1: closed hollow');
    s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(9024, 4);
    await page.locator('#f-thickness').fill('25');
    s = await built(page);
    expect(s.features.find((f: any) => f.type === 'shell')).toBeTruthy();
    await expect(page.locator('#h-thickness')).toHaveText('That thickness is too big for this body');
    await page.locator('#f-thickness').fill('2');
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(9024, 4);
    expect(errors).toEqual([]);
  });
});

async function plateWithHole(page: Page): Promise<void> {
  await box(page, 60, 40, 8);
  await typeCommand(page, 'ho');
  const p = await screenOf(page, [15, 12, 8]);
  await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  await page.keyboard.type('6'); await page.keyboard.press('Enter');
  await built(page);
}
const PLATE = 60 * 40 * 8, HOLE = Math.PI * 9 * 8;

test.describe('pattern', () => {
  test('pick the hole in History, 3 × 2 grid, drag arrow, edit, undo; circular pattern from a sketch circle', async ({ page }) => {
    const errors = await openApp(page);
    await plateWithHole(page);
    await typeCommand(page, 'ptr');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#copyChip')).toHaveText('Click a face of the feature to copy');
    await expect(page.locator('#okBtn')).toBeDisabled();
    await page.locator('#timeline [data-ref="hole:h1"]').click(); // standing rule 2
    await expect(page.locator('#copyChip')).toHaveText('Hole1');
    await expect(page.locator('#f-n1')).toHaveValue('2'); // counts start at 2
    await expect(page.locator('#f-d1')).toHaveValue('0'); // values start at 0
    await expect(page.locator('#h-d1')).toHaveText('Spacing 0 puts every copy on top of the original');
    await page.locator('#f-n1').fill('3');
    await page.locator('#f-d1').fill('15');
    await page.locator('input[name="f-dir2"][value="Y"]').check({ force: true });
    await page.locator('#f-d2').fill('12');
    let s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(PLATE - 6 * HOLE, 4); // live: six holes
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.features.find((f: any) => f.type === 'pattern')).toMatchObject({ name: 'Pattern1', error: false });
    expect(s.bodies[0].volume).toBeCloseTo(PLATE - 6 * HOLE, 4);

    // Ctrl+Z reopens it with the values; make it a single row
    await page.keyboard.press('Control+z');
    await expect(page.locator('#f-n1')).toHaveValue('3');
    await page.locator('input[name="f-dir2"][value="None"]').check({ force: true });
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(PLATE - 3 * HOLE, 4);

    // circular: switch the type; the first copy is on a circle of radius 15 around the plate center
    await page.locator('#timeline [data-ref="pattern:pt1"]').dblclick();
    await page.locator('input[name="f-ptype"][value="Circular"]').check({ force: true });
    await expect(page.locator('#f-count')).toHaveValue('4');
    await expect(page.locator('#f-radius')).toHaveValue('0');
    await page.locator('#f-count').fill('6');
    await page.locator('input[name="f-axis"][value="Pick"]').check({ force: true });
    await page.evaluate(() => { const A = (window as any).__caddy.state.active; A.params.axC = [30, 20, 0]; A.params.axD = [0, 0, 1]; });
    await page.locator('#f-radius').fill('15');
    s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(PLATE - 6 * HOLE, 4); // the original moved onto the circle
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.features.every((f: any) => !f.error)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('bodies: copy a body in the Browser into new bodies; deleting the pattern removes them', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 20, 20, 5);
    await typeCommand(page, 'ptr');
    await page.locator('input[name="f-what"][value="Bodies"]').check({ force: true });
    await page.locator('#tree .rowbtn[data-ref="body:b1"]').click();
    await expect(page.locator('#copyChip')).toHaveText('Body1');
    await page.locator('#f-d1').fill('30');
    await page.locator('#f-n1').fill('3');
    await page.locator('#okBtn').click();
    let s = await built(page);
    expect(s.bodies).toHaveLength(3);
    s.bodies.forEach((b: any) => expect(b.volume).toBeCloseTo(2000, 4));
    await page.evaluate(() => { const c = (window as any).__caddy; c.state.treeSel = null; });
    await page.locator('#timeline [data-ref="pattern:pt1"]').click({ button: 'right' });
    await page.getByText('Delete', { exact: false }).first().click();
    s = await built(page);
    expect(s.bodies).toHaveLength(1);
    expect(errors).toEqual([]);
  });
});
