import { expect, test } from '@playwright/test';
import { openApp } from './helpers';

test('the geometry kernel runs in the Web Worker and returns exact geometry', async ({ page }) => {
  const errors = await openApp(page);
  const box = await page.evaluate(async () => {
    const c = (window as any).__caddy;
    await c.kernelReady;
    const m = await c.kernel.call('testBox', 40, 30, 20);
    return { volume: m.volume, triangles: m.indices.length / 3, faces: new Set(m.faceGroups.map((g: any) => g.faceId)).size, edges: new Set(m.edgeGroups.map((g: any) => g.edgeId)).size };
  });
  expect(box.volume).toBeCloseTo(24000, 6);
  expect(box).toMatchObject({ triangles: 12, faces: 6, edges: 12 });
  expect(errors).toEqual([]);
});
