import { beforeAll, describe, it } from 'vitest';
import { assembleWire, cast, getOC, makeCylinder, makeHelix, makeLine, measureVolume } from 'replicad';
import { loadKernel } from './helpers/kernel';
beforeAll(loadKernel);
const polyWire = (pts: [number, number, number][]) => assembleWire(pts.map((p, i) => makeLine(p, pts[(i + 1) % pts.length])));
describe('proto', () => {
  it('tolerances', () => {
    const oc = getOC();
    const R = 5, L = 20, P = 1.5, h = 0.5413 * P, g = 0.875 * P, f = 0.25 * P, e = 0.05 * P, t = Math.tan(Math.PI / 6);
    const cyl = makeCylinder(R, L, [0, 0, 0], [0, 0, 1]);
    const helix = makeHelix(P, L + 2 * P, R, [0, 0, -P], [0, 0, 1], false);
    const wo = g / 2 + e * t, yo = R + e, wi = f / 2, yi = R - h, z = -P;
    const prof = polyWire([[yo, 0, z - wo], [yo, 0, z + wo], [yi, 0, z + wi], [yi, 0, z - wi]]);
    for (const tol of [1e-4, 1e-3, 5e-3, 2e-2]) {
      try {
        const b = new oc.BRepOffsetAPI_MakePipeShell(helix.wrapped);
        b.SetMode(true);
        b.SetTolerance(tol, tol * 10, 1e-2);

        b.Add(prof.wrapped, false, false);
        b.Build(); b.MakeSolid();
        const groove = cast(b.Shape()) as any;
        const t1 = performance.now();
        const out = cyl.cut(groove);
        console.log('tol', tol, 'cut ms', (performance.now() - t1).toFixed(0), 'removed', (measureVolume(cyl) - measureVolume(out)).toFixed(3));
      } catch (e: any) { console.log('fail tol', tol, e && e.message); }
    }
  });
});
