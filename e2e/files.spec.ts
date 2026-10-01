import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { openApp, settle, typeCommand } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const model = (page: Page) => page.evaluate(async () => {
  const c = (window as any).__caddy;
  await new Promise((r) => setTimeout(r, 120));
  await c.whenBuilt();
  return {
    name: c.state.doc.name as string,
    volumes: c.shownBodies().map((b: any) => b.volume as number),
    features: c.state.features.map((f: any) => ({ type: f.type, name: f.name, error: !!f.error })),
    selection: c.state.selection.length as number, treeSel: c.state.treeSel, hasDialog: !!c.state.active,
  };
});
const saved = (page: Page) => expect(page.locator('#saveState')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });

async function box(page: Page, w = 40, d = 30, h = 20): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
  await typeCommand(page, 'rec');
  let p = await at(page, 0, 0); await page.mouse.click(p.x, p.y);
  p = await at(page, w * 0.6, d * 0.6); await page.mouse.move(p.x, p.y);
  await page.keyboard.type(String(w)); await page.keyboard.press('Tab'); await page.keyboard.type(String(d)); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await typeCommand(page, 'fs');
  await typeCommand(page, 'ex');
  await page.keyboard.type(String(h));
  await page.keyboard.press('Enter');
  await model(page);
}
/** Make Save go to the downloads folder, as it does in browsers without a Save As picker. */
const noPicker = (page: Page) => page.addInitScript(() => { delete (window as any).showSaveFilePicker; });
/** Stand in for the system Save As window: remember what the app writes. */
const fakePicker = (page: Page) => page.addInitScript(() => {
  (window as any).__picked = [];
  (window as any).showSaveFilePicker = async (opts: any) => ({
    name: opts.suggestedName,
    createWritable: async () => {
      const rec: any = { name: opts.suggestedName, types: opts.types, size: 0, head: '' };
      return {
        write: async (data: any) => { const u8 = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data.buffer || data); rec.size = u8.length; rec.head = new TextDecoder().decode(u8.slice(0, 60)); rec.text = typeof data === 'string' ? data : null; },
        close: async () => { (window as any).__picked.push(rec); },
      };
    },
  });
});

test.describe('projects', () => {
  test('autosaves to this browser; the library opens on return with a picture; opening restores the model', async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.locator('#saveState')).toHaveText(''); // nothing to save yet
    await box(page);
    await saved(page);
    await expect(page.locator('#saveState')).toHaveText('Saved');
    await page.locator('#docName').click();
    await page.locator('.docinput').fill('Bracket');
    await page.keyboard.press('Enter');
    await saved(page);

    await page.reload();
    await expect(page.locator('#lib')).toBeVisible();
    await expect(page.locator('#msg')).toHaveText('Welcome back. Pick a project to reopen, or start a new one.');
    const card = page.locator('.pcard');
    await expect(card).toHaveCount(1);
    await expect(card.locator('.pname')).toHaveText('Bracket');
    await expect(card.locator('.pinfo')).toContainText('2 features');
    await expect(card.locator('.pthumb img')).toHaveAttribute('src', /^data:image\/jpeg/);
    await card.locator('.pthumb').click();
    await expect(page.locator('#lib')).toBeHidden();
    const m = await model(page);
    expect(m.name).toBe('Bracket');
    expect(m.features.map((f: any) => f.name)).toEqual(['Sketch1', 'Extrude1']);
    expect(m.volumes[0]).toBeCloseTo(24000, 6);
    await expect(page.locator('#docName')).toHaveText('Bracket');
    expect(errors).toEqual([]);
  });

  test('library: rename, duplicate, delete with confirm; new project gets a free name', async ({ page }) => {
    await openApp(page);
    await box(page, 10, 10, 5);
    await saved(page);
    await typeCommand(page, 'proj');
    await expect(page.locator('.pcard.current .pcur')).toHaveText('open');
    await page.locator('.pcard .pmore').click();
    await page.locator('#ctx button', { hasText: 'Duplicate' }).click();
    await expect(page.locator('.pcard')).toHaveCount(2);
    await expect(page.locator('.pname').filter({ hasText: 'Untitled part copy' })).toHaveCount(1);
    await page.locator('.pcard', { hasText: 'Untitled part copy' }).locator('.pmore').click();
    await page.locator('#ctx button', { hasText: 'Rename' }).click();
    await page.locator('.pcard .docinput').fill('Spare');
    await page.keyboard.press('Enter');
    await expect(page.locator('.pname').filter({ hasText: 'Spare' })).toHaveCount(1);
    await page.locator('.pcard', { hasText: 'Spare' }).locator('.pmore').click();
    await page.locator('#ctx button', { hasText: 'Delete' }).click();
    await expect(page.locator('.pconfirm')).toContainText('Delete “Spare”? This can’t be undone.');
    await page.locator('.pconfirm [data-act="keep"]').click();
    await expect(page.locator('.pcard')).toHaveCount(2); // Cancel keeps it
    await page.locator('.pcard', { hasText: 'Spare' }).locator('.pmore').click();
    await page.locator('#ctx button', { hasText: 'Delete' }).click();
    await page.locator('.pconfirm [data-act="del"]').click();
    await expect(page.locator('.pcard')).toHaveCount(1);
    await page.locator('[data-lib="new"]').click();
    await expect(page.locator('#lib')).toBeHidden();
    const m = await model(page);
    expect(m.name).toBe('Untitled part 2');
    expect(m.features).toEqual([]);
  });
});

test.describe('save window and files', () => {
  test('name, + Version, + Date, empty name disables Save, Esc cancels, last name remembered', async ({ page }) => {
    await noPicker(page);
    await openApp(page);
    await box(page);
    await page.keyboard.press('Control+s');
    const name = page.locator('#smName');
    await expect(page.locator('#smTitle')).toHaveText('Save project');
    await expect(name).toHaveValue('Untitled part');
    await expect(name).toBeFocused();
    await expect(page.locator('#smExt')).toHaveText('.caddy.json');
    await expect(page.locator('#smInfo')).toContainText('2 features');
    await expect(page.locator('#smDest')).toContainText("browser's download folder");
    await page.locator('[data-sm="ver"]').click();
    await expect(name).toHaveValue('Untitled part v2');
    await page.locator('[data-sm="ver"]').click();
    await expect(name).toHaveValue('Untitled part v3');
    await page.locator('[data-sm="date"]').click();
    await expect(name).toHaveValue(/^Untitled part v3 \d{4}-\d{2}-\d{2}$/);
    await name.fill('');
    await expect(page.locator('#smSave')).toBeDisabled();
    await name.fill('Bracket v1');
    await expect(page.locator('#smSave')).toBeEnabled();
    await expect(page.locator('#prompt')).toHaveText('Command'); // typing a name did not start a command
    await page.keyboard.press('Escape');
    await expect(page.locator('.savemodal')).toHaveCount(0);
    await expect(page.locator('#msg')).toHaveText('Save canceled');

    // save for real: a plain .caddy.json lands in downloads
    await page.keyboard.press('Control+s');
    await name.fill('Bracket v1');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
    expect(dl.suggestedFilename()).toBe('Bracket v1.caddy.json');
    const file = JSON.parse(readFileSync((await dl.path())!, 'utf8'));
    expect(file).toMatchObject({ format: 'caddy', version: 2, units: 'mm', name: 'Untitled part' });
    expect(file.features.map((f: any) => f.type)).toEqual(['sketch', 'extrude']);
    expect(JSON.stringify(file)).not.toContain('"positions"'); // no mesh in the file
    await page.keyboard.press('Control+s');
    await expect(name).toHaveValue('Bracket v1'); // remembered
    await page.keyboard.press('Escape');

    // open that file in a fresh session: identical model
    const text = JSON.stringify(file);
    await typeCommand(page, 'new');
    await page.locator('#fileIn').setInputFiles({ name: 'Bracket v1.caddy.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect(page.locator('#msg')).toContainText('Opened Untitled part');
    const m = await model(page);
    expect(m.volumes[0]).toBeCloseTo(24000, 6);
    expect(m.features.every((f: any) => !f.error)).toBe(true);
  });

  test('Save As: where the browser has a Save As window, Save opens it and writes the file there', async ({ page }) => {
    await fakePicker(page);
    await openApp(page);
    await box(page);
    await typeCommand(page, 'save');
    await expect(page.locator('#smDest')).toHaveText("You'll choose the folder next.");
    await page.locator('#smSave').click();
    await expect(page.locator('#msg')).toHaveText('Saved Untitled part.caddy.json');
    const picked = await page.evaluate(() => (window as any).__picked);
    expect(picked).toHaveLength(1);
    expect(picked[0].name).toBe('Untitled part.caddy.json');
    expect(JSON.parse(picked[0].text).format).toBe('caddy');
  });

  test('exports: STL with a smoothness choice, 3MF and STEP as plain files', async ({ page }) => {
    await fakePicker(page);
    await openApp(page);
    // a plate with a hole, so curved faces matter
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
    await page.keyboard.type('8'); await page.keyboard.press('Enter');
    await model(page);

    await typeCommand(page, 'stl');
    await expect(page.locator('#smTitle')).toHaveText('Export for printing');
    await expect(page.locator('#smExt')).toHaveText('.stl');
    await expect(page.locator('input[name="smQ"][value="Fine"]')).toBeChecked();
    await expect(page.locator('#smInfo')).toHaveText(/1 body · [\d,]+ triangles · millimeters/);
    const count = async () => { const m = (await page.locator('#smInfo').textContent())!.match(/([\d,]+) triangles/); return m ? Number(m[1].replace(/,/g, '')) : NaN; }; // NaN while it is still counting
    const fine = await count();
    await page.locator('input[name="smQ"][value="Draft"]').check({ force: true });
    await expect.poll(count).toBeLessThan(fine);
    await page.locator('input[name="smQ"][value="Fine"]').check({ force: true });
    await expect.poll(count).toBe(fine);
    await page.locator('#smSave').click();
    await expect(page.locator('#msg')).toHaveText(new RegExp(`^Exported Untitled part\\.stl \\(1 body, ${fine.toLocaleString()} triangles, mm\\)$`));

    await typeCommand(page, '3mf');
    await expect(page.locator('input[name="smFmt"][value="3mf"]')).toBeChecked();
    await expect(page.locator('#smInfo')).toContainText('each body kept as its own part');
    await page.locator('#smSave').click();
    await expect(page.locator('#msg')).toContainText('Exported Untitled part.3mf');

    await typeCommand(page, 'step');
    await expect(page.locator('#smQualityRow')).toBeHidden(); // exact geometry has no smoothness setting
    await expect(page.locator('#smInfo')).toContainText('exact geometry');
    await page.locator('#smSave').click();
    await expect(page.locator('#msg')).toHaveText('Exported Untitled part.step (1 body, exact geometry, mm)');

    const files = await page.evaluate(() => (window as any).__picked);
    expect(files.map((f: any) => f.name)).toEqual(['Untitled part.stl', 'Untitled part.3mf', 'Untitled part.step']);
    expect(files[0].head).toContain('CADDY binary STL, millimeters');
    expect(files[0].size).toBe(84 + fine * 50);
    expect(files[1].head.startsWith('PK')).toBe(true); // a real .3mf package, not wrapped in anything else
    expect(files[2].head.startsWith('ISO-10303-21;')).toBe(true);
  });

  test('opening a version 1 file from the prototype: exact model, and nothing left over from the previous project', async ({ page }) => {
    await openApp(page);
    await box(page);
    await page.locator('#tree .rowbtn[data-ref="sketch:s1"]').click(); // leave something selected
    await typeCommand(page, 'pl'); // and a tool open
    const v1 = readFileSync(new URL('../tests/fixtures/v1/plate-pocket-fillet.caddy.json', import.meta.url));
    await page.locator('#fileIn').setInputFiles({ name: 'plate-pocket-fillet.caddy.json', mimeType: 'application/json', buffer: v1 });
    await expect(page.locator('#msg')).toContainText('Opened plate-pocket-fillet');
    const m = await model(page);
    expect(m.features.map((f: any) => f.name)).toEqual(['Sketch1', 'Extrude1', 'Plane1', 'Sketch2', 'Cut2', 'Fillet1', 'Chamfer2']);
    expect(m.features.every((f: any) => !f.error)).toBe(true);
    const exact = 60 * 40 * 8 - Math.PI * 9 * 8 - 15 * 20 * 3 - (4 - Math.PI) * 40 - ((1.5 * 1.5) / 2) * 40;
    expect(m.volumes[0]).toBeCloseTo(exact, 5);
    expect(m).toMatchObject({ selection: 0, treeSel: null, hasDialog: false }); // standing rule 7
    await expect(page.locator('#timeline .tl-item')).toHaveCount(7);
    await expect(page.locator('#timeline .tl-item.err')).toHaveCount(0);

    await page.locator('#fileIn').setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') });
    await expect(page.locator('#msg')).toHaveText("notes.json isn't a CADDY project file");
  });
});
