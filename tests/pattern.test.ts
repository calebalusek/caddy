// Acceptance tests for Pattern against exact formulas (docs/ACCEPTANCE-TESTS.md).
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import { patternTransforms, type PatternParams } from '../src/model/pattern';
import type { Vec3 } from '../src/model/types';
import { addLine, addPt, newSketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const rectP = (x: number, y: number, w: number, d: number): ProfileSpec => { const sk = newSketchData(); const p = [addPt(sk, x, y), addPt(sk, x + w, y), addPt(sk, x + w, y + d), addPt(sk, x, y + d)]; p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % 4])); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const plate = (w = 60, d = 40, h = 8): BuildStep => ({ kind: 'extrude', id: 'e1', profile: rectP(0, 0, w, d), face: null, ...extrudeRange(h, 'One side', 0), operation: 'New body', bodyId: 'b1' });
const hole = (x: number, y: number, d: number, z = 8): BuildStep => ({ kind: 'hole', id: 'h1', at: [{ face: { bodyId: 'b1', n: [0, 0, 1], w: z, p: [x, y, z] } }], d, through: true, depth: 0, type: 'Simple', cbD: 0, cbDepth: 0, csD: 0 });
const base = (): PatternParams => ({ ptype: 'Rectangular', what: 'Features', feats: ['h1'], bodies: [], layout: 'Spacing', dir1: 'X', n1: 2, d1: 0, dir2: 'None', n2: 2, d2: 0, v1: null, v2: null, e1: null, e2: null, cols: 2, rows: 2, gaps: 'Equal', m1: 0, m2: 0, axis: 'Z', axC: null, axD: null, radius: 0, count: 4, angle: 360 });
const pat = (p: Partial<PatternParams>, bodyIds: string[] = []): BuildStep => ({ kind: 'pattern', id: 'pt1', params: { ...base(), ...p }, bodyIds });
const V = (w: number, d: number, h: number): number => w * d * h;
const holeV = (dia: number, h = 8): number => Math.PI * (dia / 2) ** 2 * h;
const run = (...s: BuildStep[]): ReturnType<typeof buildModel> => { const r = buildModel(s); r.steps.forEach((x) => expect(x.note || '', x.id).toBe('')); return r; };
const holesOf = (r: ReturnType<typeof buildModel>): number => r.bodies[0].faces.filter((f) => !f.planar).length;
const centers = (P: PatternParams, c0: Vec3, w: number): number[][] => { const t = patternTransforms(P, c0, () => w); expect(t.err).toBeUndefined(); return t.list.map((x) => c0.map((v, i) => v + x.o[i])); };
const r3 = (list: number[]): number[] => list.map((v) => +v.toFixed(3));

describe('rectangular pattern', () => {
  it('3×2 grid of Ø6 holes, 15 × 12 spacing: all six open, volume exact', () => {
    const r = run(plate(), hole(15, 12, 6), pat({ n1: 3, d1: 15, dir2: 'Y', n2: 2, d2: 12 }));
    expect(r.bodies[0].volume).toBeCloseTo(V(60, 40, 8) - 6 * holeV(6), 5);
    expect(holesOf(r)).toBe(6);
  });
  it('one direction; spacing 0 piles the copies on the original (volume of one hole)', () => {
    const r = run(plate(), hole(10, 20, 6), pat({ n1: 4, d1: 12 }));
    expect(r.bodies[0].volume).toBeCloseTo(V(60, 40, 8) - 4 * holeV(6), 5);
    expect(run(plate(), hole(10, 20, 6), pat({ n1: 4, d1: 0 })).bodies[0].volume).toBeCloseTo(V(60, 40, 8) - holeV(6), 5);
  });
  it('Join pattern: copies of a boss fuse to the body', () => {
    const boss: BuildStep = { kind: 'extrude', id: 'e2', profile: rectP(5, 5, 6, 6), face: null, z0: 8, depth: 5, operation: 'Join', bodyId: 'b1' };
    const r = run(plate(), boss, { ...pat({ feats: ['e2'], n1: 3, d1: 15 }) });
    expect(r.bodies[0].volume).toBeCloseTo(V(60, 40, 8) + 3 * 6 * 6 * 5, 5);
  });
  it('a pattern of a new body feature makes the copies as new bodies', () => {
    const r = run(plate(20, 20, 5), pat({ feats: ['e1'], n1: 3, d1: 30 }, ['b2', 'b3']));
    expect(r.bodies.map((b) => b.id).sort()).toEqual(['b1', 'b2', 'b3']);
    r.bodies.forEach((b) => expect(b.volume).toBeCloseTo(2000, 6));
    expect(r.bodies.find((b) => b.id === 'b3')!.box[0][0]).toBeCloseTo(60, 6);
  });
  it('body pattern copies whole bodies', () => {
    const r = run(plate(20, 20, 5), pat({ what: 'Bodies', bodies: ['b1'], feats: [], dir1: 'Y', n1: 2, d1: 25 }, ['b2']));
    expect(r.bodies).toHaveLength(2);
    expect(r.bodies.find((b) => b.id === 'b2')!.box[0][1]).toBeCloseTo(25, 6);
  });
});

describe('circular pattern', () => {
  const c = { axis: 'Pick' as const, axC: [40, 40, 0] as Vec3, axD: [0, 0, 1] as Vec3, ptype: 'Circular' as const };
  it('6 holes on a Ø40 bolt circle (360°): evenly at 60°, volume exact', () => {
    const r = run(plate(80, 80, 8), hole(60, 40, 6), pat({ ...c, count: 6 }));
    expect(r.bodies[0].volume).toBeCloseTo(V(80, 80, 8) - 6 * holeV(6), 5);
    expect(holesOf(r)).toBe(6);
  });
  it('4 copies over 90° land at 0°, 30°, 60°, 90°', () => {
    const t = patternTransforms({ ...base(), ...c, count: 4, angle: 90 }, [60, 40, 8], () => 0);
    expect(t.list.map((x) => +x.rot!.deg.toFixed(6))).toEqual([30, 60, 90]); // the original is the 0° one
    expect(run(plate(80, 80, 8), hole(60, 40, 6), pat({ ...c, count: 4, angle: 90 })).bodies[0].volume).toBeCloseTo(V(80, 80, 8) - 4 * holeV(6), 5);
  });
  it('radius 15 from a hole at the plate center: six holes on the circle, center solid', () => {
    const r = run(plate(60, 40, 8), hole(30, 20, 6), pat({ ptype: 'Circular', axis: 'Pick', axC: [30, 20, 0], axD: [0, 0, 1], radius: 15, count: 6 }));
    expect(r.bodies[0].volume).toBeCloseTo(V(60, 40, 8) - 6 * holeV(6), 5); // the original at the center is gone
    expect(holesOf(r)).toBe(6);
  });
});

describe('fit to edges', () => {
  const e = { e1: { a: [0, 0, 8] as Vec3, b: [60, 0, 8] as Vec3 }, e2: { a: [0, 0, 8] as Vec3, b: [0, 40, 8] as Vec3 } };
  const fit = (p: Partial<PatternParams>): PatternParams => ({ ...base(), layout: 'Fit to edges', ...e, ...p });
  it('Equal 3×2 with Ø4 holes: x 14/30/46 (gaps 12), y 12.667/27.333 (gaps 10.667)', () => {
    const cs = centers(fit({ cols: 3, rows: 2 }), [10, 10, 8], 4);
    expect(r3(cs.map((p) => p[0]))).toEqual([14, 30, 46, 14, 30, 46]);
    expect(r3(cs.map((p) => p[1]))).toEqual([12.667, 12.667, 12.667, 27.333, 27.333, 27.333]);
    const r = run(plate(), hole(10, 10, 4), pat({ layout: 'Fit to edges', ...e, cols: 3, rows: 2 }));
    expect(r.bodies[0].volume).toBeCloseTo(V(60, 40, 8) - 6 * holeV(4), 5); // the original moved into the grid
  });
  it('Equal 6×3: x gaps 5.143, y gaps 7', () => {
    const cs = centers(fit({ cols: 6, rows: 3 }), [10, 10, 8], 4);
    const xs = [...new Set(cs.map((p) => p[0]))], ys = [...new Set(cs.map((p) => p[1]))];
    expect(r3(xs.slice(1).map((x, i) => x - xs[i] - 4))).toEqual([5.143, 5.143, 5.143, 5.143, 5.143]);
    expect(+(xs[0] - 2).toFixed(3)).toBe(5.143);
    expect(r3(ys.slice(1).map((y, i) => y - ys[i] - 4))).toEqual([7, 7]);
    expect(+(ys[0] - 2).toFixed(3)).toBe(7);
  });
  it('Custom edge gap 5, 3×2: x 7/30/53, y 7/33; too many gives a clear message', () => {
    const cs = centers(fit({ cols: 3, rows: 2, gaps: 'Custom', m1: 5, m2: 5 }), [10, 10, 8], 4);
    expect(r3(cs.map((p) => p[0]).slice(0, 3))).toEqual([7, 30, 53]);
    expect([...new Set(r3(cs.map((p) => p[1])))]).toEqual([7, 33]);
    expect(patternTransforms(fit({ cols: 30, rows: 2, gaps: 'Custom', m1: 5 }), [10, 10, 8], () => 4).err).toBe('Those edge distances leave no room for this many');
    expect(patternTransforms(fit({ cols: 30, rows: 2 }), [10, 10, 8], () => 4).err).toBe("That many don't fit between the edges");
    expect(patternTransforms(fit({ e2: null }), [10, 10, 8], () => 4).err).toMatch(/Click an edge/);
  });
});

describe('pattern errors', () => {
  it('clear messages', () => {
    const note = (st: BuildStep): string => buildModel([plate(), hole(10, 10, 4), st]).steps[2].note || '';
    expect(note(pat({ feats: [] }))).toBe('click a face of the feature to copy');
    expect(note(pat({ feats: ['zz'] }))).toBe('the feature to copy is gone');
    expect(note(pat({ n1: 1 }))).toBe('set a count of 2 or more');
    expect(note(pat({ what: 'Bodies', bodies: [] }))).toBe('click a body to copy');
    expect(note(pat({ layout: 'Fit to edges', cols: 2, rows: 2 }))).toMatch(/Click an edge/);
  });
});
