// Getting files out: the share sheet (Save to Files on an iPad), a normal download, and the Save As folder window.
import { expect, test, type Page } from '@playwright/test';
import { openApp, settle, typeCommand } from './helpers';

const SHARE_MOCK = `
  window.__shared = [];
  window.__shareMode = 'ok';
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    if (window.__shareMode === 'cancel') { const e = new Error('canceled'); e.name = 'AbortError'; throw e; }
    const f = d.files[0], buf = new Uint8Array(await f.arrayBuffer());
    window.__shared.push({ name: f.name, type: f.type, size: f.size, head: Array.from(buf.slice(0, 90)), text: new TextDecoder().decode(buf.slice(0, 400000)) });
  };
`;

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const built = (page: Page) => page.evaluate(async () => { await new Promise((r) => setTimeout(r, 400)); await (window as any).__caddy.whenBuilt(); });
const shared = (page: Page) => page.evaluate(() => (window as any).__shared as { name: string; type: string; size: number; head: number[]; text: string }[]);

async function box(page: Page): Promise<void> {
  await typeCommand(page, 'sk');
  await page.locator('#tree [data-ref="origin:XY"]').click();
  await settle(page);
  await typeCommand(page, 'rec');
  const p = await at(page, 0, 0); await page.mouse.move(p.x, p.y); await page.mouse.click(p.x, p.y);
  const q = await at(page, 36, 24); await page.mouse.move(q.x, q.y);
  await page.keyboard.type('60'); await page.keyboard.press('Tab'); await page.keyboard.type('40'); await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await typeCommand(page, 'fs');
  await typeCommand(page, 'ex');
  await page.keyboard.type('8'); await page.keyboard.press('Enter');
  await settle(page);
  await built(page);
}

test.describe('where a file goes', () => {
  test('the Save window offers the ways this device can deliver the file, and shares a project', async ({ page }) => {
    await page.addInitScript(SHARE_MOCK);
    const errors = await openApp(page);
    await box(page);
    await typeCommand(page, 'save');
    await expect(page.locator('.savemodal')).toBeVisible();
    await expect(page.locator('#smWhere input[value="share"]')).toHaveCount(1);
    await expect(page.locator('#smWhere input[value="download"]')).toHaveCount(1);
    await page.locator('#smWhere input[value="share"]').check({ force: true });
    await expect(page.locator('#smDest')).toContainText('share sheet');
    await page.locator('#smName').fill('Bracket');
    await page.locator('#smSave').click();
    await expect(page.locator('#shTitle')).toHaveText('Your file is ready');
    await expect(page.locator('.sm-ready')).toContainText('Bracket.caddy.json');
    await page.locator('#shShare').click(); // a second tap opens the share sheet (it must come from a tap)
    await expect(page.locator('.savemodal')).toHaveCount(0);
    const [f] = await shared(page);
    expect(f.name).toBe('Bracket.caddy.json');
    const data = JSON.parse(f.text);
    expect(data.format).toBe('caddy');
    expect(data.features.map((x: any) => x.type)).toEqual(['sketch', 'extrude']);
    await expect(page.locator('#msg')).toContainText('Shared Bracket.caddy.json');
    expect(errors).toEqual([]);
  });

  test('STL, 3MF and STEP can be shared too, with the right file contents', async ({ page }) => {
    await page.addInitScript(SHARE_MOCK);
    const errors = await openApp(page);
    await box(page);
    for (const [cmd, ext, check] of [
      ['stl', '.stl', (f: { head: number[]; size: number }) => { expect(String.fromCharCode(...f.head.slice(0, 20))).toBe('CADDY binary STL, mi'); expect(f.size).toBe(84 + 50 * ((f.size - 84) / 50)); expect(f.size).toBeGreaterThan(84 + 50 * 10); }],
      ['3mf', '.3mf', (f: { head: number[] }) => { expect(f.head.slice(0, 2)).toEqual([0x50, 0x4b]); }],
      ['step', '.step', (f: { text: string }) => { expect(f.text.startsWith('ISO-10303-21;')).toBe(true); }],
    ] as const) {
      await typeCommand(page, cmd);
      await expect(page.locator('.savemodal')).toBeVisible();
      await page.locator('#smWhere input[value="share"]').check({ force: true });
      await page.locator('#smName').fill('Part');
      await page.locator('#smSave').click();
      await expect(page.locator('#shTitle')).toBeVisible({ timeout: 30_000 });
      await page.locator('#shShare').click();
      await expect(page.locator('.savemodal')).toHaveCount(0);
      const all = await shared(page), f = all[all.length - 1];
      expect(f.name).toBe('Part' + ext);
      check(f as any);
    }
    expect(errors).toEqual([]);
  });

  test('closing the share sheet keeps the file ready to try again, or to download', async ({ page }) => {
    await page.addInitScript(SHARE_MOCK);
    const errors = await openApp(page);
    await box(page);
    await typeCommand(page, 'save');
    await page.locator('#smWhere input[value="share"]').check({ force: true });
    await page.locator('#smSave').click();
    await page.evaluate(() => { (window as any).__shareMode = 'cancel'; });
    await page.locator('#shShare').click(); // the sheet is dismissed
    await expect(page.locator('#shTitle')).toBeVisible(); // still here
    expect(await shared(page)).toHaveLength(0);
    const dl = page.waitForEvent('download');
    await page.locator('[data-sh="download"]').click(); // or just download it
    expect((await dl).suggestedFilename()).toMatch(/\.caddy\.json$/);
    expect(errors).toEqual([]);
  });

  test('Download works on its own, and the choice is remembered', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    await typeCommand(page, 'save');
    await page.locator('#smWhere input[value="download"]').check({ force: true });
    await page.locator('#smName').fill('Mine');
    const dl = page.waitForEvent('download');
    await page.locator('#smSave').click();
    expect((await dl).suggestedFilename()).toBe('Mine.caddy.json');
    await typeCommand(page, 'save');
    await expect(page.locator('#smWhere input[value="download"]')).toBeChecked(); // asked for again next time
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test('on an iPad, the share sheet (Save to Files) is the first choice', async ({ page }) => {
    await page.addInitScript(SHARE_MOCK);
    await page.addInitScript(() => { try { localStorage.removeItem('caddy-save-dest'); } catch { /* */ } });
    const errors = await openApp(page);
    await box(page);
    await page.locator('#devSwitch button[data-device="tablet"]').click();
    await page.evaluate(() => { try { localStorage.removeItem('caddy-save-dest'); } catch { /* */ } });
    await page.locator('#fileBtn').click(); // no command line on the iPad: the File menu
    await page.getByRole('menuitem', { name: /Save to file/ }).click();
    await expect(page.locator('#smWhere input[value="share"]')).toBeChecked();
    await expect(page.locator('#smWhere')).toContainText('Files / Share');
    await expect(page.locator('#smDest')).toContainText('Save to Files');
    expect(errors).toEqual([]);
  });
});
