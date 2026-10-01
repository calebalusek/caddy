// Overhang check against exact areas.
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeOverhang } from '../src/model/overhang';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import type { Vec3 } from '../src/model/types';
import { addLine, addPt, newSketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const rectP = (x: number, y: number, w: number, d: number): ProfileSpec => { const sk = newSketchData(); const p = [addPt(sk, x, y), addPt(sk, x + w, y), addPt(sk, x + w, y + d), addPt(sk, x, y + d)]; p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % 4])); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const slab = (id: string, x: number, y: number, w: number, d: number, z0: number, h: number, op: 'New body' | 'Join' = 'New body'): BuildStep => ({ kind: 'extrude', id, profile: rectP(x, y, w, d), face: null, ...extrudeRange(h, 'One side', 0), z0, depth: h, operation: op, bodyId: 'b1' });
const meshesOf = (steps: BuildStep[]): { positions: Float32Array; normals: Float32Array; indices: Uint32Array }[] => buildModel(steps).bodies.map((b) => b.mesh);
const UP: Vec3 = [0, 0, 1];

describe('overhang check', () => {
  it('a T-shaped part: the two flat ledges under the top bar are exactly 2 × 10 × 20 = 400 mm²; the floor on the bed is not counted', () => {
    // stem 20 × 20 × 10 on the bed, a 40 × 20 × 10 bar on top that sticks out 10 mm each side
    const t = meshesOf([slab('e1', 10, 0, 20, 20, 0, 10), slab('e2', 0, 0, 40, 20, 10, 10, 'Join')]);
    const o = analyzeOverhang(t, UP, 45);
    expect(o.area).toBeCloseTo(400, 6);
    expect(o.worst).toBeCloseTo(90, 3);
    expect(o.severity.every((s) => Math.abs(s - 1) < 1e-6)).toBe(true); // flat ceilings are the worst case
    // a block sitting on the bed has nothing to support
    expect(analyzeOverhang(meshesOf([slab('e1', 0, 0, 30, 30, 0, 10)]), UP, 45).area).toBe(0);
  });
  it('a block floating above the bed (nothing under it) counts its whole underside', () => {
    expect(analyzeOverhang(meshesOf([slab('e1', 0, 0, 30, 30, 0, 10), { ...slab('e2', 50, 0, 20, 20, 10, 10), bodyId: 'b2' } as BuildStep]), UP, 45).area).toBeCloseTo(400, 6);
  });
  it('the angle limit decides: the same part flipped upside down has overhangs only where it leans out', () => {
    const t = meshesOf([slab('e1', 10, 0, 20, 20, 0, 10), slab('e2', 0, 0, 40, 20, 10, 10, 'Join')]);
    expect(analyzeOverhang(t, [0, 0, -1], 45).area).toBeCloseTo(0, 6); // upside down the bar is on the bed and the stem points up
    expect(analyzeOverhang(t, [1, 0, 0], 45).area).toBeGreaterThan(0);
  });
  it('a horizontal cylinder lying on the bed: the quarter of its side that faces down needs support', () => {
    const sk = newSketchData();
    sk.curves.push({ id: 'c1', type: 'circle', c: addPt(sk, 0, 0), r: 10 });
    const prof = profileSpec({ ...ORIGIN.YZ, o: [0, 0, 10] }, sketchProfiles(sk)[0]);
    const cyl: BuildStep = { kind: 'extrude', id: 'e1', profile: prof, face: null, ...extrudeRange(30, 'One side', 0), operation: 'New body', bodyId: 'b1' };
    const o = analyzeOverhang(meshesOf([cyl]), UP, 45);
    const exact = (2 * Math.PI * 10 * 30) / 4; // ±45° around the bottom line
    expect(Math.abs(o.area - exact) / exact).toBeLessThan(0.05);
    // a looser limit finds less, a stricter one more
    expect(analyzeOverhang(meshesOf([cyl]), UP, 60).area).toBeLessThan(o.area);
    expect(analyzeOverhang(meshesOf([cyl]), UP, 30).area).toBeGreaterThan(o.area);
  });
});
