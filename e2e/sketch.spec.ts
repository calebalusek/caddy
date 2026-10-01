import { expect, test, type Page } from '@playwright/test';
import { openApp, pixelAt, settle, typeCommand, type RGB } from './helpers';

/** Sketch coordinates → page pixels (for the sketch being edited). */
const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const click = async (page: Page, x: number, y: number, opts?: { shift?: boolean }) => {
  const p = await at(page, x, y);
  await page.mouse.move(p.x, p.y);
  if (opts?.shift) await page.keyboard.down('Shift');
  await page.mouse.click(p.x, p.y);
  if (opts?.shift) await page.keyboard.up('Shift');
};
const move = async (page: Page, x: number, y: number) => { const p = await at(page, x, y); await page.mouse.move(p.x, p.y); await page.mouse.move(p.x + 0.5, p.y); };

const sketch = (page: Page) => page.evaluate(() => {
  const s = (window as any).__caddy.state, sk = s.sketch || s.features.find((f: any) => f.type === 'sketch');
  if (!sk) return null;
  const pt = (id: string) => [sk.pts[id].x, sk.pts[id].y];
  return {
    mode: s.mode as string,
    tool: s.tool ? s.tool.type : null,
    curves: sk.curves.map((c: any) => ({ id: c.id, type: c.type, r: c.r, construction: !!c.construction, a: c.p1 ? pt(c.p1) : null, b: c.p2 ? pt(c.p2) : null, c: c.c ? pt(c.c) : null })),
    cons: sk.cons.map((c: any) => ({ id: c.id, type: c.type, v: c.v, driven: !!c.driven })),
    dof: sk.status.dof as number,
    profiles: (sk.profiles || []).map((p: any) => ({ key: p.key, area: p.area, outer: p.outer })),
    sel: s.skSels.map((x: any) => x.kind + ':' + x.id),
    hist: sk.hist.length as number,
  };
});
const len = (c: { a: number[] | null; b: number[] | null }) => Math.hypot(c.b![0] - c.a![0], c.b![1] - c.a![1]);
const orangeish = (c: RGB): boolean => c[0] > c[2] + 40;
const blueish = (c: RGB): boolean => c[2] > c[0] + 40;

/** Start a sketch on the XY plane, picked from the Browser. */
async function startSketch(page: Page): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await expect(page.locator('.skbar .skfinish')).toBeVisible();
  await settle(page);
}
/** Rectangle with typed width and height, first corner at (x, y). */
async function rect(page: Page, x: number, y: number, w: number, h: number): Promise<void> {
  await typeCommand(page, 'rec');
  await click(page, x, y);
  await move(page, x + w * 0.6, y + h * 0.6);
  await page.keyboard.type(String(w));
  await page.keyboard.press('Tab');
  await page.keyboard.type(String(h));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
}

test.describe('sketching', () => {
  test('sketch on a plane: toolbar switches, view squares up, rectangle by typed size is exact', async ({ page }) => {
    const errors = await openApp(page);
    await startSketch(page);
    await expect(page.locator('.tab.on.sk')).toHaveText('Sketch');
    await expect(page.locator('#prompt')).toHaveText('Sketch1');
    await expect(page.locator('#rmode')).toBeHidden(); // the sketch bar takes the Design/Render spot
    await expect(page.locator('.skbar [data-act="look"]')).toBeHidden(); // already square to the sketch
    expect(await page.evaluate(() => (window as any).__caddy.cam.phi)).toBeLessThan(0.01);

    await rect(page, 10, 10, 40, 30);
    const s = (await sketch(page))!;
    expect(s.curves).toHaveLength(4);
    expect(s.curves.map(len).sort((a: number, b: number) => a - b)).toEqual([30, 30, 40, 40].map((v) => expect.closeTo(v, 6)));
    expect(s.cons.filter((c: any) => c.type === 'length').map((c: any) => c.v).sort()).toEqual([30, 40]);
    expect(s.cons.filter((c: any) => c.type === 'horizontal' || c.type === 'vertical')).toHaveLength(4);
    expect(s.profiles).toHaveLength(1);
    expect(s.profiles[0].area).toBeCloseTo(1200, 6);
    expect(s.dof).toBe(2); // free to slide: nothing ties it to the origin yet
    await expect(page.locator('.dimlbl')).toHaveText(['40', '30']);
    await expect(page.locator('.cglyph')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('starting at the origin snaps to it and gives a fully constrained sketch', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await typeCommand(page, 'rec');
    await move(page, 0.4, 0.3); // close enough to snap
    await expect(page.locator('#snap span')).toHaveText('Origin');
    await page.mouse.down(); await page.mouse.up();
    await move(page, 30, 20);
    await page.keyboard.type('60');
    await page.keyboard.press('Tab');
    await page.keyboard.type('40');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const s = (await sketch(page))!;
    expect(s.dof).toBe(0);
    expect(s.profiles[0].area).toBeCloseTo(2400, 6);
    await typeCommand(page, 'fs');
    await expect(page.locator('#msg')).toHaveText('Finished Sketch1: 1 profile, fully constrained. Type ex to extrude.');
    expect((await sketch(page))!.mode).toBe('solid');
    await expect(page.locator('.skbar')).toHaveCount(0);
  });

  test('circle by typed diameter, dimension edit by double-click, Tab to the next, math kept', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await rect(page, 0, 0, 60, 40);
    await typeCommand(page, 'c');
    await click(page, 20, 20);
    await move(page, 26, 22);
    await page.keyboard.type('8');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    let s = (await sketch(page))!;
    const circ = s.curves.find((c: any) => c.type === 'circle')!;
    expect(circ.r).toBeCloseTo(4, 9);
    expect(circ.c).toEqual([20, 20]);
    expect(s.profiles).toHaveLength(2);
    expect(s.profiles.find((p: any) => p.outer)!.area).toBeCloseTo(2400 - Math.PI * 16, 6);

    await page.locator('.dimlbl', { hasText: 'Ø8' }).dblclick();
    await expect(page.locator('#dimInput')).toBeFocused();
    await page.locator('#dimInput').fill('24/2');
    expect((await sketch(page))!.curves.find((c: any) => c.type === 'circle')!.r).toBeCloseTo(6, 6); // live while typing
    await page.keyboard.press('Tab'); // keeps it and jumps to the next dimension
    await expect(page.locator('#dimInput')).toBeFocused();
    await page.keyboard.press('Escape');
    s = (await sketch(page))!;
    expect(s.curves.find((c: any) => c.type === 'circle')!.r).toBeCloseTo(6, 9);
    await expect(page.locator('.dimlbl', { hasText: 'Ø12' })).toHaveAttribute('title', /= 24\/2/);

    // arrow keys nudge
    await page.locator('.dimlbl', { hasText: '60' }).dblclick();
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Shift+ArrowUp');
    await page.keyboard.press('Enter');
    expect((await sketch(page))!.cons.find((c: any) => c.type === 'length' && c.v === 71)).toBeTruthy();
  });

  test('line tool: chained lines, snapping without adding constraints, closing the shape, undo', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await typeCommand(page, 'l');
    await click(page, 10, 10);
    await click(page, 50, 10.4); // nearly level → horizontal
    await click(page, 50.3, 40); // nearly upright → vertical
    await click(page, 10, 10); // back to the start closes it
    await expect(page.locator('#msg')).toHaveText('Closed shape. The line tool is still active.');
    let s = (await sketch(page))!;
    expect(s.curves).toHaveLength(3);
    expect(s.cons).toEqual([]); // snapping never adds constraints; the user adds them if they want them
    expect(s.profiles).toHaveLength(1);
    expect(s.profiles[0].area).toBeCloseTo((40 * 30) / 2, 6);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+z');
    s = (await sketch(page))!;
    expect(s.curves).toHaveLength(2);
    await expect(page.locator('#msg')).toHaveText('Undone');
  });

  test('hover is orange, selected is a bold blue band, Delete removes, drag moves', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await rect(page, 10, 10, 40, 30);
    const mid = await at(page, 30, 10); // middle of the bottom edge
    await page.mouse.move(mid.x + 120, mid.y + 120);
    await move(page, 30, 10);
    expect(orangeish(await pixelAt(page, mid.x, mid.y))).toBe(true);
    await page.mouse.click(mid.x, mid.y);
    await page.mouse.move(mid.x + 120, mid.y + 120);
    expect((await sketch(page))!.sel).toHaveLength(1);
    // a band about 5 px wide: blue two pixels above and below the line too
    for (const dy of [-2, 0, 2]) expect(blueish(await pixelAt(page, mid.x, mid.y + dy))).toBe(true);
    expect(blueish(await pixelAt(page, mid.x, mid.y + 6))).toBe(false);

    // drag a corner: the rectangle keeps its size (dimensions hold) and follows
    const corner = await at(page, 50, 40);
    await page.mouse.move(corner.x, corner.y);
    await page.mouse.down();
    const to = await at(page, 70, 55);
    await page.mouse.move(to.x, to.y, { steps: 6 });
    await page.mouse.up();
    let s = (await sketch(page))!;
    expect(s.curves.map(len).sort((a: number, b: number) => a - b)).toEqual([30, 30, 40, 40].map((v) => expect.closeTo(v, 5)));
    const xs = s.curves.flatMap((c: any) => [c.a[0], c.b[0]]);
    expect(Math.max(...xs)).toBeCloseTo(70, 0);
    await expect(page.locator('#msg')).toContainText('Moved.');

    // select a dimension badge and delete it
    await page.locator('.dimlbl', { hasText: '40' }).click();
    await page.keyboard.press('Delete');
    s = (await sketch(page))!;
    expect(s.cons.filter((c: any) => c.type === 'length')).toHaveLength(1);
    expect(s.dof).toBe(3);
  });

  test('constraints: perpendicular + equal on a drawn corner, redundant ones are explained', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await typeCommand(page, 'l');
    await click(page, 0, 0);
    await click(page, 40, 0);
    await click(page, 52, 27);
    await page.keyboard.press('Escape');
    await typeCommand(page, 'hv'); // nothing was constrained automatically: level the first line by hand
    await click(page, 20, 0);
    await page.keyboard.press('Escape');
    await typeCommand(page, 'pe');
    await click(page, 20, 0);
    await click(page, 46, 13.5);
    await expect(page.locator('#msg')).toContainText('Lines made perpendicular');
    let s = (await sketch(page))!;
    const up = s.curves[1];
    expect(up.b![0]).toBeCloseTo(up.a![0], 5); // now straight up from the end of the first line
    expect(up.a![1]).toBeCloseTo(0, 5);
    await typeCommand(page, 'eq');
    await click(page, 20, 0);
    await click(page, up.a![0], up.b![1] / 2);
    s = (await sketch(page))!;
    expect(len(s.curves[1])).toBeCloseTo(len(s.curves[0]), 5);
    // the first line is already horizontal: asking again explains instead of adding
    await typeCommand(page, 'hv');
    await click(page, 20, 0);
    await expect(page.locator('#msg')).toContainText("isn't needed");
    expect((await sketch(page))!.cons.filter((c: any) => c.type === 'horizontal')).toHaveLength(1);
  });

  test('dimension tool: length, then a second one that over-constrains becomes a reference dimension', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await rect(page, 0, 0, 50, 20);
    await typeCommand(page, 'd');
    await click(page, 25, 20); // top edge
    await click(page, 25, 32); // place it
    // the top edge is already 50 through the rectangle's constraints
    await expect(page.locator('#msg')).toContainText('reference dimension');
    const s = (await sketch(page))!;
    expect(s.cons.find((c: any) => c.driven)!.v).toBeCloseTo(50, 6);
    await expect(page.locator('.dimlbl.driven')).toHaveText('(50)');
  });

  test('polygon asks for sides, then builds on a construction circle', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await typeCommand(page, 'pol');
    await page.keyboard.type('6');
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toHaveText('6 sides. Click the center point.');
    await click(page, 30, 30);
    await move(page, 44, 31);
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    const s = (await sketch(page))!;
    expect(s.curves.filter((c: any) => c.type === 'line')).toHaveLength(6);
    expect(s.curves.filter((c: any) => c.type === 'circle' && c.construction)).toHaveLength(1);
    s.curves.filter((c: any) => c.type === 'line').forEach((c: any) => expect(len(c)).toBeCloseTo(10, 5)); // hexagon side = circumradius
    expect(s.profiles).toHaveLength(1);
    expect(s.profiles[0].area).toBeCloseTo((3 * Math.sqrt(3) * 100) / 2, 4);
  });

  test('trim, offset and move', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await rect(page, 0, 0, 40, 30);
    // a line across the rectangle, then trim the part that sticks out on the right
    await typeCommand(page, 'l');
    await click(page, 10, 15);
    await click(page, 60, 15);
    await page.keyboard.press('Escape');
    await typeCommand(page, 'tr');
    await click(page, 52, 15);
    await expect(page.locator('#msg')).toContainText('Trimmed');
    let s = (await sketch(page))!;
    const cross = s.curves[4];
    expect(Math.max(cross.a![0], cross.b![0])).toBeCloseTo(40, 6);
    await page.keyboard.press('Escape');

    // offset the rectangle outward by a typed 5
    await typeCommand(page, 'of');
    await click(page, 20, 30);
    await move(page, 20, 38);
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toContainText('Offset 5 mm');
    s = (await sketch(page))!;
    const big = s.curves.slice(5).filter((c: any) => c.type === 'line');
    expect(big).toHaveLength(4);
    expect(big.map(len).sort((a: number, b: number) => a - b)).toEqual([40, 40, 50, 50].map((v) => expect.closeTo(v, 5)));
    await page.keyboard.press('Escape');

    // move the cross line by typed ΔX / ΔY
    await typeCommand(page, 'm');
    await click(page, 25, 15);
    await click(page, 10, 15); // base point on the selection (its left end)
    await move(page, 14, 20);
    await page.keyboard.type('0');
    await page.keyboard.press('Tab');
    await page.keyboard.type('4');
    await page.keyboard.press('Enter');
    await expect(page.locator('#msg')).toContainText('Moved');
  });

  test('object snap tracking: hovering a midpoint acquires it and snaps to where the guides cross, without adding constraints', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await rect(page, 0, 0, 60, 40);
    await typeCommand(page, 'c');
    await move(page, 30, 0); // bottom midpoint
    await expect(page.locator('#snap span')).toHaveText('Midpoint');
    await page.waitForTimeout(500);
    await expect(page.locator('#msg')).toContainText('Tracking point acquired');
    await move(page, 60, 20); // right midpoint
    await page.waitForTimeout(500);
    await expect(page.locator('#msg')).toContainText('Tracking points acquired');
    await move(page, 30.6, 19.5); // near where the two guides cross
    await expect(page.locator('#snap span')).toHaveText('Tracking intersection');
    await click(page, 30.6, 19.5);
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    const s = (await sketch(page))!;
    expect(s.curves.find((c: any) => c.type === 'circle')!.c).toEqual([30, 20]);
    expect(s.cons.filter((c: any) => c.type === 'align')).toHaveLength(0);
    expect(s.dof).toBe(2); // only sized by the diameter; the center is free until the user constrains it
  });

  test('outside sketch editing a sketch is one object: orange hover, blue when selected, double-click edits', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    await rect(page, 0, 0, 40, 30);
    const edge = await at(page, 20, 30);
    await typeCommand(page, 'fs');
    await settle(page);
    await page.mouse.move(edge.x + 150, edge.y - 60);
    await page.mouse.move(edge.x, edge.y);
    await page.mouse.move(edge.x + 0.5, edge.y);
    expect(orangeish(await pixelAt(page, edge.x, edge.y))).toBe(true);
    await page.mouse.click(edge.x, edge.y);
    await page.mouse.move(edge.x + 150, edge.y - 60);
    expect(await page.evaluate(() => (window as any).__caddy.state.treeSel)).toBe('s1');
    expect(blueish(await pixelAt(page, edge.x, edge.y))).toBe(true);
    await expect(page.locator('#tree .row.tsel .nm')).toHaveText('Sketch1');
    await page.keyboard.press('Escape');
    await page.mouse.dblclick(edge.x, edge.y);
    await expect(page.locator('#prompt')).toHaveText('Sketch1');
    await page.locator('.skbar .skfinish').click();
    // from the Browser: single click highlights, double-click edits
    await page.locator('#tree .rowbtn[data-ref="sketch:s1"]').click();
    expect(await page.evaluate(() => (window as any).__caddy.state.treeSel)).toBe('s1');
    await page.locator('#tree .rowbtn[data-ref="sketch:s1"]').click();
    await expect(page.locator('#prompt')).toHaveText('Sketch1');
  });

  test('Finish sketch is reachable at every window width, and "Sketch view" appears only when off-square', async ({ page }) => {
    await openApp(page);
    await startSketch(page);
    for (const width of [1400, 1100, 900, 620]) {
      await page.setViewportSize({ width, height: 700 });
      await page.waitForTimeout(100);
      await expect(page.locator('.skbar .skfinish')).toBeInViewport({ ratio: 1 });
    }
    await page.setViewportSize({ width: 1400, height: 900 });
    const vp = (await page.locator('#viewport').boundingBox())!;
    await page.mouse.move(vp.x + 500, vp.y + 500);
    await page.mouse.down();
    await page.mouse.move(vp.x + 560, vp.y + 460, { steps: 4 });
    await page.mouse.up();
    await expect(page.locator('.skbar [data-act="look"]')).toBeVisible();
    await page.locator('.skbar [data-act="look"]').click();
    await settle(page);
    await expect(page.locator('.skbar [data-act="look"]')).toBeHidden();
  });
});
