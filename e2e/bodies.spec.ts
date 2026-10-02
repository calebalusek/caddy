// Body tools: Move / Rotate / Scale (with Copy and Lay a face down), Combine, Split body, Offset body.
import { expect, test, type Page } from '@playwright/test';
import { openApp, screenOf, settle, typeCommand } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
type Built = { bodies: { id: string; volume: number; box: number[][] }[]; features: { id: string; type: string; name: string; error: boolean; note: string }[] };
const built = (page: Page): Promise<Built> => page.evaluate(async () => {
  const c = (window as any).__caddy;
  await new Promise((r) => setTimeout(r, 450));
  await c.whenBuilt();
  return {
    bodies: c.baseBodies().map((b: any) => ({ id: b.id, volume: b.volume, box: b.box })),
    features: c.state.features.map((f: any) => ({ id: f.id, type: f.type, name: f.name, error: !!f.error, note: f.note || '' })),
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

test.describe('body tools', () => {
  test('Offset body: the only body is picked for you; 1 mm grows a 40x30x20 block to 42x32x22; shrink; New body keeps the original', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await typeCommand(page, 'ob');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#obChip')).toHaveText('Body1');
    await expect(page.locator('#f-distance')).toHaveValue('0'); // values start at 0
    await expect(page.locator('#okBtn')).toBeDisabled();
    await page.keyboard.type('1');
    let s = await built(page);
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.bodies).toHaveLength(1);
    expect(s.bodies[0].volume).toBeCloseTo(42 * 32 * 22, 3);
    expect(s.features.find((f) => f.type === 'offsetbody')).toMatchObject({ name: 'Offset1', error: false });
    // Ctrl+Z reopens it with its value; make it a shrink as a new body
    await page.keyboard.press('Control+z');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#f-distance')).toHaveValue('1');
    await page.locator('#f-distance').fill('-1');
    await page.locator('#f-distance').press('Tab');
    await page.locator('input[name="f-result"][value="New body"]').check({ force: true });
    await built(page);
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.bodies.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(s.bodies.find((b) => b.id === 'b1')!.volume).toBeCloseTo(40 * 30 * 20, 3);
    expect(s.bodies.find((b) => b.id === 'b2')!.volume).toBeCloseTo(38 * 28 * 18, 3);
    expect(errors).toEqual([]);
  });

  test('Move, Copy and Combine: a moved copy overlaps the block; Join makes one body and the used body leaves the Browser', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await typeCommand(page, 'mv');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#xfChip')).toHaveText('Body1');
    await expect(page.locator('#f-scale')).toHaveValue('100');
    await page.locator('#f-x').fill('20');
    await page.locator('#f-x').press('Tab');
    await page.locator('input[name="f-copy"][value="Copy"]').check({ force: true });
    await built(page);
    await page.locator('#okBtn').click();
    let s = await built(page);
    expect(s.bodies).toHaveLength(2);
    expect(s.bodies.find((b) => b.id === 'b1')!.box[0][0]).toBeCloseTo(0, 4);
    expect(s.bodies.find((b) => b.id !== 'b1')!.box[0][0]).toBeCloseTo(20, 4);

    await typeCommand(page, 'cb');
    await expect(dialog(page)).toBeVisible();
    await page.locator('#tree [data-ref="body:b1"].rowbtn').click();
    await page.locator('#tree [data-ref="body:b2"].rowbtn').click();
    await expect(page.locator('#cbTarget')).toHaveText('Body1');
    await expect(page.locator('#cbTools')).toHaveText('Body2');
    await built(page);
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.bodies).toHaveLength(1);
    expect(s.bodies[0].volume).toBeCloseTo(60 * 30 * 20, 3);
    await expect(page.locator('#tree [data-ref^="body:"].rowbtn')).toHaveCount(1); // the used body is gone from the Browser
    expect(errors).toEqual([]);
  });

  test('Lay a face down: clicking an end face puts the block on it, 40 tall', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await typeCommand(page, 'mv');
    await page.locator('input[name="f-mode"][value="Lay a face down"]').check({ force: true });
    await expect(page.locator('#xfFace')).toBeVisible();
    const p = await screenOf(page, [40, 15, 10]);
    await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
    await expect(page.locator('#xfFace')).toContainText('Flat face');
    await built(page);
    await page.locator('#okBtn').click();
    const s = await built(page);
    expect(s.bodies[0].box[0][2]).toBeCloseTo(0, 4);
    expect(s.bodies[0].box[1][2]).toBeCloseTo(40, 4);
    expect(errors).toEqual([]);
  });

  test('Split body: halves of a block, then Pins; the new body appears', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await typeCommand(page, 'mv');
    await page.locator('#f-x').fill('-20'); await page.locator('#f-x').press('Tab');
    await page.locator('#f-y').fill('-15'); await page.locator('#f-y').press('Tab');
    await page.locator('#f-z').fill('-10'); await page.locator('#f-z').press('Tab');
    await built(page);
    await page.locator('#okBtn').click();
    await built(page);
    await typeCommand(page, 'sp');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#spPlane')).toHaveClass(/picking/);
    await page.locator('#tree [data-ref="origin:XY"]').click();
    await expect(page.locator('#spPlane')).toHaveText('XY plane');
    await built(page);
    expect(await page.evaluate(() => (window as any).__caddy.shownBodies().length)).toBe(2); // live preview shows both halves
    await page.locator('input[name="f-keys"][value="Pins"]').check({ force: true });
    await page.locator('#f-keySize').fill('6'); await page.locator('#f-keySize').press('Tab');
    await page.locator('#f-keyDepth').fill('8'); await page.locator('#f-keyDepth').press('Tab');
    await page.locator('#f-clearance').fill('0.2'); await page.locator('#f-clearance').press('Tab');
    await built(page);
    await page.locator('#okBtn').click();
    const s = await built(page);
    expect(s.features.find((f) => f.type === 'split')).toMatchObject({ error: false });
    const vols = s.bodies.map((b) => b.volume).sort((a, b) => a - b);
    // two pins by default (the Pins count starts at 2)
    expect(vols[0]).toBeCloseTo(12000 - 2 * Math.PI * 3.2 * 3.2 * 8.2, 2);
    expect(vols[1]).toBeCloseTo(12000 + 2 * Math.PI * 9 * 8, 2);
    expect(errors).toEqual([]);
  });

  test('Hole presets fill the menu: M3 heat-set insert pocket, then a counterbored M4 screw', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await typeCommand(page, 'ho');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#f-d')).toHaveValue('0'); // Custom: values start at 0
    await page.locator('input[name="f-preset"][value="Heat-set insert"]').check({ force: true });
    await expect(page.locator('#f-d')).toHaveValue('4.2');
    await expect(page.locator('#f-depth')).toHaveValue('6');
    await expect(page.locator('input[name="f-extent"][value="Distance"]')).toBeChecked();
    await page.locator('input[name="f-preset"][value="Counterbored screw"]').check({ force: true });
    await page.locator('input[name="f-size"][value="4"]').check({ force: true });
    await expect(page.locator('#f-d')).toHaveValue('4.5');
    await expect(page.locator('#f-cbD')).toHaveValue('7.5');
    await expect(page.locator('input[name="f-type"][value="Counterbore"]')).toBeChecked();
    await expect(page.locator('input[name="f-extent"][value="Through all"]')).toBeChecked();
    expect(errors).toEqual([]);
  });

  test('on an iPad the new tools are in the toolbar and open their menus', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    await page.locator('#devSwitch button[data-device="tablet"]').click();
    for (const [name, chip] of [['Offset body', '#obChip'], ['Move/Turn', '#xfChip'], ['Split', '#spBody'], ['Combine', '#cbTarget']] as const) {
      await page.locator('#toolbar .tbtn', { hasText: name }).click();
      await expect(dialog(page)).toBeVisible();
      await expect(page.locator(chip)).toBeVisible();
      await page.keyboard.press('Escape');
    }
    expect(errors).toEqual([]);
  });
});
