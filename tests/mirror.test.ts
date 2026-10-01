// Acceptance tests for Mirror against exact numbers.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import { addLine, addPt, newSketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const rectP = (x: number, y: number, w: number, d: number): ProfileSpec => { const sk = newSketchData(); const p = [addPt(sk, x, y), addPt(sk, x + w, y), addPt(sk, x + w, y + d), addPt(sk, x, y + d)]; p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % 4])); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const block = (x: number, y: number, w: number, d: number, h: number): BuildStep => ({ kind: 'extrude', id: 'e1', profile: rectP(x, y, w, d), face: null, ...extrudeRange(h, 'One side', 0), operation: 'New body', bodyId: 'b1' });
const hole = (x: number, y: number, d: number, z: number): BuildStep => ({ kind: 'hole', id: 'h1', at: [{ face: { bodyId: 'b1', n: [0, 0, 1], w: z, p: [x, y, z] } }], d, through: true, depth: 0, type: 'Simple', cbD: 0, cbDepth: 0, csD: 0 });
const mirror = (operation: 'Join' | 'New body', plane: { o: [number, number, number]; n: [number, number, number] } | null, bodyIds: string[] = [], bodies = ['b1']): BuildStep => ({ kind: 'mirror', id: 'm1', bodies, plane, operation, bodyIds });
const run = (...s: BuildStep[]): ReturnType<typeof buildModel> => { const r = buildModel(s); r.steps.forEach((x) => expect(x.note || '', x.id).toBe('')); return r; };
const r6 = (v: number): number => +v.toFixed(6);

describe('mirror', () => {
  it('New body: a mirrored copy on the other side of the plane, same volume, true mirror image', () => {
    const r = run(block(10, 0, 30, 20, 8), hole(20, 10, 6, 8), mirror('New body', { o: [0, 0, 0], n: [1, 0, 0] }, ['b2']));
    expect(r.bodies.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    const a = r.bodies.find((b) => b.id === 'b1')!, b = r.bodies.find((x) => x.id === 'b2')!;
    expect(b.volume).toBeCloseTo(a.volume, 6);
    expect(a.volume).toBeCloseTo(30 * 20 * 8 - Math.PI * 9 * 8, 6);
    expect(b.box[0].map(r6)).toEqual([-40, 0, 0]);
    expect(b.box[1].map(r6)).toEqual([-10, 20, 8]);
    expect(b.faces).toHaveLength(a.faces.length);
    // the hole is still a true cylinder at the mirrored spot
    expect(b.faces.filter((f) => !f.planar)).toHaveLength(1);
    expect(a.faces.filter((f) => !f.planar)).toHaveLength(1);
  });
  it('mirroring across a tilted plane through a point moves the body to the right place', () => {
    // plane x = 50 (through [50,0,0]): a block at x 10..40 lands at x 60..90
    const r = run(block(10, 0, 30, 20, 8), mirror('New body', { o: [50, 0, 0], n: [1, 0, 0] }, ['b2']));
    const b = r.bodies.find((x) => x.id === 'b2')!;
    expect(b.box[0].map(r6)).toEqual([60, 0, 0]);
    expect(b.box[1].map(r6)).toEqual([90, 20, 8]);
    // a plane in z: a body above mirrors below
    const z = run(block(0, 0, 20, 20, 8), mirror('New body', { o: [0, 0, 0], n: [0, 0, 1] }, ['b2'])).bodies.find((x) => x.id === 'b2')!;
    expect(z.box[0][2]).toBeCloseTo(-8, 6);
    expect(z.box[1][2]).toBeCloseTo(0, 6);
  });
  it('Join across a face of the body makes one symmetric part: double the volume, one body, flat faces merged', () => {
    const r = run(block(0, 0, 60, 40, 8), hole(20, 20, 6, 8), mirror('Join', { o: [60, 0, 0], n: [1, 0, 0] }));
    expect(r.bodies).toHaveLength(1);
    const v = 2 * (60 * 40 * 8 - Math.PI * 9 * 8);
    expect(r.bodies[0].volume).toBeCloseTo(v, 5);
    expect(r.bodies[0].box[1].map(r6)).toEqual([120, 40, 8]);
    expect(r.bodies[0].faces.filter((f) => f.planar)).toHaveLength(6); // top, bottom and four sides: the seam is gone
    expect(r.bodies[0].faces.filter((f) => !f.planar)).toHaveLength(2); // both holes
  });
  it('clear errors', () => {
    const note = (st: BuildStep): string => buildModel([block(0, 0, 10, 10, 5), st]).steps[1].note || '';
    expect(note(mirror('New body', null))).toBe('its mirror plane is gone');
    expect(note(mirror('New body', { o: [0, 0, 0], n: [1, 0, 0] }, ['b2'], []))).toBe('click a body to mirror');
    expect(note(mirror('New body', { o: [0, 0, 0], n: [1, 0, 0] }, ['b2'], ['zz']))).toBe('its bodies are gone');
    expect(note(mirror('New body', { o: [0, 0, 0], n: [1, 0, 0] }, []))).toBe('its new bodies are not set up yet');
  });
});
