import { expect, test } from '@playwright/test';

test('kernel loads in the worker and the box renders with real WebGL', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('/');
  const status = page.locator('#status');
  await expect(status).toContainText('volume', { timeout: 60_000 });
  expect(Number(await status.getAttribute('data-volume'))).toBeCloseTo(24000, 6);
  await expect(page.locator('#loading')).toHaveClass(/done/);

  // The canvas must show the body, not just the background: sample the center pixel.
  const shot = await page.locator('#viewport').screenshot();
  const center = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    return Array.from(ctx.getImageData(img.width >> 1, img.height >> 1, 1, 1).data.slice(0, 3));
  }, shot.toString('base64'));
  const background = [0xd8, 0xdd, 0xe2];
  expect(center.some((v, i) => Math.abs(v - background[i]) > 25)).toBe(true);
  expect(errors).toEqual([]);
});
