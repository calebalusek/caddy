import { expect, test, type Page } from '@playwright/test';
import { openApp, pixelAt, screenOf, settle, typeCommand, type RGB } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const built = (page: Page) => page.evaluate(async () => {
  const c = (window as any).__caddy;
  await new Promise((r) => setTimeout(r, 150));
  await c.whenBuilt();
  return {
    bodies: c.shownBodies().map((b: any) => ({ id: b.id, volume: b.volume, box: b.box, curved: b.faces.filter((f: any) => !f.planar).length })),
    features: c.state.features.map((f: any) => ({ id: f.id, type: f.type, name: f.name, error: !!f.error, note: f.note || '', params: f.params })),
    docBodies: c.state.bodies.map((b: any) => b.name),
  };
});
const orangeish = (c: RGB): boolean => c[0] > c[2] + 40;
const blueish = (c: RGB): boolean => c[2] > c[0] + 30;
const dialog = (page: Page) => page.locator('section.dialog');

async function sketchRect(page: Page, plane: string, x: number, y: number, w: number, h: number): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator(`#tree [data-ref="origin:${plane}"]`).click();
  await settle(page);
  await typeCommand(page, 'rec');
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  const q = await at(page, x + w * 0.6, y + h * 0.6);
  await page.mouse.move(q.x, q.y);
  await page.keyboard.type(String(w)); await page.keyboard.press('Tab'); await page.keyboard.type(String(h)); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await typeCommand(page, 'fs');
}
async function plate(page: Page): Promise<void> {
  await sketchRect(page, 'XY', 0, 0, 60, 40);
  await typeCommand(page, 'ex');
  await page.keyboard.type('8');
  await page.keyboard.press('Enter');
  await typeCommand(page, 'home');
  await settle(page);
  await built(page);
}

test.describe('revolve', () => {
  test('washer: pick the Z axis in the view, angle starts at 360, live preview, exact volume; edit to 90°', async ({ page }) => {
    const errors = await openApp(page);
    await sketchRect(page, 'XZ', 10, 0, 10, 5);
    await typeCommand(page, 'home');
    await settle(page);
    await typeCommand(page, 'rev');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#selChip')).toHaveText('Profile in Sketch1');
    await expect(page.locator('#axisChip')).toHaveText('Click a sketch line, origin axis or body edge');
    await expect(page.locator('#f-angle')).toHaveValue('360'); // angles start at a full turn
    await expect(page.locator('#okBtn')).toBeDisabled();

    const z = await screenOf(page, [0, 0, 8]);
    await page.mouse.move(z.x + 60, z.y);
    await page.mouse.move(z.x, z.y); await page.mouse.move(z.x + 0.5, z.y);
    expect(orangeish(await pixelAt(page, z.x, z.y))).toBe(true); // hover = orange
    await page.mouse.click(z.x, z.y);
    await expect(page.locator('#axisChip')).toHaveText('Z axis');
    await page.mouse.move(z.x + 200, z.y + 100);
    expect(blueish(await pixelAt(page, z.x, z.y))).toBe(true); // picked = bold blue
    let r = await built(page); // live on the model
    expect(r.bodies[0].volume).toBeCloseTo(Math.PI * 300 * 5, 5);
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toHaveText('Revolve1: 360° around Z axis');
    r = await built(page);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0].volume).toBeCloseTo(4712.389, 2);
    expect(r.docBodies).toEqual(['Body1']);

    await page.locator('#timeline [data-ref="revolve:r1"]').dblclick();
    await expect(page.locator('#dlgTitle')).toHaveText('Edit Revolve1');
    await page.locator('#f-angle').fill('90');
    await page.keyboard.press('Enter');
    r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(1178.097, 2);
    expect(r.features.every((f: any) => !f.error)).toBe(true);
    expect(errors).toEqual([]);
  });

  test('a construction line in the sketch is used as the axis automatically; a profile across the axis explains itself', async ({ page }) => {
    await openApp(page);
    await typeCommand(page, 'sk');
    await page.locator('#tree [data-ref="origin:XZ"]').click();
    await settle(page);
    await typeCommand(page, 'rec');
    let p = await at(page, 10, 0); await page.mouse.click(p.x, p.y);
    p = await at(page, 16, 3); await page.mouse.move(p.x, p.y);
    await page.keyboard.type('10'); await page.keyboard.press('Tab'); await page.keyboard.type('5'); await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    // an axis line through the rectangle, marked as construction
    await page.evaluate(() => {
      const c = (window as any).__caddy, sk = c.state.sketch;
      const a = 'p' + ++sk.nid, b = 'p' + ++sk.nid;
      sk.pts[a] = { x: 15, y: -10 }; sk.pts[b] = { x: 15, y: 20 };
      sk.curves.push({ id: 'l' + ++sk.nid, type: 'line', p1: a, p2: b, construction: true });
    });
    await typeCommand(page, 'fs');
    await typeCommand(page, 'rev');
    await expect(page.locator('#axisChip')).toHaveText('A line in Sketch1');
    await built(page);
    await expect(page.locator('#opHint')).toContainText('crosses the axis');
  });
});

test.describe('hole', () => {
  test('click a face to place, diameter starts at 0, live preview, exact volume; markers are blue, orange on hover', async ({ page }) => {
    const errors = await openApp(page);
    await plate(page);
    await typeCommand(page, 'ho');
    await expect(page.locator('#holeChip')).toHaveText('Click a flat face or sketch point');
    await expect(page.locator('#f-d')).toHaveValue('0');
    const spot = await screenOf(page, [20, 20, 8]);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.click(spot.x, spot.y);
    await expect(page.locator('#holeChip')).toHaveText('1 hole placed');
    await page.keyboard.type('6');
    let r = await built(page);
    expect(60 * 40 * 8 - r.bodies[0].volume).toBeCloseTo(Math.PI * 9 * 8, 5); // 226.19, live

    // the marker: a blue ring the size of the hole; orange when hovered
    const ring = await screenOf(page, [23, 20, 8]);
    await page.mouse.move(ring.x + 200, ring.y - 150);
    let hits = 0;
    for (let d = -2; d <= 2; d++) if (blueish(await pixelAt(page, ring.x + d, ring.y))) hits++;
    expect(hits).toBeGreaterThan(0);
    await page.mouse.move(spot.x + 2, spot.y + 1);
    hits = 0;
    for (let d = -2; d <= 2; d++) if (orangeish(await pixelAt(page, ring.x + d, ring.y))) hits++;
    expect(hits).toBeGreaterThan(0);

    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toHaveText('Hole1: 1 × Ø6 mm simple through all');
    r = await built(page);
    expect(60 * 40 * 8 - r.bodies[0].volume).toBeCloseTo(226.195, 2);
    expect(r.bodies[0].curved).toBe(1);
    expect(errors).toEqual([]);
  });

  test('drag a marker to slide its hole along the face; click a marker to remove it; counterbore and blind depth', async ({ page }) => {
    await openApp(page);
    await plate(page);
    await typeCommand(page, 'ho');
    for (const q of [[15, 20, 8], [45, 20, 8]] as [number, number, number][]) { const s = await screenOf(page, q); await page.mouse.move(s.x, s.y); await page.mouse.click(s.x, s.y); }
    await expect(page.locator('#holeChip')).toHaveText('2 holes placed');
    await page.keyboard.type('6');
    await built(page);

    const from = await screenOf(page, [45, 20, 8]), to = await screenOf(page, [50, 30, 8]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
    await page.mouse.move(to.x, to.y, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('#msg')).toContainText('Hole moved');
    await expect(page.locator('#holeChip')).toHaveText('2 holes placed'); // moved, not removed
    const moved = await page.evaluate(() => (window as any).__caddy.state.active.params.pts[1].p);
    expect(moved[0]).toBeCloseTo(50, 0); expect(moved[1]).toBeCloseTo(30, 0); expect(moved[2]).toBeCloseTo(8, 6);

    const first = await screenOf(page, [15, 20, 8]);
    await page.mouse.move(first.x, first.y);
    await page.mouse.click(first.x, first.y); // a click (no drag) on a hole removes it
    await expect(page.locator('#holeChip')).toHaveText('1 hole placed');

    await page.locator('input[name="f-type"][value="Counterbore"]').check({ force: true });
    await expect(page.locator('[data-field="cbD"]')).toBeVisible();
    await expect(page.locator('[data-field="csD"]')).toBeHidden();
    await page.locator('#f-cbD').fill('11');
    await page.locator('#f-cbDepth').fill('3');
    await page.locator('input[name="f-extent"][value="Distance"]').check({ force: true });
    await page.locator('#f-depth').fill('5');
    await page.locator('#okBtn').click();
    const r = await built(page);
    expect(r.features[2].error).toBe(false);
    expect(60 * 40 * 8 - r.bodies[0].volume).toBeCloseTo(Math.PI * 5.5 * 5.5 * 3 + Math.PI * 9 * 2, 5);
  });

  test('pick a sketch in the Browser to put holes on its circle centers; they follow the sketch', async ({ page }) => {
    await openApp(page);
    await plate(page);
    // a sketch on a plane at the top of the plate with two circles
    await typeCommand(page, 'pl');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    await page.keyboard.type('8'); await page.keyboard.press('Enter');
    await typeCommand(page, 'sk');
    await page.locator('#tree .rowbtn[data-ref="plane:p1"]').click();
    await settle(page);
    for (const [x, y] of [[15, 20], [45, 20]]) {
      await typeCommand(page, 'c');
      let p = await at(page, x, y); await page.mouse.click(p.x, p.y);
      p = await at(page, x + 3, y + 1); await page.mouse.move(p.x, p.y);
      await page.keyboard.type('4'); await page.keyboard.press('Enter');
      await page.keyboard.press('Escape');
    }
    await typeCommand(page, 'fs');
    await typeCommand(page, 'ho');
    await page.locator('#tree .rowbtn[data-ref="sketch:s2"]').click(); // standing rule 2
    await expect(page.locator('#msg')).toHaveText("2 holes placed on Sketch2's circle centers");
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    const r = await built(page);
    expect(60 * 40 * 8 - r.bodies[0].volume).toBeCloseTo(2 * Math.PI * 6.25 * 8, 5);
  });
});
