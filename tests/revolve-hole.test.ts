// Acceptance tests for Revolve and Hole against exact formulas.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, HoleSpot, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import type { Frame, Vec3 } from '../src/model/types';
import { addLine, addPt, newId, newSketchData, type SketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

function rect(sk: SketchData, x: number, y: number, w: number, h: number): void {
  const p = [addPt(sk, x, y), addPt(sk, x + w, y), addPt(sk, x + w, y + h), addPt(sk, x, y + h)];
  [0, 1, 2, 3].forEach((i) => addLine(sk, p[i], p[(i + 1) % 4]));
}
const rectProfile = (x: number, y: number, w: number, h: number, frame: Frame = ORIGIN.XZ): ProfileSpec => { const sk = newSketchData(); rect(sk, x, y, w, h); return profileSpec(frame, sketchProfiles(sk)[0]); };
const Z: { A: Vec3; d: Vec3 } = { A: [0, 0, 0], d: [0, 0, 1] };
const revolve = (profile: ProfileSpec, angle: number, ang0 = 0, operation: 'Join' | 'Cut' | 'New body' = 'New body', bodyId: string | null = 'b1', axis = Z): BuildStep =>
  ({ kind: 'revolve', id: 'r1', profile, axis, ang0, angle, operation, bodyId });
const plate = (w = 60, d = 40, h = 8): BuildStep => ({ kind: 'extrude', id: 'e1', profile: rectProfile(0, 0, w, d, ORIGIN.XY), face: null, ...extrudeRange(h, 'One side', 0), operation: 'New body', bodyId: 'b1' });
const onTop = (x: number, y: number, h = 8): HoleSpot => ({ face: { bodyId: 'b1', n: [0, 0, 1], w: h, p: [x, y, h] } });
const hole = (at: (HoleSpot | null)[], d: number, extra: Partial<Extract<BuildStep, { kind: 'hole' }>> = {}): BuildStep =>
  ({ kind: 'hole', id: 'h1', at, d, through: true, depth: 0, type: 'Simple', cbD: 0, cbDepth: 0, csD: 0, ...extra });

describe('revolve', () => {
  // washer: a 10 × 6 rectangle from radius 10 to 20 on the XZ plane, spun around Z
  it('washer 360°: exact volume 4712.4 (the prototype got 4706.4 from facets)', () => {
    const r = buildModel([revolve(rectProfile(10, 0, 10, 5), 360)]);
    expect(r.steps[0].error).toBeFalsy();
    expect(r.bodies[0].volume).toBeCloseTo(Math.PI * (400 - 100) * 5, 6);
    expect(Math.PI * 300 * 5).toBeCloseTo(4712.4, 1);
    expect(r.bodies[0].faces.filter((f) => !f.planar)).toHaveLength(2); // true inner and outer cylinders
  });

  it('washer 90°: a quarter of it (1178.1), with flat end caps, starting at the sketch plane', () => {
    const b = buildModel([revolve(rectProfile(10, 0, 10, 5), 90)]).bodies[0];
    expect(b.volume).toBeCloseTo((Math.PI * 300 * 5) / 4, 6);
    expect(b.volume).toBeCloseTo(1178.1, 1);
    expect(b.faces.filter((f) => f.planar)).toHaveLength(4); // top, bottom and the two end caps
    // the profile is on the XZ plane at +x; turning right-handed about +Z sweeps toward +y
    expect(b.box[0].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 0]);
    expect(b.box[1].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([20, 20, 5]);
  });

  it('symmetric and negative angles sweep the other way', () => {
    const sym = buildModel([revolve(rectProfile(10, 0, 10, 5), 90, -45)]).bodies[0];
    expect(sym.volume).toBeCloseTo((Math.PI * 300 * 5) / 4, 6);
    expect(sym.box[0][1]).toBeCloseTo(-20 * Math.SQRT1_2, 5);
    expect(sym.box[1][1]).toBeCloseTo(20 * Math.SQRT1_2, 5);
    const neg = buildModel([revolve(rectProfile(10, 0, 10, 5), 90, -90)]).bodies[0];
    expect(neg.box[0][1]).toBeCloseTo(-20, 5);
    expect(neg.box[1][1]).toBeCloseTo(0, 5);
  });

  it('a profile touching the axis makes a solid cylinder, exact', () => {
    const b = buildModel([revolve(rectProfile(0, 0, 10, 20), 360)]).bodies[0];
    expect(b.volume).toBeCloseTo(Math.PI * 100 * 20, 6);
  });

  it('clear errors: profile across the axis, axis off the sketch plane, zero angle', () => {
    expect(buildModel([revolve(rectProfile(-5, 0, 10, 5), 360)]).steps[0].note).toMatch(/crosses the axis/);
    expect(buildModel([revolve(rectProfile(10, 0, 10, 5), 360, 0, 'New body', 'b1', { A: [0, 0, 0], d: [0, 1, 0] })]).steps[0].note).toMatch(/lie in the sketch's plane/);
    expect(buildModel([revolve(rectProfile(10, 0, 10, 5), 0)]).steps[0].note).toMatch(/more than 0°/);
  });

  it('revolve cut: a groove around a cylinder', () => {
    const cyl: BuildStep = { ...revolve(rectProfile(0, 0, 10, 20), 360), id: 'r0' } as BuildStep;
    const groove = revolve(rectProfile(8, 8, 2, 4), 360, 0, 'Cut', null);
    const r = buildModel([cyl, groove]);
    expect(r.steps[1].error).toBeFalsy();
    expect(r.bodies[0].volume).toBeCloseTo(Math.PI * 100 * 20 - Math.PI * (100 - 64) * 4, 6);
  });
});

describe('hole', () => {
  const V = 60 * 40 * 8;
  it('Ø6 through all in an 8 mm plate removes π·9·8 = 226.19', () => {
    const r = buildModel([plate(), hole([onTop(20, 20)], 6)]);
    expect(r.steps[1].error).toBeFalsy();
    expect(V - r.bodies[0].volume).toBeCloseTo(Math.PI * 9 * 8, 6);
    expect(Math.PI * 72).toBeCloseTo(226.19, 2);
    expect(r.bodies[0].faces.some((f) => f.surf === 'h1:h0' && !f.planar)).toBe(true);
  });
  it('Ø6 × 5 blind removes 141.37', () => {
    const b = buildModel([plate(), hole([onTop(20, 20)], 6, { through: false, depth: 5 })]).bodies[0];
    expect(V - b.volume).toBeCloseTo(Math.PI * 9 * 5, 6);
    expect(Math.PI * 45).toBeCloseTo(141.37, 2);
  });
  it('counterbore Ø11 × 3 + Ø6 through, and countersink Ø12 90° + Ø6 through, match the formulas', () => {
    const cb = buildModel([plate(), hole([onTop(20, 20)], 6, { type: 'Counterbore', cbD: 11, cbDepth: 3 })]).bodies[0];
    expect(V - cb.volume).toBeCloseTo(Math.PI * 5.5 * 5.5 * 3 + Math.PI * 9 * 5, 6);
    const cs = buildModel([plate(), hole([onTop(20, 20)], 6, { type: 'Countersink', csD: 12 })]).bodies[0];
    // a 90° cone from radius 6 down to radius 3 is 3 mm deep
    expect(V - cs.volume).toBeCloseTo((Math.PI * 3 * (36 + 18 + 9)) / 3 + Math.PI * 9 * 5, 6);
  });
  it('several holes in one feature; a hole on a sketch point drills into its plane', () => {
    const r = buildModel([plate(), hole([onTop(10, 10), onTop(30, 10), { c: [50, 30, 8], dir: [0, 0, -1] }], 4)]);
    expect(V - r.bodies[0].volume).toBeCloseTo(3 * Math.PI * 4 * 8, 6);
    expect(r.bodies[0].faces.filter((f) => !f.planar)).toHaveLength(3);
  });
  it('a hole stays on its face when the plate gets thicker', () => {
    const b = buildModel([plate(60, 40, 12), hole([onTop(20, 20, 8)], 6, { through: false, depth: 5 })]).bodies[0];
    expect(60 * 40 * 12 - b.volume).toBeCloseTo(Math.PI * 9 * 5, 6); // still a 5 mm deep hole from the (new) top
  });
  it('clear errors', () => {
    expect(buildModel([plate(), hole([onTop(20, 20)], 0)]).steps[1].note).toMatch(/diameter/);
    expect(buildModel([plate(), hole([onTop(20, 20)], 6, { through: false, depth: 0 })]).steps[1].note).toMatch(/depth/);
    expect(buildModel([plate(), hole([onTop(20, 20)], 6, { type: 'Counterbore', cbD: 5, cbDepth: 3 })]).steps[1].note).toMatch(/larger diameter/);
    expect(buildModel([plate(), hole([null], 6)]).steps[1].note).toBe('its hole points are gone');
    const untouched = buildModel([plate(), hole([onTop(20, 20)], 0)]).bodies[0];
    expect(untouched.volume).toBeCloseTo(V, 6);
  });
});
void newId;
