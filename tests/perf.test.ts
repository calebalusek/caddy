// How fast a tool's live preview is on a part with many holes (the case that was slow).
import { beforeAll, describe, expect, it } from 'vitest';
import { buildDraft, buildModel } from '../src/kernel/model';
import type { BuildStep, EdgeRef } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import { addLine, addPt, newSketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const sk = newSketchData();
const p = [addPt(sk, 0, 0), addPt(sk, 120, 0), addPt(sk, 120, 60), addPt(sk, 0, 60)];
p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % 4]));
const plate: BuildStep = { kind: 'extrude', id: 'e1', profile: profileSpec(ORIGIN.XY, sketchProfiles(sk)[0]), face: null, ...extrudeRange(10, 'One side', 0), operation: 'New body', bodyId: 'b1' };
const holes: BuildStep = { kind: 'hole', id: 'h1', at: Array.from({ length: 24 }, (_, i) => ({ face: { bodyId: 'b1', n: [0, 0, 1] as [number, number, number], w: 10, p: [10 + (i % 6) * 20, 15 + Math.floor(i / 6) * 10, 10] as [number, number, number] } })), d: 5, through: true, depth: 0, type: 'Simple', cbD: 0, cbDepth: 0, csD: 0 };
const edge: EdgeRef = { kind: 'line', bodyId: 'b1', a: [120, 0, 10], b: [120, 60, 10], n1: [0, 0, 1], n2: [1, 0, 0] };
const fillet = (r: number): BuildStep => ({ kind: 'fillet', id: 'f1', mode: 'fillet', r, edges: [edge] });

describe('live preview speed (24 holes + fillet)', () => {
  it('after the first call, each radius change only runs the fillet', () => {
    const steps = [plate, holes];
    const t0 = performance.now();
    const first = buildDraft(steps, fillet(1), null);
    const tFirst = performance.now() - t0;
    expect(first.base).not.toBeNull();
    const times: number[] = [];
    let key = first.baseKey;
    for (let r = 1.5; r <= 4; r += 0.5) {
      const t = performance.now();
      const out = buildDraft(steps, fillet(r), key);
      times.push(performance.now() - t);
      expect(out.base).toBeNull(); // the model is not rebuilt or resent
      expect(out.draft.step.error).toBeFalsy();
      key = out.baseKey;
      const exact = (4 - Math.PI) * r * r / 4 * 60; // the sliver a fillet of radius r takes off a 60 mm edge
      expect(out.removed.reduce((s, m) => s + m.volume, 0)).toBeCloseTo(exact, 3);
    }
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    console.log(`first preview ${tFirst.toFixed(0)} ms; later previews ${mean.toFixed(0)} ms each`);
    expect(buildModel([plate, holes, fillet(2)]).bodies[0].volume).toBeGreaterThan(0);
    expect(mean).toBeLessThan(tFirst);
  });
  it('the model is rebuilt when the timeline changes', () => {
    const a = buildDraft([plate], fillet(1), null);
    const b = buildDraft([plate, holes], fillet(1), a.baseKey);
    expect(b.base).not.toBeNull();
    expect(b.base!.bodies[0].volume).toBeCloseTo(120 * 60 * 10 - 24 * Math.PI * 6.25 * 10, 4);
  });
});
