// Wall-thickness check and measuring, against exact numbers.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, EdgeInfo, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import { edgeSize, weightGrams } from '../src/model/measure';
import { analyzeThickness } from '../src/model/thickness';
import { addLine, addPt, newSketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const rectP = (w: number, d: number): ProfileSpec => { const sk = newSketchData(); const p = [addPt(sk, 0, 0), addPt(sk, w, 0), addPt(sk, w, d), addPt(sk, 0, d)]; p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % 4])); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const circleP = (r: number): ProfileSpec => { const sk = newSketchData(); sk.curves.push({ id: 'c1', type: 'circle', c: 'O', r }); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const ext = (profile: ProfileSpec, h: number): BuildStep => ({ kind: 'extrude', id: 'e1', profile, face: null, ...extrudeRange(h, 'One side', 0), operation: 'New body', bodyId: 'b1' });

describe('wall thickness', () => {
  it('a solid block: the thinnest wall is its smallest size', () => {
    const r = buildModel([ext(rectP(40, 30), 20)]);
    const t = analyzeThickness(r.bodies.map((b) => b.mesh), 0);
    expect(t.thinnest).toBeCloseTo(20, 2);
    expect(t.tris).toHaveLength(0);
    expect(t.total).toBeCloseTo(2 * (40 * 30 + 40 * 20 + 30 * 20), 4);
  });
  it('flags the faces that are thinner than the limit, and only those', () => {
    const r = buildModel([ext(rectP(40, 30), 20)]);
    const m = r.bodies.map((b) => b.mesh);
    expect(analyzeThickness(m, 25).area).toBeCloseTo(2 * 40 * 30, 4); // top and bottom (20 thick) are under 25; the sides (30 and 40) are not
    expect(analyzeThickness(m, 35).area).toBeCloseTo(2 * 40 * 30 + 2 * 40 * 20, 4);
    expect(analyzeThickness(m, 10).area).toBe(0);
  });
  it('a round pin is as thick as its diameter', () => {
    const r = buildModel([ext(circleP(3), 15)]);
    expect(analyzeThickness(r.bodies.map((b) => b.mesh), 0).thinnest).toBeCloseTo(6, 1);
  });
  it('a hollowed block shows its 2 mm walls', () => {
    const r = buildModel([ext(rectP(40, 30), 20), { kind: 'shell', id: 's1', bodyId: 'b1', faces: [], thickness: 2, direction: 'Inside' }]);
    expect(r.steps.every((s) => !s.error)).toBe(true);
    const t = analyzeThickness(r.bodies.map((b) => b.mesh), 3);
    expect(t.thinnest).toBeCloseTo(2, 1);
    expect(t.area).toBeGreaterThan(0);
  });
});

describe('measuring', () => {
  it('weighs by density, volume and infill', () => {
    expect(weightGrams(1000, 'PLA', 100)).toBeCloseTo(1.24, 6);
    expect(weightGrams(40 * 30 * 20, 'PETG', 20)).toBeCloseTo(24 * 1.27 * 0.2, 6);
    expect(weightGrams(1000, 'nothing', 100)).toBeCloseTo(1.24, 6);
  });
  it('edge sizes: line, circle, arcs of both kinds', () => {
    const line = { kind: 'line', a: [0, 0, 0], b: [3, 4, 0], mid: [1.5, 2, 0] } as unknown as EdgeInfo;
    expect(edgeSize(line)!.length).toBeCloseTo(5, 9);
    const circle = { kind: 'round', a: [5, 0, 0], b: [5, 0, 0], mid: [5, 0, 0], R: 5, closed: true } as unknown as EdgeInfo;
    expect(edgeSize(circle)).toMatchObject({ kind: 'circle', diameter: 10 });
    expect(edgeSize(circle)!.length).toBeCloseTo(10 * Math.PI, 9);
    const quarter = { kind: 'round', a: [5, 0, 0], b: [0, 5, 0], mid: [5 * Math.SQRT1_2, 5 * Math.SQRT1_2, 0], R: 5, closed: false } as unknown as EdgeInfo;
    expect(edgeSize(quarter)!.length).toBeCloseTo((Math.PI / 2) * 5, 9);
    const threeQuarter = { kind: 'round', a: [5, 0, 0], b: [0, 5, 0], mid: [-5 * Math.SQRT1_2, -5 * Math.SQRT1_2, 0], R: 5, closed: false } as unknown as EdgeInfo;
    expect(edgeSize(threeQuarter)!.length).toBeCloseTo(((3 * Math.PI) / 2) * 5, 9);
    expect(edgeSize({ kind: 'other' } as unknown as EdgeInfo)).toBeNull();
  });
});
