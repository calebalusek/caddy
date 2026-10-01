// Acceptance tests for solids: every number is compared with the exact formula.
import { beforeAll, describe, expect, it } from 'vitest';
import { edgeToRef } from '../src/kernel/match';
import { buildModel } from '../src/kernel/model';
import type { BuildStep, EdgeInfo, EdgeRef, ProfileSpec } from '../src/kernel/protocol';
import { extrudeRange, profileSpec } from '../src/kernel/spec';
import { ORIGIN, offsetFrame } from '../src/model/frames';
import type { Frame, Vec3 } from '../src/model/types';
import { addLine, addPt, newId, newSketchData, type SketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { loadKernel, meshVolume } from './helpers/kernel';

beforeAll(loadKernel);

function rect(sk: SketchData, x: number, y: number, w: number, h: number): void {
  const p = [addPt(sk, x, y), addPt(sk, x + w, y), addPt(sk, x + w, y + h), addPt(sk, x, y + h)];
  [0, 1, 2, 3].forEach((i) => addLine(sk, p[i], p[(i + 1) % 4]));
}
function circle(sk: SketchData, x: number, y: number, r: number): void { sk.curves.push({ id: newId(sk, 'c'), type: 'circle', c: addPt(sk, x, y), r }); }
/** The region of a sketch that contains (x, y), as the kernel wants it. */
function region(sk: SketchData, frame: Frame, pick?: (a: number) => boolean): ProfileSpec {
  const prs = sketchProfiles(sk);
  const pr = pick ? prs.find((p) => pick(p.area))! : prs.find((p) => p.outer)!;
  return profileSpec(frame, pr);
}
const rectProfile = (w: number, h: number, frame: Frame = ORIGIN.XY, x = 0, y = 0): ProfileSpec => { const sk = newSketchData(); rect(sk, x, y, w, h); return region(sk, frame); };
const extrude = (id: string, profile: ProfileSpec, distance: number, operation: 'Join' | 'Cut' | 'New body', bodyId: string | null, direction = 'One side', offset = 0): BuildStep =>
  ({ kind: 'extrude', id, profile, face: null, ...extrudeRange(distance, direction, offset), operation, bodyId });
const box = (w = 40, d = 30, h = 20): BuildStep => extrude('e1', rectProfile(w, d), h, 'New body', 'b1');

/** The straight edge whose middle is closest to a point. */
const edgeNear = (edges: EdgeInfo[], p: Vec3, kind: 'line' | 'round' = 'line'): EdgeInfo =>
  edges.filter((e) => e.kind === kind).sort((a, b) => Math.hypot(a.mid[0] - p[0], a.mid[1] - p[1], a.mid[2] - p[2]) - Math.hypot(b.mid[0] - p[0], b.mid[1] - p[1], b.mid[2] - p[2]))[0];
const fillet = (id: string, edges: EdgeRef[], r: number, mode: 'fillet' | 'chamfer' = 'fillet'): BuildStep => ({ kind: 'fillet', id, mode, r, edges });

describe('extrude and booleans', () => {
  it('box 40 × 30 × 20: exact volume, six tagged faces, twelve straight edges', () => {
    const r = buildModel([box()]);
    expect(r.steps[0].error).toBeFalsy();
    const b = r.bodies[0];
    expect(b.volume).toBeCloseTo(24000, 6);
    expect(meshVolume(b.mesh.positions, b.mesh.indices)).toBeCloseTo(24000, 2);
    expect(b.box).toEqual([[0, 0, 0], [40, 30, 20]]);
    expect(b.faces.map((f) => f.surf).sort()).toEqual(['e1:bot', 'e1:s0', 'e1:s1', 'e1:s2', 'e1:s3', 'e1:top']);
    const top = b.faces.find((f) => f.surf === 'e1:top')!;
    expect(top.n).toEqual([0, 0, 1]);
    expect(top.p[2]).toBeCloseTo(20, 9);
    expect(b.edges).toHaveLength(12);
    expect(b.edges.every((e) => e.kind === 'line' && e.faces.length === 2)).toBe(true);
  });

  it('negative, symmetric and offset extrudes land where they should', () => {
    const neg = buildModel([extrude('e1', rectProfile(10, 10), -5, 'New body', 'b1')]).bodies[0];
    expect(neg.box).toEqual([[0, 0, -5], [10, 10, 0]]);
    const sym = buildModel([extrude('e1', rectProfile(10, 10), 4, 'New body', 'b1', 'Symmetric')]).bodies[0];
    expect(sym.box).toEqual([[0, 0, -4], [10, 10, 4]]);
    expect(sym.volume).toBeCloseTo(800, 6);
    const off = buildModel([extrude('e1', rectProfile(10, 10), 3, 'New body', 'b1', 'One side', 7)]).bodies[0];
    expect(off.box).toEqual([[0, 0, 7], [10, 10, 10]]);
    const front = buildModel([extrude('e1', rectProfile(10, 20, ORIGIN.XZ), 6, 'New body', 'b1')]).bodies[0];
    expect(front.box).toEqual([[0, -6, 0], [10, 0, 20]]); // XZ plane looks toward −Y
  });

  it('box minus box (pocket) and union: volumes exact', () => {
    const top = offsetFrame(ORIGIN.XY, 20);
    const pocket = buildModel([box(), extrude('e2', rectProfile(20, 10, top, 10, 10), -8, 'Cut', null)]);
    expect(pocket.bodies).toHaveLength(1);
    expect(pocket.bodies[0].volume).toBeCloseTo(24000 - 20 * 10 * 8, 6);
    expect(pocket.bodies[0].faces.find((f) => f.surf === 'e2:top' || f.surf === 'e2:bot')).toBeTruthy(); // pocket floor remembers its feature
    const boss = buildModel([box(), extrude('e2', rectProfile(20, 10, top, 10, 10), 5, 'Join', 'b1')]);
    expect(boss.bodies[0].volume).toBeCloseTo(24000 + 1000, 6);
    // a box joined side by side shares coplanar faces: they merge into one face each
    const wide = buildModel([box(), extrude('e2', rectProfile(10, 30, ORIGIN.XY, 40, 0), 20, 'Join', 'b1')]);
    expect(wide.bodies[0].volume).toBeCloseTo(50 * 30 * 20, 6);
    expect(wide.bodies[0].faces).toHaveLength(6);
  });

  it('a new body stays separate; a cut with nothing to cut says so', () => {
    const two = buildModel([box(), extrude('e2', rectProfile(10, 10, ORIGIN.XY, 100, 0), 5, 'New body', 'b2')]);
    expect(two.bodies.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(two.bodies[1].volume).toBeCloseTo(500, 6);
    const miss = buildModel([box(), extrude('e2', rectProfile(10, 10, ORIGIN.XY, 100, 0), 5, 'Cut', null)]);
    expect(miss.steps[1]).toMatchObject({ error: true, note: 'nothing to cut' });
    expect(miss.bodies[0].volume).toBeCloseTo(24000, 6);
  });

  it('Ø6 through hole in an 8 mm plate removes π·9·8 = 226.19; blind Ø6 × 5 removes 141.37', () => {
    const sk = newSketchData();
    rect(sk, 0, 0, 60, 40); circle(sk, 20, 20, 3);
    const plate = buildModel([extrude('e1', region(sk, ORIGIN.XY), 8, 'New body', 'b1')]).bodies[0];
    expect(60 * 40 * 8 - plate.volume).toBeCloseTo(Math.PI * 9 * 8, 6);
    expect(plate.faces.filter((f) => !f.planar)).toHaveLength(1); // one true cylinder, not facets
    expect(plate.edges.filter((e) => e.kind === 'round' && e.closed)).toHaveLength(2);
    expect(plate.edges.find((e) => e.kind === 'round')).toMatchObject({ R: 3, center: [20, 20, expect.any(Number)] });

    const hole = newSketchData(); circle(hole, 20, 20, 3);
    const blind = buildModel([extrude('e1', rectProfile(60, 40), 8, 'New body', 'b1'), extrude('e2', region(hole, offsetFrame(ORIGIN.XY, 8)), -5, 'Cut', null)]).bodies[0];
    expect(60 * 40 * 8 - blind.volume).toBeCloseTo(Math.PI * 9 * 5, 6);
  });

  it('rounded and arc profiles extrude with exact volume', () => {
    const sk = newSketchData(), p1 = addPt(sk, 10, 0), p2 = addPt(sk, -10, 0);
    addLine(sk, p2, p1);
    sk.curves.push({ id: newId(sk, 'a'), type: 'arc', c: addPt(sk, 0, 0), p1, p2, r: 10 });
    const half = buildModel([extrude('e1', region(sk, ORIGIN.XY), 10, 'New body', 'b1')]).bodies[0];
    expect(half.volume).toBeCloseTo((Math.PI * 100 * 10) / 2, 6);
    // circle crossing a rectangle edge: extrude just the lens-shaped part inside the rectangle
    const sk2 = newSketchData(); rect(sk2, 0, 0, 40, 30); circle(sk2, 40, 15, 8);
    const prs = sketchProfiles(sk2).sort((a, b) => a.area - b.area);
    const inside = prs.find((p) => p.loop.pts.every((q) => q[0] <= 40 + 1e-9) && p.area < 200)!;
    const lens = buildModel([{ kind: 'extrude', id: 'e1', profile: profileSpec(ORIGIN.XY, inside), face: null, z0: 0, depth: 5, operation: 'New body', bodyId: 'b1' }]).bodies[0];
    expect(lens.volume).toBeCloseTo(((Math.PI * 64) / 2) * 5, 6);
  });

  it('press-pull a flat face: pulling out adds, pushing in cuts', () => {
    const base = buildModel([box()]).bodies[0], top = base.faces.find((f) => f.surf === 'e1:top')!;
    const face = { bodyId: 'b1', n: top.n, w: 20, p: top.p, surf: top.surf };
    const out = buildModel([box(), { kind: 'extrude', id: 'e2', profile: null, face, ...extrudeRange(5, 'One side', 0), operation: 'Join', bodyId: 'b1' }]);
    expect(out.bodies[0].volume).toBeCloseTo(40 * 30 * 25, 6);
    const inn = buildModel([box(), { kind: 'extrude', id: 'e2', profile: null, face, ...extrudeRange(-5, 'One side', 0), operation: 'Cut', bodyId: null }]);
    expect(inn.bodies[0].volume).toBeCloseTo(40 * 30 * 15, 6);
  });
});

describe('fillet and chamfer', () => {
  const base = (): EdgeInfo[] => buildModel([box()]).bodies[0].edges;
  const ref = (p: Vec3): EdgeRef => edgeToRef(edgeNear(base(), p), 'b1');

  it('fillet R5 on one 30 mm edge: exact volume, fillet face is its own tagged face', () => {
    const r = buildModel([box(), fillet('f1', [ref([40, 15, 20])], 5)]);
    expect(r.steps[1].error).toBeFalsy();
    const b = r.bodies[0];
    expect(24000 - b.volume).toBeCloseTo((25 - (25 * Math.PI) / 4) * 30, 6);
    const ff = b.faces.filter((f) => f.surf === 'F:f1:0');
    expect(ff).toHaveLength(1);
    expect(ff[0].planar).toBe(false);
    expect(b.faces.find((f) => f.surf === 'e1:top')).toBeTruthy(); // the neighbors keep their identity
  });

  it('chamfer 4 on one edge: exact volume, flat chamfer face', () => {
    const b = buildModel([box(), fillet('f1', [ref([40, 15, 20])], 4, 'chamfer')]).bodies[0];
    expect(24000 - b.volume).toBeCloseTo((16 / 2) * 30, 6);
    expect(b.faces.find((f) => f.surf === 'F:f1:0')!.planar).toBe(true);
  });

  it('three fillets meeting at a corner blend cleanly: exact volume (no notch)', () => {
    const r5 = 5, refs = [ref([40, 15, 20]), ref([20, 30, 20]), ref([40, 30, 10])];
    const b = buildModel([box(), fillet('f1', refs, r5)]).bodies[0];
    const removed = (1 - Math.PI / 4) * r5 * r5 * (30 + 40 + 20 - 3 * r5) + r5 ** 3 * (1 - Math.PI / 6);
    expect(24000 - b.volume).toBeCloseTo(removed, 5);
    // each fillet face knows which picked edge it belongs to; the ball corner goes to one of them
    expect(new Set(b.faces.filter((f) => f.surf.startsWith('F:f1:')).map((f) => f.surf))).toEqual(new Set(['F:f1:0', 'F:f1:1', 'F:f1:2']));
  });

  it('fillet on a round edge (cylinder rim): exact volume', () => {
    const sk = newSketchData(); circle(sk, 0, 0, 10);
    const cyl = extrude('e1', region(sk, ORIGIN.XY), 20, 'New body', 'b1');
    const plain = buildModel([cyl]).bodies[0];
    // a cylinder has two real edges (its rims); the seam down its side is not drawn or pickable
    expect(plain.edges).toHaveLength(2);
    expect(plain.mesh.edgeGroups).toHaveLength(2);
    expect(plain.mesh.edgeLines.every((_v, i) => i % 3 !== 2 || plain.mesh.edgeLines[i] === 0 || plain.mesh.edgeLines[i] === 20)).toBe(true);
    const edges = plain.edges, rim = edgeNear(edges.filter((e) => e.mid[2] > 19), [0, 0, 20], 'round');
    expect(rim).toMatchObject({ R: 10, closed: true });
    const R = 10, r = 3, b = buildModel([cyl, fillet('f1', [edgeToRef(rim, 'b1')], r)]).bodies[0];
    const removed = 2 * Math.PI * (r * r * (R - r / 2) - (((Math.PI * r * r) / 4) * (R - r) + r ** 3 / 3));
    expect(Math.PI * 100 * 20 - b.volume).toBeCloseTo(removed, 5);
  });

  it('edges are found again after the body changes upstream (wider box)', () => {
    const picked = ref([40, 15, 20]); // right top edge of the 40-wide box
    const wider = buildModel([box(55), fillet('f1', [picked], 5)]);
    expect(wider.steps[1].error).toBeFalsy();
    expect(55 * 30 * 20 - wider.bodies[0].volume).toBeCloseTo((25 - (25 * Math.PI) / 4) * 30, 6);
    // the fillet followed the edge to x = 55
    const ff = wider.bodies[0].faces.find((f) => f.surf === 'F:f1:0')!;
    expect(ff.p[0]).toBeGreaterThan(49);
  });

  it('a radius that is too big gives a clear error and leaves the body untouched', () => {
    const r = buildModel([box(), fillet('f1', [ref([40, 15, 20])], 25)]);
    expect(r.steps[1].error).toBe(true);
    expect(r.steps[1].note).toMatch(/too big/);
    expect(r.bodies[0].volume).toBeCloseTo(24000, 6);
    const gone = buildModel([box(), fillet('f1', [{ kind: 'line', bodyId: 'b9', a: [0, 0, 0], b: [1, 0, 0], n1: [0, 0, 1], n2: [0, 1, 0] }], 2)]);
    expect(gone.steps[1]).toMatchObject({ error: true, note: 'its edges are gone' });
  });
});
