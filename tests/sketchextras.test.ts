// Slot, corner fillet / chamfer, sketch mirror and projected body edges, checked against exact areas.
import { describe, expect, it } from 'vitest';
import { addProjected, addSlot, cornerEdit, mirrorCurves, nearestProjected, projectables } from '../src/sketch/extras';
import { addLine, addPt, newSketchData, type SketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import type { BodyResult } from '../src/kernel/protocol';
import { ORIGIN } from '../src/model/frames';

const area = (sk: SketchData): number => sketchProfiles(sk).reduce((s, p) => s + p.area, 0);
const rect = (w: number, h: number): { sk: SketchData; ids: string[]; lines: string[] } => {
  const sk = newSketchData(), p = [addPt(sk, 0, 0), addPt(sk, w, 0), addPt(sk, w, h), addPt(sk, 0, h)];
  const lines = p.map((_, i) => addLine(sk, p[i], p[(i + 1) % 4]));
  return { sk, ids: p, lines };
};

describe('slot', () => {
  it('area is length x width + a full circle, level or turned', () => {
    for (const b of [[20, 0], [14, 14], [0, -20]] as [number, number][]) {
      const sk = newSketchData();
      expect(addSlot(sk, null, [0, 0], null, b, 6)).toBeNull();
      const L = Math.hypot(b[0], b[1]);
      expect(sketchProfiles(sk)).toHaveLength(1);
      expect(area(sk)).toBeCloseTo(L * 6 + Math.PI * 9, 6);
    }
  });
  it('explains what is missing', () => {
    expect(addSlot(newSketchData(), null, [0, 0], null, [0, 0], 6)).toMatch(/second center/);
    expect(addSlot(newSketchData(), null, [0, 0], null, [10, 0], 0)).toMatch(/width/);
  });
});

describe('corner fillet and chamfer', () => {
  it('a 20 x 10 rectangle with one corner rounded R3 loses (4 - pi) x 9 / 4 of area', () => {
    const { sk, ids } = rect(20, 10);
    expect(cornerEdit(sk, ids[2], 'fillet', 3)).toBeNull();
    expect(area(sk)).toBeCloseTo(200 - (9 - (Math.PI * 9) / 4), 6);
    expect(sk.curves.filter((c) => c.type === 'arc')).toHaveLength(1);
    expect(sk.pts[ids[2]]).toBeUndefined(); // the old corner is gone
  });
  it('all four corners', () => {
    const { sk, ids } = rect(20, 10);
    ids.forEach((id) => expect(cornerEdit(sk, id, 'fillet', 2)).toBeNull());
    expect(area(sk)).toBeCloseTo(200 - 4 * (4 - Math.PI), 6);
  });
  it('a chamfer of 3 takes a 3-3-3√2 triangle', () => {
    const { sk, ids } = rect(20, 10);
    expect(cornerEdit(sk, ids[0], 'chamfer', 3)).toBeNull();
    expect(area(sk)).toBeCloseTo(200 - 4.5, 6);
  });
  it('works on a corner that is not square', () => {
    const sk = newSketchData(), a = addPt(sk, 0, 0), b = addPt(sk, 20, 0), c = addPt(sk, 10, 15);
    addLine(sk, a, b); addLine(sk, b, c); addLine(sk, c, a);
    const before = area(sk);
    expect(cornerEdit(sk, c, 'fillet', 2)).toBeNull();
    expect(area(sk)).toBeLessThan(before);
    // the arc is tangent to both sides: its end points are on the lines
    const arc = sk.curves.find((x) => x.type === 'arc')!;
    expect(arc.type === 'arc' && Math.abs(Math.hypot(sk.pts[arc.p1].x - sk.pts[arc.c].x, sk.pts[arc.p1].y - sk.pts[arc.c].y) - 2)).toBeLessThan(1e-9);
  });
  it('says why it cannot', () => {
    const { sk, ids } = rect(20, 10);
    expect(cornerEdit(sk, ids[0], 'fillet', 0)).toMatch(/radius/);
    expect(cornerEdit(sk, ids[0], 'fillet', 50)).toMatch(/too big/);
    const s2 = newSketchData(), a = addPt(s2, 0, 0), m = addPt(s2, 5, 0), b = addPt(s2, 10, 0);
    addLine(s2, a, m); addLine(s2, m, b);
    expect(cornerEdit(s2, m, 'fillet', 1)).toMatch(/straight on/);
    expect(cornerEdit(s2, a, 'fillet', 1)).toMatch(/two straight lines/);
  });
});

describe('mirror', () => {
  it('a triangle mirrored across a vertical line makes a second, equal triangle sharing the points on the line', () => {
    const sk = newSketchData(), a = addPt(sk, 0, 0), b = addPt(sk, 10, 0), c = addPt(sk, 0, 10);
    addLine(sk, a, b); addLine(sk, b, c); const axis = addLine(sk, c, a);
    const ids = sk.curves.map((x) => x.id);
    const r = mirrorCurves(sk, ids.filter((x) => x !== axis), axis);
    expect(r).toBe(2);
    expect(Object.keys(sk.pts)).toHaveLength(1 + 3 + 1); // origin, three corners and one new corner: a and c are on the line
    expect(area(sk)).toBeCloseTo(100, 6); // the two triangles make one 20-wide... (50 + 50)
  });
  it('arcs keep their shape (they run the other way round)', () => {
    const sk = newSketchData(), c = addPt(sk, 0, 0), p1 = addPt(sk, 5, 0), p2 = addPt(sk, 0, 5);
    sk.curves.push({ id: 'a1', type: 'arc', c, p1, p2, r: 5 });
    const ax1 = addPt(sk, 10, -5), ax2 = addPt(sk, 10, 5), axis = addLine(sk, ax1, ax2);
    expect(mirrorCurves(sk, ['a1'], axis)).toBe(1);
    const m = sk.curves.find((x) => x.type === 'arc' && x.id !== 'a1')!;
    expect(m.type === 'arc' && [sk.pts[m.c].x, sk.pts[m.p2].x, sk.pts[m.p1].y, sk.pts[m.p2].y]).toEqual([20, 15, 5, 0]);
  });
  it('needs a straight line', () => {
    const { sk, lines } = rect(10, 10);
    sk.curves.push({ id: 'c9', type: 'circle', c: 'O', r: 2 });
    expect(mirrorCurves(sk, lines, 'c9')).toMatch(/straight line/);
  });
});

describe('project body edges', () => {
  const body = { id: 'b1', faces: [], edges: [
    { id: 1, kind: 'line', a: [0, 0, 10], b: [30, 0, 10], mid: [15, 0, 10], faces: [], n1: [0, 0, 1], n2: [0, -1, 0] },
    { id: 2, kind: 'line', a: [0, 0, 0], b: [30, 0, 0], mid: [15, 0, 0], faces: [], n1: [0, 0, -1], n2: [0, -1, 0] },
    { id: 3, kind: 'round', a: [10, 10, 10], b: [10, 10, 10], mid: [10, 10, 10], center: [10, 10, 10], axis: [0, 0, 1], R: 4, closed: true, faces: [], n1: [0, 0, 1], n2: [1, 0, 0] },
    { id: 4, kind: 'round', a: [5, 0, 5], b: [5, 0, 5], mid: [5, 0, 5], center: [5, 0, 5], axis: [0, 1, 0], R: 2, closed: true, faces: [], n1: [0, 0, 1], n2: [1, 0, 0] },
  ] } as unknown as BodyResult;
  it('straight edges and flat circles are found; duplicates behind each other count once; side-on circles are skipped', () => {
    const list = projectables(ORIGIN.XY, [body]);
    expect(list.filter((p) => p.kind === 'line')).toHaveLength(1); // top and bottom edges coincide
    expect(list.filter((p) => p.kind === 'circle')).toHaveLength(1);
  });
  it('picks the nearest and adds it to the sketch, once', () => {
    const list = projectables(ORIGIN.XY, [body]), sk = newSketchData();
    const p = nearestProjected(list, [15, 0.3], 1)!;
    expect(p.kind).toBe('line');
    expect(addProjected(sk, p)).toBeNull();
    expect(addProjected(sk, p)).toMatch(/already/);
    const c = nearestProjected(list, [14, 10], 1)!;
    expect(c.kind).toBe('circle');
    expect(addProjected(sk, c)).toBeNull();
    expect(area(sk)).toBeCloseTo(Math.PI * 16, 6);
    expect(nearestProjected(list, [50, 50], 1)).toBeNull();
  });
});
