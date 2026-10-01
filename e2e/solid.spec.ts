import { expect, test, type Page } from '@playwright/test';
import { openApp, pixelAt, screenOf, settle, typeCommand, type RGB } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const built = (page: Page) => page.evaluate(async () => {
  const c = (window as any).__caddy;
  await new Promise((r) => setTimeout(r, 120)); // let debounced previews start
  await c.whenBuilt();
  return {
    bodies: c.shownBodies().map((b: any) => ({ id: b.id, volume: b.volume, box: b.box, faces: b.faces.length, surfs: b.faces.map((f: any) => f.surf), curved: b.faces.filter((f: any) => !f.planar).length })),
    features: c.state.features.map((f: any) => ({ id: f.id, type: f.type, name: f.name, error: !!f.error, note: f.note || '', bodyId: f.bodyId, params: f.params })),
    docBodies: c.state.bodies.map((b: any) => b.name),
    selection: c.state.selection.map((s: any) => s.kind),
  };
});
const orangeish = (c: RGB): boolean => c[0] > c[2] + 40;
const blueish = (c: RGB): boolean => c[2] > c[0] + 30;
const dialog = (page: Page) => page.locator('section.dialog');

/** Sketch a w × h rectangle from the origin on the XY plane and finish the sketch. */
async function sketchRect(page: Page, w: number, h: number, x = 0, y = 0): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
  await typeCommand(page, 'rec');
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y);
  await page.mouse.click(p.x, p.y);
  const q = await at(page, x + w * 0.6, y + h * 0.6);
  await page.mouse.move(q.x, q.y);
  await page.keyboard.type(String(w));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(h));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await typeCommand(page, 'fs');
}
async function box(page: Page, w = 40, d = 30, h = 20): Promise<void> {
  await sketchRect(page, w, d);
  await typeCommand(page, 'ex');
  await page.keyboard.type(String(h));
  await page.keyboard.press('Enter');
  await typeCommand(page, 'home');
  await settle(page);
}

test.describe('extrude', () => {
  test('the core loop: sketch → extrude; value starts at 0, exact volume, body in Browser and History', async ({ page }) => {
    const errors = await openApp(page);
    await sketchRect(page, 40, 30);
    await typeCommand(page, 'ex');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#selChip')).toHaveText('Profile in Sketch1');
    await expect(page.locator('#f-distance')).toBeFocused();
    await expect(page.locator('#f-distance')).toHaveValue('0'); // standing rule 3
    await expect(page.locator('input[name="f-operation"][value="New body"]')).toBeChecked();
    await page.keyboard.type('20');
    await expect(page.locator('#dim')).toHaveText('20 mm');
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toHaveText('Extrude1 extruded 20 mm as Body1');
    const r = await built(page);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0].volume).toBeCloseTo(24000, 6);
    expect(r.bodies[0].box).toEqual([[0, 0, 0], [40, 30, 20]]);
    await expect(page.locator('#tree [data-ref="body:b1"] .nm').first()).toHaveText('Body1');
    await expect(page.locator('#timeline .tl-item')).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test('the body is drawn in the approved satin grey with near-black edges (light and dark)', async ({ page }) => {
    await openApp(page);
    await box(page);
    const face = await screenOf(page, [20, 15, 20]); // middle of the top face
    const c = await pixelAt(page, face.x, face.y);
    // SPEC: light mode face tones run from #3C3935 (facing away) to #898379 (facing the light)
    expect(c[0]).toBeGreaterThan(0x3c - 6); expect(c[0]).toBeLessThan(0x89 + 10);
    expect(c[0]).toBeGreaterThanOrEqual(c[2]); // warm grey: red ≥ blue
    const edge = await screenOf(page, [40, 30, 10]); // a vertical edge at the corner nearest the camera
    let darkest = 255;
    for (let dx = -2; dx <= 2; dx++) { const p = await pixelAt(page, edge.x + dx, edge.y); darkest = Math.min(darkest, Math.max(...p)); }
    expect(darkest).toBeLessThan(0x3c); // a crisp dark edge line
    await page.locator('#themeBtn').click();
    await page.waitForTimeout(150);
    const d = await pixelAt(page, face.x, face.y);
    // dark mode: #5F6367 … #DAE2EC, a cool steel grey
    expect(d[0]).toBeGreaterThan(0x5f - 6); expect(d[2]).toBeLessThanOrEqual(0xec + 4);
    expect(d[2]).toBeGreaterThanOrEqual(d[0]);
  });

  test('sketch on top + extrude down switches to Cut automatically; editing the sketch updates the cut', async ({ page }) => {
    await openApp(page);
    await box(page);
    // a plane on the top of the box, then a pocket sketch on it
    await typeCommand(page, 'pl');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await typeCommand(page, 'sk');
    await page.locator('#tree .rowbtn[data-ref="plane:p1"]').click();
    await settle(page);
    await typeCommand(page, 'rec');
    const p = await at(page, 10, 10);
    await page.mouse.click(p.x, p.y);
    const q = await at(page, 22, 16);
    await page.mouse.move(q.x, q.y);
    await page.keyboard.type('20'); await page.keyboard.press('Tab'); await page.keyboard.type('10'); await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await typeCommand(page, 'fs');
    await typeCommand(page, 'ex');
    await page.keyboard.type('-8');
    await expect(page.locator('input[name="f-operation"][value="Cut"]')).toBeChecked();
    await expect(page.locator('#opHint')).toHaveText('Picked automatically from where the extrude goes');
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toHaveText('Cut2 cut 8 mm');
    let r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(24000 - 20 * 10 * 8, 6);

    // upward instead: Join
    await page.locator('#timeline [data-ref="extrude:e2"]').dblclick();
    await expect(page.locator('#dlgTitle')).toHaveText('Edit Cut2');
    await expect(page.locator('input[name="f-operation"][value="Join"]')).toBeDisabled(); // fixed after creation
    await page.locator('#f-distance').fill('-5');
    await page.keyboard.press('Enter');
    r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(24000 - 20 * 10 * 5, 6);

    // edit the pocket sketch: the cut follows (parametric)
    await page.locator('#timeline [data-ref="sketch:s2"]').dblclick();
    await settle(page);
    await page.locator('.dimlbl', { hasText: '20' }).dblclick();
    await page.locator('#dimInput').fill('12');
    await page.keyboard.press('Enter');
    await page.locator('.skbar .skfinish').click();
    r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(24000 - 12 * 10 * 5, 6);
    expect(r.features.find((f: any) => f.id === 'e2').error).toBe(false);
  });

  test('plate with a hole: one region, true cylinder, exact volume', async ({ page }) => {
    await openApp(page);
    await typeCommand(page, 'sk');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    await settle(page);
    await typeCommand(page, 'rec');
    let p = await at(page, 0, 0); await page.mouse.click(p.x, p.y);
    p = await at(page, 30, 20); await page.mouse.move(p.x, p.y);
    await page.keyboard.type('60'); await page.keyboard.press('Tab'); await page.keyboard.type('40'); await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await typeCommand(page, 'c');
    p = await at(page, 20, 20); await page.mouse.click(p.x, p.y);
    p = await at(page, 24, 21); await page.mouse.move(p.x, p.y);
    await page.keyboard.type('6'); await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await typeCommand(page, 'fs');
    await typeCommand(page, 'ex');
    await page.keyboard.type('8');
    await page.keyboard.press('Enter');
    const r = await built(page);
    expect(60 * 40 * 8 - r.bodies[0].volume).toBeCloseTo(Math.PI * 9 * 8, 6); // 226.19
    expect(r.bodies[0].curved).toBe(1);
  });

  test('press-pull a face: select it first, then EX; hover orange, selected blue', async ({ page }) => {
    await openApp(page);
    await box(page);
    const top = await screenOf(page, [12, 9, 20]);
    await page.mouse.move(top.x + 300, top.y - 250);
    const plain = await pixelAt(page, top.x, top.y);
    await page.mouse.move(top.x, top.y); await page.mouse.move(top.x + 1, top.y);
    const hov = await pixelAt(page, top.x, top.y);
    expect(orangeish(hov)).toBe(true);
    expect(hov[0] - hov[2]).toBeGreaterThan(plain[0] - plain[2] + 30);
    await page.mouse.click(top.x, top.y);
    await page.mouse.move(top.x + 300, top.y - 250);
    expect((await built(page)).selection).toEqual(['face']);
    expect(blueish(await pixelAt(page, top.x, top.y))).toBe(true);
    await expect(page.locator('#msg')).toContainText('1 face selected. Ex extrudes it');

    await typeCommand(page, 'ex');
    await expect(page.locator('#selChip')).toHaveText('Face of Body1');
    await page.keyboard.type('5');
    await expect(page.locator('input[name="f-operation"][value="Join"]')).toBeChecked();
    await page.keyboard.press('Enter');
    let r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(40 * 30 * 25, 6);
    expect(r.docBodies).toEqual(['Body1']); // joined, not a second body

    await page.keyboard.press('Control+z'); // back into the tool
    await expect(page.locator('#dlgTitle')).toHaveText('Edit Extrude2');
    await page.keyboard.press('Control+z'); // and out of it: the press-pull is gone
    await expect(dialog(page)).toBeHidden();
    r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(24000, 6);
    expect(r.features).toHaveLength(2);
  });

  test('pick the profile from the Browser while Extrude is open (standing rule 2)', async ({ page }) => {
    await openApp(page);
    await sketchRect(page, 10, 10);
    await sketchRect(page, 30, 20, 50, 0);
    await typeCommand(page, 'ex');
    await expect(page.locator('#selChip')).toHaveText('Profile in Sketch2'); // the last sketch is offered first
    await page.locator('#tree .rowbtn[data-ref="sketch:s1"]').click();
    await expect(page.locator('#selChip')).toHaveText('Profile in Sketch1');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    const r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(500, 6);
  });
});

test.describe('fillet and chamfer', () => {
  test('select an edge (orange hover, bold blue selected), F, radius starts at 0, live preview, exact volume', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    const e = await screenOf(page, [40, 15, 20]); // middle of the top right edge
    await page.mouse.move(e.x + 200, e.y - 200);
    await page.mouse.move(e.x, e.y); await page.mouse.move(e.x + 1, e.y);
    expect(orangeish(await pixelAt(page, e.x, e.y))).toBe(true);
    await page.mouse.click(e.x, e.y);
    await page.mouse.move(e.x + 200, e.y - 200);
    expect((await built(page)).selection).toEqual(['edge']);
    // a band about 5 px wide, not a hairline
    let blue = 0;
    for (let d = -4; d <= 4; d++) if (blueish(await pixelAt(page, e.x + d, e.y))) blue++;
    expect(blue).toBeGreaterThanOrEqual(4);
    await expect(page.locator('#msg')).toContainText('1 edge selected. F fillets, cha chamfers');

    await typeCommand(page, 'f');
    await expect(page.locator('#edgeChip')).toHaveText('1 edge selected');
    await expect(page.locator('#f-r')).toBeFocused();
    await expect(page.locator('#f-r')).toHaveValue('0');
    await expect(page.locator('#okBtn')).toBeDisabled();
    await page.keyboard.type('5');
    let r = await built(page); // live preview on the real body
    expect(24000 - r.bodies[0].volume).toBeCloseTo((25 - (25 * Math.PI) / 4) * 30, 6);
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toHaveText('Fillet1: 1 edge, R5 mm');
    r = await built(page);
    expect(24000 - r.bodies[0].volume).toBeCloseTo((25 - (25 * Math.PI) / 4) * 30, 6);
    expect(r.bodies[0].surfs).toContain('F:f1:0');
    expect(r.features.map((f: any) => f.name)).toEqual(['Sketch1', 'Extrude1', 'Fillet1']);
    expect(errors).toEqual([]);
  });

  test('in the menu: click edges to add/remove, click a face for all its edges; chamfer volume exact', async ({ page }) => {
    await openApp(page);
    await box(page);
    await typeCommand(page, 'cha');
    await expect(page.locator('#edgeChip')).toHaveText('Click the edges to bevel');
    const e1 = await screenOf(page, [40, 15, 20]);
    await page.mouse.move(e1.x, e1.y);
    await page.mouse.click(e1.x, e1.y);
    await expect(page.locator('#edgeChip')).toHaveText('1 edge selected');
    await page.mouse.click(e1.x, e1.y); // again removes it
    await expect(page.locator('#edgeChip')).toHaveText('Click the edges to bevel');
    const top = await screenOf(page, [15, 12, 20]);
    await page.mouse.move(top.x, top.y);
    await page.mouse.click(top.x, top.y);
    await expect(page.locator('#edgeChip')).toHaveText('4 edges selected');
    await expect(page.locator('#msg')).toHaveText("Added the face's 4 edges");
    await page.keyboard.type('2');
    await page.keyboard.press('Enter');
    const r = await built(page);
    // four 2 mm chamfers around the top: prisms along each edge minus the doubly-counted corners
    const removed = 2 * (40 + 30) * 2 - 4 * (8 / 3);
    expect(24000 - r.bodies[0].volume).toBeCloseTo(removed, 5);
    expect(r.features[2].name).toBe('Chamfer1');
  });

  test('a fillet that is too big explains itself; the fillet follows its edge when the box changes; Delete on its face removes it', async ({ page }) => {
    await openApp(page);
    await box(page);
    const e = await screenOf(page, [40, 15, 20]);
    await page.mouse.click(e.x, e.y);
    await typeCommand(page, 'f');
    await page.keyboard.type('35');
    await built(page);
    await expect(page.locator('#h-r')).toContainText('too big');
    await page.locator('#f-r').fill('4');
    await page.keyboard.press('Enter');
    let r = await built(page);
    expect(r.features[2].error).toBe(false);

    // make the box wider: the fillet stays on "its" edge
    await page.locator('#timeline [data-ref="sketch:s1"]').dblclick();
    await settle(page);
    await page.locator('.dimlbl', { hasText: '40' }).dblclick();
    await page.locator('#dimInput').fill('55');
    await page.keyboard.press('Enter');
    await page.locator('.skbar .skfinish').click();
    r = await built(page);
    expect(r.features[2].error).toBe(false);
    expect(55 * 30 * 20 - r.bodies[0].volume).toBeCloseTo((16 - 4 * Math.PI) * 30, 6);

    // select the fillet face and press Delete: the edge is sharp again
    await typeCommand(page, 'home');
    await settle(page);
    const ff = await screenOf(page, [55 - 4 + 4 * Math.SQRT1_2, 15, 20 - 4 + 4 * Math.SQRT1_2]);
    await page.mouse.click(ff.x, ff.y);
    await expect(page.locator('#msg')).toContainText('Delete removes that fillet');
    await page.keyboard.press('Delete');
    await expect(page.locator('#msg')).toContainText('Deleted Fillet1 (removed)');
    r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(55 * 30 * 20, 6);
    expect(r.features).toHaveLength(2);
  });

  test('the size arrow slides along the face to show how far the fillet cuts in; dragging it sets the radius', async ({ page }) => {
    await openApp(page);
    await box(page);
    const e = await screenOf(page, [40, 15, 20]);
    await page.mouse.click(e.x, e.y);
    await typeCommand(page, 'f');
    await page.keyboard.type('5');
    await built(page);
    await expect(page.locator('#dim')).toHaveText('5 mm');
    // the arrow lies in one of the two faces at the edge, pointing away from the edge
    const inTop = await page.evaluate(() => {
      const ed = (window as any).__caddy.baseBodies()[0].edges.find((x: any) => Math.abs(x.mid[0] - 40) < 1e-6 && Math.abs(x.mid[2] - 20) < 1e-6 && Math.abs(x.mid[1] - 15) < 1e-6);
      return Math.abs(ed.n1[2] - 1) < 1e-6;
    });
    const along = (d: number): [number, number, number] => (inTop ? [40 - d, 15, 20] : [40, 15, 20 - d]);
    const grab = await screenOf(page, along(5 + 8)), to = await screenOf(page, along(5 + 8 + 6));
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    await page.mouse.move((grab.x + to.x) / 2, (grab.y + to.y) / 2, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 3 });
    await page.mouse.up();
    const v = Number(await page.locator('#f-r').inputValue());
    expect(v).toBeGreaterThan(8); expect(v).toBeLessThan(14);
    expect(Number.isInteger(v)).toBe(true);
    await expect(page.locator('#dim')).toHaveText(`${v} mm`);
    const r = await built(page);
    expect(24000 - r.bodies[0].volume).toBeCloseTo((1 - Math.PI / 4) * v * v * 30, 5); // the body follows the arrow
    // dragging back past the edge stops at 0, never negative
    const tip = await screenOf(page, along(v + 8)), past = await screenOf(page, along(-30));
    await page.mouse.move(tip.x, tip.y);
    await page.mouse.down();
    await page.mouse.move(past.x, past.y, { steps: 6 });
    await page.mouse.up();
    await expect(page.locator('#f-r')).toHaveValue('0');
  });

  test('Ctrl+Z steps back one step: reopens the fillet with its radius, then removes it; deletes come back; a finished sketch reopens', async ({ page }) => {
    await openApp(page);
    await box(page);
    const e = await screenOf(page, [40, 15, 20]);
    await page.mouse.click(e.x, e.y);
    await typeCommand(page, 'f');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await built(page);

    await page.keyboard.press('Control+z');
    await expect(page.locator('#dlgTitle')).toHaveText('Edit Fillet1');
    await expect(page.locator('#f-r')).toHaveValue('5'); // the number is still there, ready to change
    await expect(page.locator('#f-r')).toBeFocused();
    await page.keyboard.type('3');
    await page.keyboard.press('Enter');
    let r = await built(page);
    expect(24000 - r.bodies[0].volume).toBeCloseTo((1 - Math.PI / 4) * 9 * 30, 6);
    expect(r.features).toHaveLength(3);

    await page.keyboard.press('Control+z'); // back in again, now showing 3
    await expect(page.locator('#f-r')).toHaveValue('3');
    await page.keyboard.press('Escape'); // changed my mind: the fillet stays as it is
    r = await built(page);
    expect(r.features).toHaveLength(3);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#dlgTitle')).toHaveText('Edit Fillet1');
    await page.keyboard.press('Control+z'); // a second Ctrl+Z takes the fillet out
    await expect(page.locator('#msg')).toHaveText('Undid Fillet1');
    r = await built(page);
    expect(r.features.map((f: any) => f.name)).toEqual(['Sketch1', 'Extrude1']);
    expect(r.bodies[0].volume).toBeCloseTo(24000, 6);

    // a delete comes back
    await page.locator('#timeline [data-ref="extrude:e1"]').click({ button: 'right' });
    await page.locator('#ctx button', { hasText: 'Delete' }).click();
    expect((await built(page)).bodies).toHaveLength(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#msg')).toHaveText('Brought back Extrude1');
    r = await built(page);
    expect(r.bodies[0].volume).toBeCloseTo(24000, 6);
    expect(r.docBodies).toEqual(['Body1']);
  });

  test('Ctrl+Z after finishing a sketch goes back into it; inside, it undoes one drawing step at a time', async ({ page }) => {
    await openApp(page);
    await sketchRect(page, 40, 30);
    await expect(page.locator('#prompt')).toHaveText('Command');
    await page.keyboard.press('Control+z');
    await expect(page.locator('#prompt')).toHaveText('Sketch1');
    await expect(page.locator('#msg')).toContainText('Back in Sketch1');
    await page.keyboard.press('Control+z'); // the rectangle
    await expect(page.locator('#msg')).toHaveText('Undone');
    expect(await page.evaluate(() => (window as any).__caddy.state.sketch.curves.length)).toBe(0);
    await page.keyboard.press('Control+z'); // nothing left in it: step back out, the empty sketch goes
    await expect(page.locator('#msg')).toHaveText('Removed Sketch1');
    expect(await page.evaluate(() => (window as any).__caddy.state.features.length)).toBe(0);
    await page.keyboard.press('Control+z');
    await expect(page.locator('#msg')).toHaveText('Nothing to undo');
  });

  test('new project leaves no body, selection or highlight behind', async ({ page }) => {
    await openApp(page);
    await box(page);
    const e = await screenOf(page, [40, 15, 20]);
    await page.mouse.click(e.x, e.y);
    await typeCommand(page, 'new');
    const r = await built(page);
    expect(r).toMatchObject({ bodies: [], features: [], docBodies: [], selection: [] });
    await settle(page);
    const again = await screenOf(page, [40, 15, 20]);
    for (let d = -3; d <= 3; d++) expect(blueish(await pixelAt(page, again.x + d, again.y))).toBe(false);
  });
});
