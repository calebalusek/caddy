// Text: letters from the bundled fonts, raised or engraved.
import { beforeAll, describe, expect, it } from 'vitest';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { frameFromFace, ORIGIN } from '../src/model/frames';
import { addLine, addPt, newSketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const rectP = (w: number, d: number): ProfileSpec => { const sk = newSketchData(); const p = [addPt(sk, 0, 0), addPt(sk, w, 0), addPt(sk, w, d), addPt(sk, 0, d)]; p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % 4])); return profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]); };
const plate: BuildStep = { kind: 'extrude', id: 'e1', profile: rectP(80, 40), face: null, ...extrudeRange(6, 'One side', 0), operation: 'New body', bodyId: 'b1' };
const top = frameFromFace([0, 0, 1], [40, 20, 6]);
const text = (extra: Partial<Extract<BuildStep, { kind: 'text' }>> = {}): BuildStep =>
  ({ kind: 'text', id: 't1', text: 'CADDY', font: 'Barlow Bold', size: 10, height: 1, frame: top, anchor: [40, 20], angle: 0, operation: 'Join', bodyId: 'b1', ...extra });
const run = (...s: BuildStep[]): ReturnType<typeof buildModel> => { const r = buildModel(s); r.steps.forEach((x) => expect(x.note || '', x.id).toBe('')); return r; };
const solo = (extra: Partial<Extract<BuildStep, { kind: 'text' }>> = {}) => run(text({ frame: ORIGIN.XY, anchor: [0, 0], operation: 'New body', ...extra })).bodies[0];

describe('text', () => {
  it('raised text on a plate: adds exactly the volume of the letters, standing 1 mm proud, centered where asked', () => {
    const letters = solo().volume;
    expect(letters).toBeGreaterThan(20);
    const r = run(plate, text());
    expect(r.bodies[0].volume).toBeCloseTo(80 * 40 * 6 + letters, 3);
    expect(r.bodies[0].box[1][2]).toBeCloseTo(7, 6); // 1 mm above the top
    const t = solo();
    // centered on the anchor (0,0)
    expect((t.box[0][0] + t.box[1][0]) / 2).toBeCloseTo(0, 3);
    expect((t.box[0][1] + t.box[1][1]) / 2).toBeCloseTo(0, 3);
  });
  it('engraved text removes the same volume, cutting 1 mm into the surface', () => {
    const letters = solo().volume;
    const r = run(plate, text({ operation: 'Cut' }));
    expect(r.bodies[0].volume).toBeCloseTo(80 * 40 * 6 - letters, 3);
    expect(r.bodies[0].box[1][2]).toBeCloseTo(6, 6);
  });
  it('the size sets the letter height, the height sets the thickness, volume scales with both', () => {
    const a = solo(), b = solo({ size: 20 }), c = solo({ height: 2 });
    expect(b.volume / a.volume).toBeCloseTo(4, 2); // double the size: four times the area
    expect(c.volume / a.volume).toBeCloseTo(2, 6);
    expect(b.box[1][0] - b.box[0][0]).toBeCloseTo(2 * (a.box[1][0] - a.box[0][0]), 2);
  });
  it('turning it 90° about the anchor swaps its width and height', () => {
    const a = solo(), r = solo({ angle: 90 });
    expect(r.box[1][1] - r.box[0][1]).toBeCloseTo(a.box[1][0] - a.box[0][0], 3);
    expect(r.volume).toBeCloseTo(a.volume, 6);
    expect((r.box[0][0] + r.box[1][0]) / 2).toBeCloseTo(0, 3);
  });
  it('lies on any plane: on the Front plane the text stands up in Z', () => {
    const r = solo({ frame: ORIGIN.XZ });
    expect(r.box[1][2] - r.box[0][2]).toBeGreaterThan(5); // letters are tall in Z
    expect(r.box[1][1] - r.box[0][1]).toBeCloseTo(1, 6); // 1 mm thick along the plane's normal (−Y)
  });
  it('both fonts work and look different; clear errors', () => {
    expect(solo({ font: 'Barlow' }).volume).not.toBeCloseTo(solo().volume, 1);
    const note = (extra: Partial<Extract<BuildStep, { kind: 'text' }>>): string => buildModel([plate, text(extra)]).steps[1].note || '';
    expect(note({ text: '  ' })).toBe('type the text');
    expect(note({ size: 0 })).toMatch(/size needs/);
    expect(note({ height: 0 })).toMatch(/height needs/);
    expect(note({ font: 'Comic Sans' })).toBe('that font is not available');
    expect(note({ frame: null })).toBe('its plane is gone');
  });
});
