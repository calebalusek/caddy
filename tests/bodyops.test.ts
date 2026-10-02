// Acceptance tests for Combine, Move/Rotate/Scale, Lay flat, Split (with keys) and Offset body, against exact numbers.
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
const block = (id: string, bodyId: string, x: number, y: number, w: number, d: number, h: number): BuildStep => ({ kind: 'extrude', id, profile: rectP(x, y, w, d), face: null, ...extrudeRange(h, 'One side', 0), operation: 'New body', bodyId });
const combine = (operation: 'Join' | 'Cut' | 'Intersect', keepTools = false, tools = ['b2'], target: string | null = 'b1'): BuildStep => ({ kind: 'combine', id: 'c1', target, tools, operation, keepTools });
const xform = (o: Partial<Extract<BuildStep, { kind: 'transform' }>> = {}): BuildStep => ({ kind: 'transform', id: 't1', bodies: ['b1'], mode: 'free', move: [0, 0, 0], rotAxis: [0, 0, 1], rotDeg: 0, scale: 1, pivot: 'body', copy: false, lay: null, bodyIds: [], ...o });
const split = (o: Partial<Extract<BuildStep, { kind: 'split' }>> = {}): BuildStep => ({ kind: 'split', id: 's1', body: 'b1', plane: { o: [0, 0, 10], n: [0, 0, 1] }, keys: 'None', keySize: 0, keyCount: 1, keyDepth: 0, clearance: 0, bodyIds: ['b2'], ...o });
const offs = (o: Partial<Extract<BuildStep, { kind: 'offsetbody' }>> = {}): BuildStep => ({ kind: 'offsetbody', id: 'o1', bodies: ['b1'], distance: 1, sharp: true, copy: false, bodyIds: [], ...o });
const run = (...s: BuildStep[]): ReturnType<typeof buildModel> => { const r = buildModel(s); r.steps.forEach((x) => expect(x.note || '', x.id).toBe('')); return r; };
const vol = (r: ReturnType<typeof buildModel>, id: string): number => r.bodies.find((b) => b.id === id)!.volume;
const r6 = (v: number): number => +v.toFixed(6);

describe('combine', () => {
  const two = [block('e1', 'b1', 0, 0, 20, 20, 20), block('e2', 'b2', 10, 0, 20, 20, 20)];
  it('Join, Cut and Intersect give the exact volumes', () => {
    const j = run(...two, combine('Join'));
    expect(j.bodies.map((b) => b.id)).toEqual(['b1']);
    expect(j.consumed).toEqual(['b2']);
    expect(vol(j, 'b1')).toBeCloseTo(30 * 20 * 20, 6);
    expect(vol(run(...two, combine('Cut')), 'b1')).toBeCloseTo(10 * 20 * 20, 6);
    expect(vol(run(...two, combine('Intersect')), 'b1')).toBeCloseTo(10 * 20 * 20, 6);
  });
  it('keep tools leaves the second body', () => {
    const r = run(...two, combine('Cut', true));
    expect(r.bodies.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(r.consumed).toEqual([]);
    expect(vol(r, 'b2')).toBeCloseTo(8000, 6);
  });
  it('clear errors', () => {
    const note = (st: BuildStep, base = two): string => buildModel([...base, st]).steps[2].note || '';
    expect(note(combine('Join', false, ['b2'], null))).toBe('click the body to keep');
    expect(note(combine('Join', false, []))).toBe('click the bodies to join to it');
    expect(note(combine('Join', false, ['zz']))).toBe('1 of its bodies are gone');
    expect(note(combine('Intersect'), [block('e1', 'b1', 0, 0, 10, 10, 10), block('e2', 'b2', 50, 0, 10, 10, 10)])).toBe('the bodies do not overlap');
  });
});

describe('move, rotate, scale', () => {
  it('moves exactly', () => {
    const r = run(block('e1', 'b1', 0, 0, 10, 10, 10), xform({ move: [5, -3, 2] }));
    expect(r.bodies[0].box[0].map(r6)).toEqual([5, -3, 2]);
    expect(r.bodies[0].volume).toBeCloseTo(1000, 6);
  });
  it('scales about the body middle: 200 % is 8 times the volume, same centre', () => {
    const r = run(block('e1', 'b1', 0, 0, 10, 10, 10), xform({ scale: 2 }));
    expect(r.bodies[0].volume).toBeCloseTo(8000, 5);
    expect(r.bodies[0].box[0].map(r6)).toEqual([-5, -5, -5]);
    expect(r.bodies[0].box[1].map(r6)).toEqual([15, 15, 15]);
  });
  it('rotates 90 degrees about Z through the middle', () => {
    const r = run(block('e1', 'b1', 0, 0, 20, 10, 5), xform({ rotDeg: 90 }));
    expect(r.bodies[0].box[0].map(r6)).toEqual([5, -5, 0]);
    expect(r.bodies[0].box[1].map(r6)).toEqual([15, 15, 5]);
  });
  it('Copy keeps the original and makes a moved copy', () => {
    const r = run(block('e1', 'b1', 0, 0, 10, 10, 10), xform({ move: [30, 0, 0], copy: true, bodyIds: ['b2'] }));
    expect(r.bodies.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
    expect(r.bodies.find((b) => b.id === 'b2')!.box[0][0]).toBeCloseTo(30, 6);
    expect(r.bodies.find((b) => b.id === 'b1')!.box[0][0]).toBeCloseTo(0, 6);
  });
  it('Lay a face down: the picked side ends on the build plate', () => {
    // a 40 x 20 x 10 block; lay its x = 40 end face down: it is then 40 tall, 10 x 20 on the plate
    const face = { bodyId: 'b1', n: [1, 0, 0] as [number, number, number], w: 40, p: [40, 10, 5] as [number, number, number] };
    const r = run(block('e1', 'b1', 0, 0, 40, 20, 10), xform({ mode: 'lay', lay: face }));
    const b = r.bodies[0];
    expect(b.box[0][2]).toBeCloseTo(0, 6);
    expect(b.box[1][2]).toBeCloseTo(40, 6);
    expect(b.volume).toBeCloseTo(8000, 5);
  });
  it('Lay a face down also works for a face that already points down or up', () => {
    const top = { bodyId: 'b1', n: [0, 0, 1] as [number, number, number], w: 10, p: [20, 10, 10] as [number, number, number] };
    const r = run(block('e1', 'b1', 0, 0, 40, 20, 10), xform({ mode: 'lay', lay: top }));
    expect(r.bodies[0].box[0][2]).toBeCloseTo(0, 6);
    expect(r.bodies[0].box[1][2]).toBeCloseTo(10, 6);
  });
});

describe('split', () => {
  const b = block('e1', 'b1', 0, 0, 40, 30, 20);
  it('halves, exact', () => {
    const r = run(b, split());
    expect(vol(r, 'b1')).toBeCloseTo(40 * 30 * 10, 6); // the side the normal points to
    expect(vol(r, 'b2')).toBeCloseTo(40 * 30 * 10, 6);
    expect(r.bodies.find((x) => x.id === 'b1')!.box[0][2]).toBeCloseTo(10, 6);
    expect(r.bodies.find((x) => x.id === 'b2')!.box[1][2]).toBeCloseTo(10, 6);
  });
  it('a pin goes into the other half with clearance', () => {
    const r = run(b, split({ keys: 'Pins', keySize: 6, keyCount: 1, keyDepth: 8, clearance: 0.2 }));
    expect(vol(r, 'b1')).toBeCloseTo(12000 + Math.PI * 9 * 8, 3);
    expect(vol(r, 'b2')).toBeCloseTo(12000 - Math.PI * 3.2 * 3.2 * 8.2, 3);
  });
  it('errors', () => {
    const note = (st: BuildStep): string => buildModel([b, st]).steps[1].note || '';
    expect(note(split({ plane: { o: [0, 0, 50], n: [0, 0, 1] } }))).toBe('the plane does not cut through the body');
    expect(note(split({ keys: 'Pins', keySize: 0, keyDepth: 5 }))).toBe('give the keys a size');
    expect(note(split({ keys: 'Pins', keySize: 60, keyDepth: 5 }))).toMatch(/no room/);
  });
});

describe('offset body', () => {
  const b = block('e1', 'b1', 0, 0, 20, 20, 20);
  it('grows and shrinks with sharp corners', () => {
    expect(vol(run(b, offs({ distance: 1 })), 'b1')).toBeCloseTo(22 ** 3, 3);
    expect(vol(run(b, offs({ distance: -1 })), 'b1')).toBeCloseTo(18 ** 3, 3);
  });
  it('round corners when growing', () => {
    const a = 20, d = 1, exp = a ** 3 + 6 * a * a * d + 3 * Math.PI * a * d * d + (4 / 3) * Math.PI * d ** 3;
    expect(vol(run(b, offs({ distance: d, sharp: false })), 'b1')).toBeCloseTo(exp, 2);
  });
  it('as a new body leaves the original', () => {
    const r = run(b, offs({ distance: 0.5, copy: true, bodyIds: ['b2'] }));
    expect(vol(r, 'b1')).toBeCloseTo(8000, 6);
    expect(vol(r, 'b2')).toBeCloseTo(21 ** 3, 3);
  });
  it('shrinking too far says so', () => {
    const r = buildModel([b, offs({ distance: -15 })]);
    expect(r.steps[1].note || '').toMatch(/shrink/);
  });
});
