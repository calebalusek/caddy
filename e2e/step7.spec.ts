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

test.describe('owner feedback round 1', () => {
  test('hole snaps to face critical points; Shift-click two points puts the hole halfway', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 60, 40, 8);
    await typeCommand(page, 'ho');
    const aim = async (q: [number, number, number], dx = 5, dy = 4): Promise<{ x: number; y: number }> => { const s = await screenOf(page, q); await page.mouse.move(s.x + dx + 30, s.y + dy); await page.mouse.move(s.x + dx, s.y + dy); return { x: s.x + dx, y: s.y + dy }; };
    // near the middle of the top face: the hole lands exactly in the middle (the middle of the two long sides)
    let p = await aim([30, 20, 8]);
    await page.mouse.click(p.x, p.y);
    // near a corner and an edge middle
    p = await aim([60, 0, 8], -4, 3); await page.mouse.click(p.x, p.y);
    p = await aim([30, 40, 8], 3, 5); await page.mouse.click(p.x, p.y);
    // Shift-click the middle of the left edge and the middle of the front edge: the hole goes halfway between them
    await page.keyboard.down('Shift');
    p = await aim([0, 20, 8], 3, 3); await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(500); p = await aim([30, 0, 8], 2, -4); await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Shift');
    await page.keyboard.type('4'); await page.keyboard.press('Enter');
    const pts: number[][] = await page.evaluate(() => (window as any).__caddy.state.features.find((f: any) => f.type === 'hole').params.pts.map((r: any) => r.p));
    const near = (a: number[], b: number[]): boolean => a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
    expect(pts).toHaveLength(4);
    expect(near(pts[0], [30, 20, 8])).toBe(true); // middle of the face
    expect(near(pts[1], [60, 0, 8])).toBe(true); // corner
    expect(near(pts[2], [30, 40, 8])).toBe(true); // edge middle
    expect(near(pts[3], [15, 10, 8])).toBe(true); // halfway between two critical points
    expect(errors).toEqual([]);
  });

  test('Fit to edges: choosing it goes straight to picking the two edges; the hole stays until they are set; rows and columns fill in equal spacing', async ({ page }) => {
    const errors = await openApp(page);
    await plateWithHole(page);
    await typeCommand(page, 'ptr');
    await page.locator('#timeline [data-ref="hole:h1"]').click();
    await page.locator('input[name="f-layout"][value="Fit to edges"]').check({ force: true });
    await expect(page.locator('#e1Chip')).toHaveClass(/picking/); // the next click is the length edge
    let s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(PLATE - HOLE, 4); // nothing disappears while the edges are not picked
    const e1 = await screenOf(page, [40, 0, 8]), e2 = await screenOf(page, [0, 25, 8]);
    await page.mouse.move(e1.x + 30, e1.y + 30); await page.mouse.move(e1.x, e1.y); await page.mouse.move(e1.x + 0.5, e1.y);
    await page.mouse.click(e1.x + 0.5, e1.y);
    await expect(page.locator('#e1Chip')).toHaveText('Edge of 60 mm');
    await expect(page.locator('#e2Chip')).toHaveClass(/picking/);
    await page.mouse.move(e2.x + 30, e2.y + 30); await page.mouse.move(e2.x, e2.y); await page.mouse.move(e2.x, e2.y + 0.5);
    await page.mouse.click(e2.x, e2.y + 0.5);
    await expect(page.locator('#e2Chip')).toHaveText('Edge of 40 mm');
    await page.locator('#f-cols').fill('3');
    await page.locator('#f-rows').fill('2');
    s = await built(page);
    expect(s.bodies[0].volume).toBeCloseTo(PLATE - 6 * HOLE, 4); // six holes; the original moved into the grid
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.features.every((f: any) => !f.error)).toBe(true);
    expect(s.bodies[0].volume).toBeCloseTo(PLATE - 6 * HOLE, 4);
    expect(errors).toEqual([]);
  });

  test('tool previews keep the original body and show what changes; the arrow moves smoothly', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 40, 30, 20);
    const top = await screenOf(page, [20, 15, 20]);
    await page.mouse.move(top.x, top.y); await page.mouse.click(top.x, top.y);
    await typeCommand(page, 'sh');
    await page.keyboard.type('2');
    await built(page);
    const v = await page.evaluate(() => { const c = (window as any).__caddy; return { shown: c.baseBodies()[0].volume, preview: c.shownBodies()[0].volume }; });
    expect(v.shown).toBeCloseTo(24000, 6); // the original is still what is drawn
    expect(v.preview).toBeCloseTo(7152, 4); // what OK would make
    // dragging the arrow: tenths of a millimeter, not whole millimeters
    const tip = await page.evaluate(() => { const c = (window as any).__caddy; return c.state.active.params.thickness; });
    expect(tip).toBe(2);
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });
});

test.describe('owner feedback round 2: live preview while the arrow is held', () => {
  test('the fillet preview updates during the drag, not only on release', async ({ page }) => {
    const errors = await openApp(page);
    await plateWithHole(page);
    const e = await screenOf(page, [60, 20, 8]);
    await page.mouse.move(e.x, e.y); await page.mouse.click(e.x, e.y);
    await typeCommand(page, 'f');
    await page.keyboard.type('2');
    await built(page);
    // the arrow lies in one of the two faces at the edge
    const inTop = await page.evaluate(() => {
      const ed = (window as any).__caddy.baseBodies()[0].edges.find((x: any) => Math.abs(x.mid[0] - 60) < 1e-6 && Math.abs(x.mid[2] - 8) < 1e-6 && Math.abs(x.mid[1] - 20) < 1e-6);
      return Math.abs(ed.n1[2] - 1) < 1e-6;
    });
    const along = (d: number): [number, number, number] => (inTop ? [60 - d, 20, 8] : [60, 20, 8 - d]);
    const grab = await screenOf(page, along(2 + 5)), far = await screenOf(page, along(2 + 5 + 5));
    await page.mouse.move(grab.x, grab.y);
    await page.mouse.down();
    const before = await page.evaluate(() => ({ n: (window as any).__caddy.builtCount(), v: (window as any).__caddy.shownBodies()[0].volume }));
    // hold the button down and keep moving: the preview has to follow while the button is still down
    for (let i = 1; i <= 24; i++) { await page.mouse.move(grab.x + ((far.x - grab.x) * i) / 24, grab.y + ((far.y - grab.y) * i) / 24); await page.waitForTimeout(25); }
    await page.waitForTimeout(150);
    const during = await page.evaluate(() => ({ n: (window as any).__caddy.builtCount(), v: (window as any).__caddy.shownBodies()[0].volume, r: (window as any).__caddy.state.active.params.r }));
    expect(during.n - before.n).toBeGreaterThanOrEqual(4); // several updates, with the mouse still down
    expect(during.v).toBeLessThan(before.v); // the cut keeps growing as the arrow slides
    expect(during.r).toBeGreaterThan(2);
    await page.mouse.up();
    expect(errors).toEqual([]);
  });
});

test.describe('step 10: mirror', () => {
  test('one body is picked for you; pick the YZ plane in the Browser; New body then Join; Ctrl+Z reopens it', async ({ page }) => {
    const errors = await openApp(page);
    await box(page, 60, 40, 8);
    await typeCommand(page, 'mi');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#mbChip')).toHaveText('Body1'); // the only body is picked for you
    await expect(page.locator('#mpChip')).toHaveClass(/picking/); // and the plane is asked for next
    await expect(page.locator('#okBtn')).toBeDisabled();
    await page.locator('#tree [data-ref="origin:YZ"]').click();
    await expect(page.locator('#mpChip')).toHaveText('YZ plane');
    let s = await built(page);
    const prev = await page.evaluate(() => (window as any).__caddy.shownBodies().map((b: any) => b.id));
    expect(prev).toHaveLength(2); // live: the copy appears
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.bodies).toHaveLength(2);
    s.bodies.forEach((b: any) => expect(b.volume).toBeCloseTo(60 * 40 * 8, 4));
    expect(s.features.find((f: any) => f.type === 'mirror')).toMatchObject({ name: 'Mirror1', error: false });

    // Ctrl+Z reopens it; mirror across the plane through the body's own right face to join them
    await page.keyboard.press('Control+z');
    await expect(dialog(page)).toBeVisible();
    await page.locator('input[name="f-operation"][value="Join"]').check({ force: true });
    s = await built(page);
    await page.locator('#okBtn').click();
    s = await built(page);
    expect(s.bodies).toHaveLength(1);
    expect(s.bodies[0].volume).toBeCloseTo(2 * 60 * 40 * 8, 4); // one part, symmetric about the plane
    expect(errors).toEqual([]);
  });
});
