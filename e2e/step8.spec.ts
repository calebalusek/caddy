import { expect, test, type Page } from '@playwright/test';
import { openApp, pixelAt, screenOf, settle, typeCommand } from './helpers';

const at = (page: Page, x: number, y: number) => page.evaluate(([a, b]) => (window as any).__caddy.sketchScreen(a, b), [x, y]) as Promise<{ x: number; y: number }>;
const built = (page: Page) => page.evaluate(async () => { await new Promise((r) => setTimeout(r, 400)); await (window as any).__caddy.whenBuilt(); });

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
  await page.keyboard.type('12'); await page.keyboard.press('Enter');
  await typeCommand(page, 'home');
  await settle(page);
  await built(page);
}

test.describe('render view and materials', () => {
  test('Design / Render switch, 20 materials, paint a body, save with the project, edges toggle, sketching returns to Design', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    const c = await screenOf(page, [30, 20, 12]);
    const design = await pixelAt(page, c.x, c.y);
    await page.locator('#rmode [data-m="render"]').click();
    await settle(page);
    expect(await page.evaluate(() => (window as any).__caddy.state.viewMode)).toBe('render');
    await expect(page.locator('#rmode')).toHaveClass(/render/);
    const render = await pixelAt(page, c.x, c.y);
    expect(render.join()).not.toBe(design.join()); // a different look: tone mapped, studio lit
    await expect(page.locator('#rmode [data-r="mat"]')).toBeVisible();

    await page.locator('#rmode [data-r="mat"]').click();
    await expect(page.locator('#matPanel')).toBeVisible();
    await expect(page.locator('#mpTarget')).toHaveText('Body1');
    await expect(page.locator('#matPanel .mp-sw')).toHaveCount(20);
    await page.locator('#matPanel .mp-sw[data-mat="brass"]').click();
    const brass = await pixelAt(page, c.x, c.y);
    expect(brass[0]).toBeGreaterThan(brass[2] + 30); // warm, gold
    await page.locator('#matPanel .mp-col[data-col="#2F6FDB"]').click(); // a filament color switches a plastic on
    await expect(page.locator('#matPanel .mp-sw[data-mat="pla"]')).toHaveAttribute('aria-pressed', 'true');
    const blue = await pixelAt(page, c.x, c.y);
    expect(blue[2]).toBeGreaterThan(blue[0] + 20);
    await page.locator('#matPanel .mp-sw[data-mat="oak"]').click();
    const look = await page.evaluate(() => (window as any).__caddy.state.bodies[0].appearance);
    expect(look).toEqual({ id: 'oak' });
    // saved with the project, and read back
    const file = await page.evaluate(() => (window as any).__caddy.projectFile());
    expect(JSON.stringify(file)).toContain('"appearance":{"id":"oak"}');

    // edges can be hidden
    await page.locator('#rmode [data-r="edges"]').click();
    expect(await page.evaluate(() => (window as any).__caddy.state.renderEdges)).toBe(false);
    await page.locator('#rmode [data-r="edges"]').click();

    // sketching is a Design-view job: starting a sketch goes back to Design
    await typeCommand(page, 'sk');
    await page.locator('#tree [data-ref="origin:XY"]').click();
    await settle(page);
    expect(await page.evaluate(() => (window as any).__caddy.state.viewMode)).toBe('design');
    await expect(page.locator('#matPanel')).toBeHidden();
    await page.keyboard.press('Escape');
    await typeCommand(page, 'fs');
    expect(errors).toEqual([]);
  });

  test('the Materials command opens the panel in the Render view; clicking another body chooses it; Design closes the panel', async ({ page }) => {
    const errors = await openApp(page);
    await box(page);
    await typeCommand(page, 'ap');
    await expect(page.locator('#matPanel')).toBeVisible();
    expect(await page.evaluate(() => (window as any).__caddy.state.viewMode)).toBe('render');
    await page.locator('#rmode [data-m="design"]').click();
    await expect(page.locator('#matPanel')).toBeHidden();
    expect(await page.evaluate(() => (window as any).__caddy.state.viewMode)).toBe('design');
    await typeCommand(page, 'rv');
    expect(await page.evaluate(() => (window as any).__caddy.state.viewMode)).toBe('render');
    await typeCommand(page, 'dv');
    expect(await page.evaluate(() => (window as any).__caddy.state.viewMode)).toBe('design');
    expect(errors).toEqual([]);
  });
});
