import { expect, type Page } from '@playwright/test';

export type RGB = [number, number, number];

/** Open the app with a clean slate and fail the test on any console or page error. */
export async function openApp(page: Page, opts: { keepStorage?: boolean } = {}): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('/');
  if (!opts.keepStorage) {
    await page.evaluate(() => localStorage.clear());
    await page.reload();
  }
  await expect(page.locator('#toolbar .tbtn').first()).toBeVisible();
  // Tips cover part of the viewport; close them like a user would.
  const tips = page.locator('#startClose');
  if (await tips.count()) await tips.click();
  return errors;
}

/** Color of the real rendered page at a client pixel (from an actual screenshot, so WebGL included). */
export async function pixelAt(page: Page, x: number, y: number): Promise<RGB> {
  const shot = await page.screenshot({ clip: { x: Math.round(x) - 1, y: Math.round(y) - 1, width: 3, height: 3 } });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(1, 1, 1, 1).data;
    return [d[0], d[1], d[2]] as [number, number, number];
  }, shot.toString('base64'));
}

export const screenOf = (page: Page, p: [number, number, number]): Promise<{ x: number; y: number }> =>
  page.evaluate((q) => (window as any).__caddy.screenOf(q), p);

export const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
export const near = (a: RGB, b: RGB, tol = 3): boolean => a.every((v, i) => Math.abs(v - b[i]) <= tol);
/** Expected color of `top` drawn at `alpha` over `under`. */
export const blend = (top: RGB, under: RGB, alpha: number): RGB => top.map((v, i) => Math.round(v * alpha + under[i] * (1 - alpha))) as RGB;

export async function typeCommand(page: Page, text: string): Promise<void> {
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
}

/** Wait for camera animations to finish. */
export const settle = (page: Page): Promise<void> => page.waitForTimeout(600);
