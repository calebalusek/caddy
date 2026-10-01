// Acceptance tests for Shell against exact formulas.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, FaceSpec, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import { addLine, addPt, newSketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const rectP = (w: number, d: number): ProfileSpec => { const sk = newSketchData(); const p = [addPt(sk, 0, 0), addPt(sk, w, 0), addPt(sk, w, d), addPt(sk, 0, d)]; p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % 4])); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const circP = (r: number): ProfileSpec => { const sk = newSketchData(); sk.curves.push({ id: 'c1', type: 'circle', c: addPt(sk, 0, 0), r }); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const box = (w: number, d: number, h: number): BuildStep => ({ kind: 'extrude', id: 'e1', profile: rectP(w, d), face: null, ...extrudeRange(h, 'One side', 0), operation: 'New body', bodyId: 'b1' });
const cyl = (r: number, h: number): BuildStep => ({ kind: 'extrude', id: 'e1', profile: circP(r), face: null, ...extrudeRange(h, 'One side', 0), operation: 'New body', bodyId: 'b1' });
const top = (x: number, y: number, z: number): FaceSpec => ({ bodyId: 'b1', n: [0, 0, 1], w: z, p: [x, y, z] });
const shell = (faces: FaceSpec[], thickness: number, direction: 'Inside' | 'Outside' = 'Inside'): BuildStep => ({ kind: 'shell', id: 's1', bodyId: 'b1', faces, thickness, direction });

describe('shell', () => {
  it('box 40×30×20, top open, 2 mm inside: 7152; closed hollow 9024 (cavity 36×26×16); outside 2 mm top open 8912', () => {
    const a = buildModel([box(40, 30, 20), shell([top(20, 15, 20)], 2)]);
    expect(a.steps[1].note || '').toBe('');
    expect(a.bodies[0].volume).toBeCloseTo(24000 - 36 * 26 * 18, 5);
    expect(a.bodies[0].volume).toBeCloseTo(7152, 5);
    const c = buildModel([box(40, 30, 20), shell([], 2)]);
    expect(c.steps[1].note || '').toBe('');
    expect(c.bodies[0].volume).toBeCloseTo(24000 - 36 * 26 * 16, 5);
    expect(c.bodies[0].volume).toBeCloseTo(9024, 5);
    const o = buildModel([box(40, 30, 20), shell([top(20, 15, 20)], 2, 'Outside')]);
    expect(o.steps[1].note || '').toBe('');
    expect(o.bodies[0].volume).toBeCloseTo(44 * 34 * 22 - 24000, 4);
    expect(o.bodies[0].volume).toBeCloseTo(8912, 4);
  });
  it('cup Ø20 × 20, top open, 2 mm: exact ring volume', () => {
    const r = buildModel([cyl(10, 20), shell([top(0, 0, 20)], 2)]);
    expect(r.steps[1].note || '').toBe('');
    expect(r.bodies[0].volume).toBeCloseTo(Math.PI * 100 * 20 - Math.PI * 64 * 18, 5);
  });
  it('plate with a through hole: the hole gets its own wall', () => {
    const hole: BuildStep = { kind: 'hole', id: 'h1', at: [{ face: top(30, 20, 10) }], d: 12, through: true, depth: 0, type: 'Simple', cbD: 0, cbDepth: 0, csD: 0 };
    const r = buildModel([box(60, 40, 10), hole, shell([top(10, 10, 10)], 1.5)]);
    expect(r.steps[2].note || '').toBe('');
    const outerV = 60 * 40 * 10 - Math.PI * 36 * 10;
    const cavity = (60 - 3) * (40 - 3) * (10 - 1.5) - Math.PI * (6 + 1.5) ** 2 * (10 - 1.5);
    expect(r.bodies[0].volume).toBeCloseTo(outerV - cavity, 2);
    expect(r.bodies[0].faces.some((f) => f.surf.startsWith('s1:i') && !f.planar)).toBe(true);
  });
  it('clear errors: walls too thick, no thickness, faces gone', () => {
    const note = (st: BuildStep): string => buildModel([box(20, 20, 20), st]).steps[1].note || '';
    expect(note(shell([top(10, 10, 20)], 25))).toBe('that thickness is too big for this body');
    expect(note(shell([], 12))).toBe('that thickness is too big for this body');
    expect(note(shell([top(10, 10, 20)], 0))).toMatch(/more than 0/);
    expect(note(shell([top(10, 10, 99)], 2))).toBe('its faces are gone');
    expect(buildModel([box(20, 20, 20), shell([top(10, 10, 20)], 25)]).bodies[0].volume).toBeCloseTo(8000, 6); // body left whole
  });
});

describe('live preview differences', () => {
  it('a shell preview reports exactly the material it removes (the cavity), and nothing added', async () => {
    const { buildDraft } = await import('../src/kernel/model');
    const r = buildDraft([box(40, 30, 20)], shell([top(20, 15, 20)], 2));
    expect(r.base.bodies[0].volume).toBeCloseTo(24000, 6);
    expect(r.draft.bodies[0].volume).toBeCloseTo(7152, 5);
    expect(r.removed.reduce((s, m) => s + m.volume, 0)).toBeCloseTo(36 * 26 * 18, 5);
    expect(r.added).toHaveLength(0);
  });
  it('a new body preview is all "added"; a failed preview shows nothing', async () => {
    const { buildDraft } = await import('../src/kernel/model');
    const r = buildDraft([], box(10, 10, 10));
    expect(r.added.reduce((s, m) => s + m.volume, 0)).toBeCloseTo(1000, 6);
    const bad = buildDraft([box(20, 20, 20)], shell([top(10, 10, 20)], 25));
    expect(bad.removed).toHaveLength(0);
    expect(bad.added).toHaveLength(0);
  });
});
