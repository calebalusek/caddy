import { expect, test, type Page } from '@playwright/test';
import { hex, near, openApp, pixelAt, screenOf, settle, typeCommand, type RGB } from './helpers';

const state = (page: Page) => page.evaluate(() => {
  const s = (window as any).__caddy.state;
  return {
    features: s.features.map((f: any) => ({ id: f.id, type: f.type, name: f.name, params: f.params, frame: f.frame, error: !!f.error })),
    selection: s.selection.map((x: any) => x.key),
    hasDialog: !!s.active,
    hasPick: !!s.pick,
    counters: s.counters,
  };
});
const orangeish = (c: RGB): boolean => c[0] > c[2] + 40;
const blueish = (c: RGB): boolean => c[2] > c[0] + 40;
const dialog = (page: Page) => page.locator('section.dialog');
/** Bounding box of the tool menu once its opening animation has finished. */
const dialogBox = async (page: Page) => { await page.waitForTimeout(220); return (await dialog(page).boundingBox())!; };

test.describe('app shell', () => {
  test('loads cleanly: toolbar groups, panels, kernel ready, no errors', async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.locator('.tgroup-label span')).toHaveText(['Create', 'Modify', 'Construct', 'Look', 'Print']);
    await expect(page.locator('.browser summary .nm')).toHaveText(['Origin', 'Sketches', 'Construction', 'Bodies']);
    await expect(page.locator('#prompt')).toHaveText('Command');
    await expect(page.locator('#viewCube canvas')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__caddy.kernelReady)).toBe(true);
    await expect(page.locator('#kernelState')).toBeHidden();
    expect(await page.evaluate(() => document.fonts.check('600 14px Barlow'))).toBe(true);
    expect(errors).toEqual([]);
  });

  test('viewport background matches the theme colors exactly, light and dark', async ({ page }) => {
    await openApp(page);
    const box = (await page.locator('#viewport').boundingBox())!;
    const spot = { x: box.x + 380, y: box.y + 70 }; // clear of the tips panel, which comes back on reload
    expect(near(await pixelAt(page, spot.x, spot.y), hex('#D8DDE2'))).toBe(true);
    await page.locator('#themeBtn').click();
    await page.waitForTimeout(100);
    expect(near(await pixelAt(page, spot.x, spot.y), hex('#343A41'))).toBe(true);
    await page.reload();
    await page.waitForTimeout(300);
    expect(near(await pixelAt(page, spot.x, spot.y), hex('#343A41'))).toBe(true); // theme is remembered
  });

  test('command bar: typing anywhere suggests commands; unbuilt tools explain themselves', async ({ page }) => {
    await openApp(page);
    await page.keyboard.type('pl');
    await expect(page.locator('#sugs li').first()).toContainText('Offset plane');
    await page.keyboard.press('Escape');
    await typeCommand(page, 'rev');
    await expect(page.locator('#msg')).toContainText('Revolve arrives in step 5');
    await page.locator('.tbtn[data-cmd="mirror"]').click();
    await expect(page.locator('#msg')).toContainText("Mirror isn't built yet");
    await typeCommand(page, 'top');
    await settle(page);
    const phi = await page.evaluate(() => (window as any).__caddy.cam.phi);
    expect(phi).toBeLessThan(0.01);
  });

  test('view cube: clicking a face turns the camera to that view', async ({ page }) => {
    await openApp(page);
    const cube = (await page.locator('#vcCanvas').boundingBox())!;
    await page.mouse.click(cube.x + cube.width * 0.42, cube.y + cube.height * 0.62); // FRONT face
    await settle(page);
    const c = await page.evaluate(() => { const k = (window as any).__caddy.cam; return { theta: k.theta, phi: k.phi }; });
    expect(c.phi).toBeCloseTo(Math.PI / 2, 2);
    expect(Math.sin(c.theta)).toBeCloseTo(-1, 2);
    await page.locator('#vcHome').click();
    await settle(page);
    expect(await page.evaluate(() => (window as any).__caddy.cam.phi)).toBeCloseTo(Math.acos(1 / Math.sqrt(3)), 3);
  });
});

test.describe('offset plane (first tool on the shared tool-menu system)', () => {
  test('hover is orange, the value starts at 0, Enter creates the plane at the exact offset', async ({ page }) => {
    const errors = await openApp(page);
    await typeCommand(page, 'pl');
    await expect(dialog(page)).toBeVisible();
    await expect(page.locator('#refChip')).toHaveText('Click a plane or flat face…');
    await expect(page.locator('#okBtn')).toBeDisabled();

    // Hover the XZ plane: it turns a stronger orange than the plane next to it.
    const xz = await screenOf(page, [45, 0, 50]);
    await page.mouse.move(xz.x - 300, xz.y - 200);
    const before = await pixelAt(page, xz.x, xz.y);
    await page.mouse.move(xz.x, xz.y);
    await page.mouse.move(xz.x + 1, xz.y);
    const hovered = await pixelAt(page, xz.x, xz.y);
    expect(orangeish(hovered)).toBe(true);
    expect(hovered[0] - hovered[2]).toBeGreaterThan(before[0] - before[2] + 25);

    await page.mouse.click(xz.x, xz.y);
    await expect(page.locator('#refChip')).toHaveText('XZ plane');
    const input = page.locator('#f-distance');
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('0'); // standing rule 3
    await page.keyboard.type('50/2');
    await page.keyboard.press('Enter');
    await expect(dialog(page)).toBeHidden();
    await expect(page.locator('#msg')).toContainText('Plane1 created 25 mm from XZ plane');

    const s = await state(page);
    expect(s.features).toHaveLength(1);
    expect(s.features[0].frame.o).toEqual([0, -25, 0]);
    await expect(page.locator('#timeline .tl-item')).toHaveCount(1);
    await expect(page.locator('#tree [data-ref="plane:p1"] .nm').first()).toHaveText('Plane1');
    expect(errors).toEqual([]);
  });

  test('pick from the Browser, edit from History, undo', async ({ page }) => {
    await openApp(page);
    await page.locator('.tbtn[data-cmd="plane"]').click();
    await page.locator('#tree [data-ref="origin:XY"]').click(); // standing rule 2
    await expect(page.locator('#refChip')).toHaveText('XY plane');
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');

    // a second plane measured from the first one, picked in History
    await typeCommand(page, 'pl');
    await page.locator('#timeline [data-ref="plane:p1"]').click();
    await expect(page.locator('#refChip')).toHaveText('Plane1');
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    expect((await state(page)).features[1].frame.o).toEqual([0, 0, 15]);

    // edit the first: the second follows (parametric)
    await page.locator('#timeline [data-ref="plane:p1"]').dblclick();
    await expect(page.locator('#dlgTitle')).toHaveText('Edit Plane1');
    await expect(page.locator('#f-distance')).toHaveValue('10');
    await page.locator('#f-distance').fill('30');
    await page.keyboard.press('Enter');
    const s = await state(page);
    expect(s.features[0].frame.o).toEqual([0, 0, 30]);
    expect(s.features[1].frame.o).toEqual([0, 0, 35]);

    await page.keyboard.press('Control+z');
    await expect(page.locator('#msg')).toHaveText('Undid Plane2');
    expect((await state(page)).features).toHaveLength(1);

    // deleting what others are built on removes them too, and says so
    await typeCommand(page, 'pl');
    await page.locator('#timeline [data-ref="plane:p1"]').click();
    await page.keyboard.type('1');
    await page.keyboard.press('Enter');
    await page.locator('#timeline [data-ref="plane:p1"]').click({ button: 'right' });
    await page.locator('#ctx button', { hasText: 'Delete' }).click();
    await expect(page.locator('#msg')).toContainText('Deleted Plane1 and what was built on it: Plane3');
    expect((await state(page)).features).toHaveLength(0);
  });

  test('drag arrow changes the offset in whole millimeters', async ({ page }) => {
    await openApp(page);
    await typeCommand(page, 'pl');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    const tip = await screenOf(page, [30, 30, 4]);
    await page.mouse.move(tip.x, tip.y);
    await page.mouse.down();
    await page.mouse.move(tip.x, tip.y - 40, { steps: 5 });
    await page.mouse.move(tip.x, tip.y - 90, { steps: 5 });
    await page.mouse.up();
    const v = Number(await page.locator('#f-distance').inputValue());
    expect(v).toBeGreaterThan(5);
    expect(Number.isInteger(v)).toBe(true);
    await expect(page.locator('#dim')).toHaveText(`${v} mm`);
  });

  test('selected plane is bold blue; select first, then tool; new project leaves no ghosts', async ({ page }) => {
    await openApp(page);
    await typeCommand(page, 'ori');
    const xz = await screenOf(page, [45, 0, 50]);
    await page.mouse.click(xz.x, xz.y);
    await page.mouse.move(xz.x - 300, xz.y - 200);
    expect((await state(page)).selection).toEqual(['origin:XZ']);
    expect(blueish(await pixelAt(page, xz.x, xz.y))).toBe(true);

    // the tool starts with the selected plane already filled in
    await typeCommand(page, 'pl');
    await expect(page.locator('#refChip')).toHaveText('XZ plane');
    await expect(page.locator('#f-distance')).toBeFocused();
    await page.keyboard.type('12');
    await page.keyboard.press('Enter');
    expect((await state(page)).features).toHaveLength(1);

    // select the new plane, then start a new project: nothing from the old one is left (standing rule 7)
    await page.locator('#tree .rowbtn[data-ref="plane:p1"]').click();
    expect((await state(page)).selection).toEqual(['plane:p1']);
    await typeCommand(page, 'pl');
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await typeCommand(page, 'new');
    await expect(page.locator('#timeline .tl-item')).toHaveCount(0); // the old project is saved first, then cleared
    const s = await state(page);
    expect(s).toMatchObject({ features: [], selection: [], hasDialog: false, hasPick: false });
    expect(s.counters.plane).toBe(0);
    await expect(page.locator('#timeline .tl-item')).toHaveCount(0);
    await expect(page.locator('#dim')).toBeHidden();
    await settle(page);
    const again = await screenOf(page, [45, 0, 50]);
    expect(blueish(await pixelAt(page, again.x, again.y))).toBe(false);
  });
});

test.describe('tool menus (standing rule 4)', () => {
  for (const width of [1400, 1100, 900]) {
    test(`docked flush right and never cut off at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 900 ? 560 : 800 });
      await openApp(page);
      await typeCommand(page, 'pl');
      await page.locator('#tree [data-ref="origin:XY"]').click();
      const vp = (await page.locator('#viewport').boundingBox())!, d = await dialogBox(page);
      expect(Math.abs(d.x + d.width - (vp.x + vp.width))).toBeLessThan(1); // touching the right edge
      expect(d.y).toBeGreaterThanOrEqual(vp.y);
      expect(d.y + d.height).toBeLessThanOrEqual(vp.y + vp.height + 0.5);
      await expect(dialog(page)).toHaveClass(/dock-r/);
      await expect(page.locator('#okBtn')).toBeInViewport({ ratio: 1 });
      const cube = (await page.locator('#viewCube').boundingBox())!;
      if (width !== 900) expect(d.y).toBeGreaterThanOrEqual(cube.y + cube.height); // below the ViewCube when there is room
    });
  }

  test('drag by the title bar, position remembered for the next tool and after reload, double-click re-docks', async ({ page }) => {
    await openApp(page);
    await typeCommand(page, 'pl');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    const head = (await page.locator('section.dialog .dhead h2').boundingBox())!;
    await page.mouse.move(head.x + 20, head.y + 8);
    await page.mouse.down();
    await page.mouse.move(head.x - 280, head.y + 90, { steps: 6 });
    await page.mouse.up();
    const moved = await dialogBox(page);
    await expect(dialog(page)).not.toHaveClass(/dock-r/);
    await expect(page.locator('#msg')).toContainText('Menu position saved');

    await page.keyboard.press('Escape');
    await typeCommand(page, 'pl');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    const again = await dialogBox(page);
    expect(Math.abs(again.x - moved.x)).toBeLessThan(1);
    expect(Math.abs(again.y - moved.y)).toBeLessThan(1);

    await page.reload();
    await page.locator('#startClose').click();
    await typeCommand(page, 'pl');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    const afterReload = await dialogBox(page);
    expect(Math.abs(afterReload.x - moved.x)).toBeLessThan(1);

    // a smaller window never cuts the menu off
    await page.setViewportSize({ width: 900, height: 500 });
    await page.waitForTimeout(150);
    const vp = (await page.locator('#viewport').boundingBox())!, small = await dialogBox(page);
    expect(small.x).toBeGreaterThanOrEqual(vp.x - 0.5);
    expect(small.x + small.width).toBeLessThanOrEqual(vp.x + vp.width + 0.5);
    expect(small.y + small.height).toBeLessThanOrEqual(vp.y + vp.height + 0.5);

    await page.locator('section.dialog .dhead h2').dblclick();
    await expect(dialog(page)).toHaveClass(/dock-r/);
    await expect(page.locator('#msg')).toHaveText('Menu docked back on the right');
  });
});
