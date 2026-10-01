// Threads: helical grooves cut into a shaft or into the wall of a hole. Volumes are checked against the
// groove's cross-section swept once round per pitch (Pappus), which is exact for a groove of this shape.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import { DEPTH_K, grooveSection, standardSize } from '../src/model/threads';
import { addLine, addPt, newSketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const circleP = (r: number): ProfileSpec => { const sk = newSketchData(); sk.curves.push({ id: 'c1', type: 'circle', c: addPt(sk, 0, 0), r }); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const rectP = (w: number, d: number): ProfileSpec => { const sk = newSketchData(); const p = [addPt(sk, -w / 2, -d / 2), addPt(sk, w / 2, -d / 2), addPt(sk, w / 2, d / 2), addPt(sk, -w / 2, d / 2)]; p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % 4])); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const shaft = (r: number, L: number): BuildStep => ({ kind: 'extrude', id: 'e1', profile: circleP(r), face: null, ...extrudeRange(L, 'One side', 0), operation: 'New body', bodyId: 'b1' });
const blockWithHole = (r: number, L: number): BuildStep[] => [
  { kind: 'extrude', id: 'e1', profile: rectP(30, 30), face: null, ...extrudeRange(L, 'One side', 0), operation: 'New body', bodyId: 'b1' },
  { kind: 'hole', id: 'h1', at: [{ face: { bodyId: 'b1', n: [0, 0, 1], w: L, p: [0, 0, L] } }], d: 2 * r, through: true, depth: 0, type: 'Simple', cbD: 0, cbDepth: 0, csD: 0 },
];
const thread = (p: [number, number, number], extra: Partial<Extract<BuildStep, { kind: 'thread' }>> = {}): BuildStep =>
  ({ kind: 'thread', id: 't1', face: { bodyId: 'b1', n: [1, 0, 0], w: 0, p }, pitch: 0, depth: 0, length: 0, hand: 'Right', ...extra });
const vol = (steps: BuildStep[]): { v: number; info?: string; note?: string } => { const r = buildModel(steps); return { v: r.bodies[0].volume, info: r.steps[r.steps.length - 1].info, note: r.steps[r.steps.length - 1].note }; };

describe('thread', () => {
  it('standard sizes: a Ø10 shaft is M10 × 1.5, a Ø6.8 hole is a tapped M8 × 1.25', () => {
    expect(standardSize(10, false)).toEqual({ nominal: 10, pitch: 1.5 });
    expect(standardSize(8, false)).toEqual({ nominal: 8, pitch: 1.25 });
    expect(standardSize(6.8, true)).toEqual({ nominal: 8, pitch: 1.25 });
    expect(standardSize(5, true).nominal).toBe(6); // a Ø5 hole is the tap drill for M6
  });

  it('external M10 × 1.5, 20 mm long: the groove removes the swept section area (exact to 0.3 %)', () => {
    const R = 5, L = 20, P = 1.5, h = DEPTH_K * P;
    const r = vol([shaft(R, L), thread([R, 0, 2])]);
    expect(r.note || '').toBe('');
    expect(r.info).toBe('External thread, standard M10 coarse, pitch 1.5 mm');
    const g = grooveSection(R, P, h, false), exact = g.area * 2 * Math.PI * g.rho * (L / P);
    expect(Math.PI * R * R * L - r.v).toBeCloseTo(exact, 0);
    expect(Math.abs(Math.PI * R * R * L - r.v - exact) / exact).toBeLessThan(0.003);
  });

  it('a left-hand thread removes the same material; a custom pitch and depth are used as given', () => {
    const R = 5, L = 20;
    const right = vol([shaft(R, L), thread([R, 0, 2])]).v, left = vol([shaft(R, L), thread([R, 0, 2], { hand: 'Left' })]).v;
    expect(left).toBeCloseTo(right, 2);
    const P = 2, d = 0.8, c = vol([shaft(R, L), thread([R, 0, 2], { pitch: P, depth: d })]);
    expect(c.info).toBe('External thread, pitch 2 mm');
    const g = grooveSection(R, P, d, false);
    expect(Math.abs(Math.PI * R * R * L - c.v - g.area * 2 * Math.PI * g.rho * (L / P)) / (g.area * 2 * Math.PI * g.rho * (L / P))).toBeLessThan(0.004);
  });

  it('a shorter thread starts at the end nearest the click: 10 mm from the bottom, then from the top', () => {
    const R = 5, L = 20, P = 1.5, h = DEPTH_K * P, g = grooveSection(R, P, h, false);
    const part = (z: number): number => Math.PI * R * R * L - vol([shaft(R, L), thread([R, 0, z], { length: 10 })]).v;
    const a = part(2), b = part(18);
    expect(a).toBeCloseTo(b, 1); // the same amount from either end
    const full = g.area * 2 * Math.PI * g.rho * (L / P);
    expect(a).toBeGreaterThan(full * 0.45);
    expect(a).toBeLessThan(full * 0.6);
  });

  it('internal thread in a Ø6.8 hole (M8 × 1.25), 20 mm deep: the groove goes out into the wall', () => {
    const R = 3.4, L = 20, P = 1.25, h = DEPTH_K * P;
    const base = vol(blockWithHole(R, L)).v;
    const r = vol([...blockWithHole(R, L), thread([R, 0, 10], { face: { bodyId: 'b1', n: [-1, 0, 0], w: 0, p: [R, 0, 2] } })]);
    expect(r.note || '').toBe('');
    expect(r.info).toBe('Internal thread, standard M8 coarse, pitch 1.25 mm');
    const g = grooveSection(R, P, h, true), exact = g.area * 2 * Math.PI * g.rho * (L / P);
    expect(base - r.v).toBeCloseTo(exact, 0); // the groove is material taken out of the wall
    expect(Math.abs(base - r.v - exact) / exact).toBeLessThan(0.005);
  });

  it('clear errors', () => {
    const note = (extra: Partial<Extract<BuildStep, { kind: 'thread' }>>, steps: BuildStep[] = [shaft(5, 20)]): string => vol([...steps, thread([5, 0, 2], extra)]).note || '';
    expect(note({ pitch: 0.05 })).toMatch(/at least 0.1/);
    expect(note({ length: 0.5 }) ).toMatch(/shorter than one pitch/);
    expect(note({ depth: 9 })).toMatch(/deeper than the shaft/);
    expect(note({ face: { bodyId: 'zz', n: [1, 0, 0], w: 0, p: [5, 0, 2] } })).toBe('its body is gone');
    expect(note({ face: { bodyId: 'b1', n: [1, 0, 0], w: 0, p: [50, 50, 50] } })).toBe('its face is gone');
    const flat = note({ face: { bodyId: 'b1', n: [0, 0, 1], w: 20, p: [0, 0, 20] } });
    expect(flat).toBe('threads go on round faces: a shaft or a hole');
  });
});
