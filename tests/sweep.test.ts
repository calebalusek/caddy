// Acceptance tests for Sweep against exact formulas (docs/ACCEPTANCE-TESTS.md).
import { beforeAll, describe, expect, it } from 'vitest';
import { indexedMesh, QUALITY } from '../src/files/meshfiles';
import { buildModel, exportMeshes } from '../src/kernel/model';
import type { BuildStep, PathSeg, PathSpec, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN } from '../src/model/frames';
import { roundPath, segLength, sweepPath, turnAt } from '../src/model/path';
import type { Feature, Frame, SketchFeature } from '../src/model/types';
import { addLine, addPt, newSketchData, type P2, type SketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

function poly(sk: SketchData, pts: P2[]): void {
  const p = pts.map(([x, y]) => addPt(sk, x, y));
  p.forEach((_, i) => addLine(sk, p[i], p[(i + 1) % p.length]));
}
const circle = (sk: SketchData, x: number, y: number, r: number): void => { sk.curves.push({ id: 'c' + ++sk.nid, type: 'circle', c: addPt(sk, x, y), r }); };
/** The largest region of a little sketch, on a plane. */
function profile(frame: Frame, draw: (sk: SketchData) => void): ProfileSpec {
  const sk = newSketchData();
  draw(sk);
  const pr = sketchProfiles(sk).sort((a, b) => b.area - a.area)[0];
  return profileSpec(frame, pr);
}
const square = (half = 5): ProfileSpec => profile(ORIGIN.XY, (sk) => poly(sk, [[-half, -half], [half, -half], [half, half], [-half, half]]));
const disc = (r = 5): ProfileSpec => profile(ORIGIN.XY, (sk) => circle(sk, 0, 0, r));
const ring = (): ProfileSpec => { const sk = newSketchData(); circle(sk, 0, 0, 5); circle(sk, 0, 0, 3); return profileSpec(ORIGIN.XY, sketchProfiles(sk).find((p) => p.holes.length === 1)!); };

// paths are drawn on the Front plane (x across, z up), starting at the origin and going up
const line = (a: P2, b: P2, cid = 'l'): PathSeg => ({ cid: cid + a.join('_') + b.join('_'), type: 'line', a, b });
const arc = (a: P2, b: P2, c: P2, ccw: boolean): PathSeg => ({ cid: 'a' + a.join('_'), type: 'arc', a, b, c, r: Math.hypot(a[0] - c[0], a[1] - c[1]), ccw });
const pathOf = (segs: PathSeg[], closed = false, frame: Frame = ORIGIN.XZ): PathSpec => ({ frame, segs, closed });
const L = (up = 50, across = 50): PathSpec => pathOf([line([0, 0], [0, up]), line([0, up], [across, up])]);
type Sweep = Extract<BuildStep, { kind: 'sweep' }>;
const sweep = (prof: ProfileSpec, path: PathSpec, extra: Partial<Sweep> = {}): BuildStep =>
  ({ kind: 'sweep', id: 'w1', profile: prof, face: null, path, orientation: 'Perpendicular', corners: 'Round', operation: 'New body', bodyId: 'b1', ...extra });
const build = (...steps: BuildStep[]): ReturnType<typeof buildModel> => { const r = buildModel(steps); r.steps.forEach((s) => expect(s.note || '').toBe('')); return r; };

/** Every mesh edge shared by exactly two triangles, once each way; and the mesh volume. */
function meshCheck(steps: BuildStep[]): { open: number; volume: number; exact: number } {
  const m = exportMeshes(steps, QUALITY.Fine, null)[0], im = indexedMesh({ name: 'b', positions: m.positions, indices: m.indices });
  const seen = new Map<string, number>();
  im.tris.forEach((t) => { for (let i = 0; i < 3; i++) { const k = t[i] + '>' + t[(i + 1) % 3]; seen.set(k, (seen.get(k) || 0) + 1); } });
  let open = 0, v = 0;
  seen.forEach((n, k) => { const [a, b] = k.split('>'); if (n !== 1 || seen.get(b + '>' + a) !== 1) open++; });
  im.tris.forEach((t) => { const [a, b, c] = t.map((i) => im.verts[i]); v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); });
  return { open, volume: v / 6, exact: m.volume };
}

describe('sweep: exact volumes', () => {
  it('Ø10 circle along a straight 50 mm line: π·25·50 = 3927.0, a true cylinder', () => {
    const b = build(sweep(disc(), pathOf([line([0, 0], [0, 50])]))).bodies[0];
    expect(b.volume).toBeCloseTo(Math.PI * 25 * 50, 6);
    expect(Math.PI * 1250).toBeCloseTo(3927.0, 1);
    expect(b.faces).toHaveLength(3);
    expect(b.faces.map((f) => f.surf).sort()).toEqual(['w1:cap0', 'w1:cap1', 'w1:w0']);
  });

  it('10 × 10 square along an L (50 up + 50 across), Mitered: exactly 10 000', () => {
    const b = build(sweep(square(), L(), { corners: 'Mitered' })).bodies[0];
    expect(b.volume).toBeCloseTo(10000, 6);
    expect(b.box[0].map((v) => +v.toFixed(6))).toEqual([-5, -5, 0]);
    expect(b.box[1].map((v) => +v.toFixed(6))).toEqual([50, 5, 55]);
    expect(b.faces.every((f) => f.planar)).toBe(true);
  });

  it('quarter pipe bend R30, Ø10: π·25·(π/2·30) ≈ 3701, a true torus section', () => {
    const b = build(sweep(disc(), pathOf([arc([0, 0], [30, 30], [30, 0], false)]))).bodies[0];
    expect(b.volume).toBeCloseTo(Math.PI * 25 * (Math.PI / 2) * 30, 5);
    expect(b.volume).toBeCloseTo(3701.1, 1);
    expect(b.faces).toHaveLength(3);
  });

  it('closed circle path (torus R30 r5): 2π²·30·25 ≈ 14 804, wherever around the circle the profile was drawn', () => {
    const ringPath = pathOf([{ cid: 'c1', type: 'arc', a: [30, 0], b: [30, 0], c: [0, 0], r: 30, ccw: true, full: true }], true, ORIGIN.XY);
    for (const prof of [profile(ORIGIN.XZ, (sk) => circle(sk, 30, 0, 5)), profile(ORIGIN.YZ, (sk) => circle(sk, -30, 0, 5))]) {
      const b = build(sweep(prof, ringPath)).bodies[0];
      expect(b.volume).toBeCloseTo(2 * Math.PI * Math.PI * 30 * 25, 4);
      expect(b.volume).toBeCloseTo(14804.4, 1);
      expect(b.faces).toHaveLength(1);
    }
  });

  it('hollow pipe Ø10/Ø6 around a sharp L corner, Mitered: ring area × centerline, bore open', () => {
    const r = build(sweep(ring(), L(), { corners: 'Mitered' }));
    expect(r.bodies[0].volume).toBeCloseTo(Math.PI * (25 - 9) * 100, 5);
    // the bore is one open tunnel: its two cylinders meet in the mitre, and both ends are rings
    expect(r.bodies[0].faces.filter((f) => !f.planar)).toHaveLength(4);
    expect(r.bodies[0].faces.filter((f) => f.planar).map((f) => +f.area.toFixed(4))).toEqual([+(Math.PI * 16).toFixed(4), +(Math.PI * 16).toFixed(4)]);
  });

  it('closed square loop 40 × 40 with a 4 × 4 bar, Mitered: area × perimeter = 2560, from a profile drawn mid-side', () => {
    const loop = pathOf([line([0, 0], [40, 0]), line([40, 0], [40, 40]), line([40, 40], [0, 40]), line([0, 40], [0, 0])], true, ORIGIN.XY);
    const prof = profile(ORIGIN.YZ, (sk) => poly(sk, [[-2, -2], [2, -2], [2, 2], [-2, 2]])); // on the YZ plane, moved to x = 20 below
    prof.frame = { ...prof.frame, o: [20, 0, 0] };
    const b = build(sweep(prof, loop, { corners: 'Mitered' })).bodies[0];
    expect(b.volume).toBeCloseTo(16 * 160, 5);
    expect(b.faces).toHaveLength(10); // top and bottom rings, four outer and four inner walls
  });

  it('Parallel: the profile keeps its direction, so the volume is area × height gained', () => {
    expect(buildModel([sweep(square(), L(50, 50), { orientation: 'Parallel' })]).steps[0].note).toMatch(/runs flat along the profile/);
    const slanted = build(sweep(square(), pathOf([line([0, 0], [20, 30]), line([20, 30], [0, 60])]), { orientation: 'Parallel' })).bodies[0];
    expect(slanted.volume).toBeCloseTo(100 * 60, 5);
    const curved = build(sweep(square(), pathOf([arc([0, 0], [30 - 30 * Math.cos(Math.PI / 3), 30 * Math.sin(Math.PI / 3)], [30, 0], false)]), { orientation: 'Parallel' })).bodies[0];
    expect(curved.volume).toBeCloseTo(100 * 30 * Math.sin(Math.PI / 3), 3);
  });
});

describe('sweep: corners', () => {
  const RHO = (10.5 * (1 + Math.SQRT1_2)) / 2; // the bend radius for a 10 mm bar turning 90°

  it('Round: the L corner becomes a true arc; inside and outside are both rounded, exact volume', () => {
    const b = build(sweep(square(), L())).bodies[0];
    expect(RHO).toBeCloseTo(8.9623, 4);
    expect(b.volume).toBeCloseTo(100 * (2 * (50 - RHO) + (Math.PI / 2) * RHO), 5);
    // inside radius RHO − 5 and outside radius RHO + 5 around (RHO, ·, 50 − RHO)
    const radii = [...new Set(b.edges.filter((e) => e.kind === 'round').map((e) => +e.R!.toFixed(4)))].sort((x, y) => x - y);
    expect(radii).toEqual([+(RHO - 5).toFixed(4), +(RHO + 5).toFixed(4)]);
    const c = b.edges.find((e) => e.kind === 'round')!.center!;
    expect([c[0], c[2]].map((v) => +v.toFixed(4))).toEqual([+RHO.toFixed(4), +(50 - RHO).toFixed(4)]);
    // the acceptance points: material at (5.4, 44.6), none at (6.5, 43.5)
    const dist = (x: number, z: number): number => Math.hypot(x - RHO, z - (50 - RHO));
    expect(dist(5.4, 44.6)).toBeGreaterThan(RHO - 5);
    expect(dist(5.4, 44.6)).toBeLessThan(RHO + 5);
    expect(dist(6.5, 43.5)).toBeLessThan(RHO - 5);
  });

  it('section boundaries: straight / bend / straight are separate faces on every side, and stay so after later features', () => {
    const steps: BuildStep[] = [sweep(square(), L())];
    const sides = (r: ReturnType<typeof buildModel>): number => r.bodies[0].faces.filter((f) => f.planar && Math.abs(Math.abs(f.n[1]) - 1) < 1e-6).length;
    const first = build(...steps);
    expect(first.bodies[0].faces).toHaveLength(2 + 3 * 4);
    expect(sides(first)).toBe(6); // front and back: three flat faces each, in the same plane
    // drill through the bar and join a block on its end: the section lines are still there
    const prof = profile(ORIGIN.XY, (sk) => poly(sk, [[-5, -5], [5, -5], [5, 5], [-5, 5]]));
    const more: BuildStep[] = [...steps,
      { kind: 'hole', id: 'h1', at: [{ c: [0, -5, 20], dir: [0, 1, 0] }], d: 4, through: true, depth: 0, type: 'Simple', cbD: 0, cbDepth: 0, csD: 0 },
      { kind: 'extrude', id: 'e2', profile: prof, face: null, ...extrudeRange(-10, 'One side', 0), operation: 'Join', bodyId: 'b1' }];
    const later = build(...more);
    expect(sides(later)).toBe(6);
    expect(later.bodies[0].volume).toBeCloseTo(first.bodies[0].volume - Math.PI * 4 * 10 + 1000, 4);
  });

  it('Round with no room for a bend: the profile pivots around the corner (outside rounded), exact volume', () => {
    const b = build(sweep(square(), L(50, 3))).bodies[0];
    expect(b.volume).toBeCloseTo(5000 + 3 * 5 * 10 + (Math.PI * 25 / 4) * 10, 5);
  });

  it('a gentle kink (under 10°) is mitred in both styles', () => {
    const kink = pathOf([line([0, 0], [0, 30]), line([0, 30], [3, 60])]);
    const a = build(sweep(square(), kink)).bodies[0], b = build(sweep(square(), kink, { corners: 'Mitered' })).bodies[0];
    expect(a.volume).toBeCloseTo(100 * (30 + Math.hypot(3, 30)), 5);
    expect(b.volume).toBeCloseTo(a.volume, 6);
  });

  it('triangle profile, path up 40 / arc R30 / sharp corner / straight, at four path positions: closed solid in both corner styles', () => {
    const tri = profile(ORIGIN.XY, (sk) => poly(sk, [[0, 0], [20, 0], [8, 14]]));
    for (const x of [-10, 0, 10, 25]) for (const corners of ['Round', 'Mitered'] as const) {
      const path = pathOf([line([x, 0], [x, 40]), arc([x, 40], [x + 30, 70], [x + 30, 40], false), line([x + 30, 70], [x + 60, 40])]);
      const steps = [sweep(tri, path, { corners })];
      const r = buildModel(steps);
      expect(r.steps[0].note || '', `x=${x} ${corners}`).toBe('');
      expect(r.bodies).toHaveLength(1);
      const m = meshCheck(steps);
      expect(m.open, `x=${x} ${corners}`).toBe(0);
      expect(Math.abs(m.volume - m.exact) / m.exact).toBeLessThan(0.002); // no folds: the mesh encloses the same volume
      // in the region of area × path length (the profile sits off the path, so the bend adds or removes some)
      const len = 40 + (Math.PI / 2) * 30 + Math.hypot(30, 30);
      expect(m.exact).toBeGreaterThan(140 * len * 0.5);
      expect(m.exact).toBeLessThan(140 * len * 1.5);
    }
  });

  it('a tight bend (the profile reaches past the arc center) still makes one closed solid', () => {
    const wide = profile(ORIGIN.XY, (sk) => poly(sk, [[-5, -3], [18, -3], [18, 3], [-5, 3]]));
    const steps = [sweep(wide, pathOf([line([0, 0], [0, 20]), arc([0, 20], [12, 32], [12, 20], false), line([12, 32], [40, 32])]))];
    const r = buildModel(steps);
    expect(r.steps[0].note || '').toBe('');
    expect(r.bodies).toHaveLength(1);
    const m = meshCheck(steps);
    expect(m.open).toBe(0);
    expect(Math.abs(m.volume - m.exact) / m.exact).toBeLessThan(0.002);
  });

  it('clear errors', () => {
    const note = (st: BuildStep): string => buildModel([st]).steps[0].note || '';
    expect(note(sweep(square(), pathOf([line([0, 0], [0, 50])]), { path: null, pathNote: 'its path sketch is gone' }))).toBe('its path sketch is gone');
    expect(note(sweep(square(), pathOf([line([0, 0], [0, 50])]), { profile: null }))).toBe('its profile is gone');
    expect(note(sweep(square(), pathOf([line([0, 0], [50, 0])], false, ORIGIN.XY)))).toMatch(/lies flat along the path/);
    expect(note(sweep(square(), pathOf([line([0, 0], [0, 50]), line([0, 50], [1, 0])])))).toMatch(/doubles back/);
    expect(note(sweep(square(), L(), { operation: 'Cut', bodyId: null }))).toBe('nothing to cut');
  });

  it('sweep cut and join work on an existing body', () => {
    const block: BuildStep = { kind: 'extrude', id: 'e1', profile: profile(ORIGIN.XY, (sk) => poly(sk, [[-20, -20], [20, -20], [20, 20], [-20, 20]])), face: null, ...extrudeRange(30, 'One side', 0), operation: 'New body', bodyId: 'b1' };
    const cut = build(block, sweep(disc(3), pathOf([line([0, 0], [0, 30])]), { operation: 'Cut', bodyId: null })).bodies[0];
    expect(cut.volume).toBeCloseTo(40 * 40 * 30 - Math.PI * 9 * 30, 5);
    const join = build(block, sweep(disc(3), pathOf([line([0, 30], [0, 50])]), { operation: 'Join', bodyId: 'b1', profile: { ...disc(3), frame: { ...ORIGIN.XY, o: [0, 0, 30] } } })).bodies[0];
    expect(join.volume).toBeCloseTo(40 * 40 * 30 + Math.PI * 9 * 20, 5);
  });
});

describe('sweep paths from sketches', () => {
  const sketch = (draw: (sk: SketchData) => void): SketchFeature => {
    const sk = newSketchData();
    draw(sk);
    return { id: 's1', type: 'sketch', name: 'Sketch1', params: { ref: { kind: 'origin', id: 'XZ' } }, frame: ORIGIN.XZ, ...sk } as SketchFeature;
  };
  const feats = (s: SketchFeature): Feature[] => [s];

  it('orders a chain of lines and arcs from its free end, whatever order they were picked in', () => {
    const s = sketch((sk) => {
      const p = [addPt(sk, 0, 0), addPt(sk, 0, 40), addPt(sk, 30, 70), addPt(sk, 60, 70)];
      addLine(sk, p[3], p[2]); // drawn backwards
      sk.curves.push({ id: 'a1', type: 'arc', c: addPt(sk, 30, 40), p1: p[2], p2: p[1], r: 30 });
      addLine(sk, p[0], p[1]);
    });
    const ids = s.curves.map((c) => c.id);
    const r = sweepPath(feats(s), { sketchId: 's1', curveIds: [ids[1], ids[0], ids[2]] });
    expect(r.err).toBeUndefined();
    const segs = r.path!.segs;
    expect(r.path!.closed).toBe(false);
    expect(segs.map((g) => g.type)).toEqual(['line', 'arc', 'line']);
    // each piece starts where the last one ended, and the joints are smooth
    for (let i = 1; i < segs.length; i++) { expect(segs[i].a).toEqual(segs[i - 1].b); expect(Math.abs(turnAt(segs[i - 1], segs[i]))).toBeLessThan(1e-9); }
    expect(segs.reduce((t, g) => t + segLength(g), 0)).toBeCloseTo(40 + (Math.PI / 2) * 30 + 30, 9);
  });

  it('a closed chain is closed; a circle is a path on its own; broken references say what is wrong', () => {
    const s = sketch((sk) => { poly(sk, [[0, 0], [40, 0], [40, 40], [0, 40]]); circle(sk, 100, 0, 30); addLine(sk, addPt(sk, 200, 0), addPt(sk, 200, 50)); });
    const ids = s.curves.map((c) => c.id);
    expect(sweepPath(feats(s), { sketchId: 's1', curveIds: ids.slice(0, 4) }).path!.closed).toBe(true);
    const c = sweepPath(feats(s), { sketchId: 's1', curveIds: [ids[4]] }).path!;
    expect(c.closed).toBe(true);
    expect(c.segs).toHaveLength(1);
    expect(sweepPath(feats(s), { sketchId: 's1', curveIds: [ids[0], ids[5]] }).err).toBe('the path has to be one connected chain');
    expect(sweepPath(feats(s), { sketchId: 's1', curveIds: [ids[0], 'zz'] }).err).toBe('part of its path is gone');
    expect(sweepPath(feats(s), { sketchId: 'nope', curveIds: [ids[0]] }).err).toBe('its path sketch is gone');
    expect(sweepPath(feats(s), null).err).toMatch(/pick a path/);
  });

  it('roundPath: a corner between a line and an arc gets a tangent bend; a corner with no room stays sharp', () => {
    const p = pathOf([line([0, 0], [0, 40]), arc([0, 40], [30, 70], [30, 40], false), line([30, 70], [60, 40])]);
    const r = roundPath(p, () => 5);
    expect(r.segs).toHaveLength(4);
    const bend = r.segs[2];
    expect(bend.type).toBe('arc');
    for (let i = 1; i < r.segs.length; i++) {
      expect(Math.hypot(r.segs[i].a[0] - r.segs[i - 1].b[0], r.segs[i].a[1] - r.segs[i - 1].b[1])).toBeLessThan(1e-9);
      expect(Math.abs(turnAt(r.segs[i - 1], r.segs[i]))).toBeLessThan(1e-7);
    }
    expect(roundPath(L(50, 3), () => 5).segs).toHaveLength(2);
  });
});
