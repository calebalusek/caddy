import { describe, expect, it } from 'vitest';
import { addLine, addPt, newId, newSketchData, PT, type SketchData } from '../src/sketch/model';
import { sketchProfiles } from '../src/sketch/profiles';
import { analyze, independent, solveSketch } from '../src/sketch/solver';

const con = (sk: SketchData, c: Record<string, unknown>): void => { sk.cons.push({ id: newId(sk, 'k'), ...c } as any); };

/** Closed rectangle with shared corner points, like the Rectangle tool draws it. First corner can be the origin. */
function rect(sk: SketchData, x: number, y: number, w: number, h: number, atOrigin = false): string[] {
  const p = [atOrigin ? 'O' : addPt(sk, x, y), addPt(sk, x + w, y), addPt(sk, x + w, y + h), addPt(sk, x, y + h)];
  return [0, 1, 2, 3].map((i) => addLine(sk, p[i], p[(i + 1) % 4]));
}
function circle(sk: SketchData, x: number, y: number, r: number): string {
  const id = newId(sk, 'c');
  sk.curves.push({ id, type: 'circle', c: addPt(sk, x, y), r });
  return id;
}
function arc(sk: SketchData, cx: number, cy: number, r: number, a1: number, a2: number, p1?: string, p2?: string): string {
  const id = newId(sk, 'a');
  sk.curves.push({ id, type: 'arc', c: addPt(sk, cx, cy), p1: p1 || addPt(sk, cx + r * Math.cos(a1), cy + r * Math.sin(a1)), p2: p2 || addPt(sk, cx + r * Math.cos(a2), cy + r * Math.sin(a2)), r });
  return id;
}
const areas = (sk: SketchData): number[] => sketchProfiles(sk).map((p) => p.area).sort((a, b) => a - b);

describe('constraint solver', () => {
  it('drives a rough rectangle to exactly 40 × 30 and reports it fully defined', () => {
    const sk = newSketchData();
    const [b, r, t, l] = rect(sk, 0, 0, 37.3, 22.1, true);
    const far = (sk.curves.find((x) => x.id === r) as any).p2 as string; // corner opposite the origin
    sk.pts[far].y += 1.5; // drawn a little crooked
    con(sk, { type: 'horizontal', l: b }); con(sk, { type: 'vertical', l: r });
    con(sk, { type: 'horizontal', l: t }); con(sk, { type: 'vertical', l: l });
    expect(analyze(sk).dof).toBe(2);
    con(sk, { type: 'length', l: b, v: 40 }); con(sk, { type: 'length', l: r, v: 30 });
    expect(solveSketch(sk)).toBe(true);
    const corner = PT(sk, far);
    expect(Math.abs(corner[0])).toBeCloseTo(40, 6);
    expect(Math.abs(corner[1])).toBeCloseTo(30, 6);
    const st = analyze(sk);
    expect(st.dof).toBe(0);
    expect(st.curveFixed.size).toBe(4);
  });

  it('rejects a redundant constraint and accepts an independent one', () => {
    const sk = newSketchData();
    const [b, r] = rect(sk, 5, 5, 20, 10);
    con(sk, { type: 'horizontal', l: b });
    expect(independent(sk, { id: 'x', type: 'horizontal', l: b })).toBe(false);
    expect(independent(sk, { id: 'x', type: 'vertical', l: r })).toBe(true);
  });

  it('holds perpendicular, equal and tangent together', () => {
    const sk = newSketchData();
    const pa = addPt(sk, 20, 1), pb = addPt(sk, 2, 14);
    const a = addLine(sk, 'O', pa), b = addLine(sk, 'O', pb);
    const c = circle(sk, 30, 30, 7), center = (sk.curves.find((x) => x.id === c) as any).c as string;
    con(sk, { type: 'horizontal', l: a }); con(sk, { type: 'perp', a, b }); con(sk, { type: 'equal', a, b });
    con(sk, { type: 'length', l: a, v: 25 }); con(sk, { type: 'tangent', a, b: c, sgn: 1 }); con(sk, { type: 'diameter', c, v: 12 });
    expect(solveSketch(sk)).toBe(true);
    expect(sk.pts[pa].x).toBeCloseTo(25, 6);
    expect(Math.abs(sk.pts[pb].x)).toBeCloseTo(0, 6);
    expect(Math.abs(sk.pts[pb].y)).toBeCloseTo(25, 6);
    expect(Math.abs(sk.pts[center].y)).toBeCloseTo(6, 6); // circle center sits one radius off the line
  });

  it('follows a drag target while keeping the dimensions', () => {
    const sk = newSketchData();
    const end = addPt(sk, 10, 0), l = addLine(sk, 'O', end);
    con(sk, { type: 'length', l, v: 10 });
    solveSketch(sk, [{ p: end, x: 0, y: 50 }]);
    expect(Math.hypot(sk.pts[end].x, sk.pts[end].y)).toBeCloseTo(10, 6);
    expect(sk.pts[end].y).toBeGreaterThan(9.9); // swung toward the cursor
  });
});

describe('profiles (exact regions)', () => {
  it('rectangle: one region with the exact area', () => {
    const sk = newSketchData();
    const ids = rect(sk, 0, 0, 40, 30);
    const prs = sketchProfiles(sk);
    expect(prs).toHaveLength(1);
    expect(prs[0].area).toBeCloseTo(1200, 9);
    expect(prs[0].key).toBe('F' + ids.slice().sort().join('+'));
    expect(prs[0].loop.edges).toHaveLength(4);
  });

  it('plate with a hole: the plate region excludes the circle, both are selectable', () => {
    const sk = newSketchData();
    rect(sk, 0, 0, 60, 40);
    const c = circle(sk, 20, 20, 4);
    const prs = sketchProfiles(sk);
    expect(prs).toHaveLength(2);
    const plate = prs.find((p) => p.outer)!, hole = prs.find((p) => p.key === c)!;
    expect(plate.holes).toHaveLength(1);
    expect(plate.area).toBeCloseTo(2400 - Math.PI * 16, 9);
    expect(hole.area).toBeCloseTo(Math.PI * 16, 9);
    expect(hole.loop.kind).toBe('circle');
  });

  it('a dangling line does not make or break a region', () => {
    const sk = newSketchData();
    rect(sk, 0, 0, 10, 10);
    addLine(sk, addPt(sk, 20, 0), addPt(sk, 30, 5));
    addLine(sk, (sk.curves[0] as any).p2, addPt(sk, 15, 15)); // spur off a corner
    expect(areas(sk)).toHaveLength(1);
    expect(areas(sk)[0]).toBeCloseTo(100, 9);
  });

  it('crossing lines split each other', () => {
    const sk = newSketchData();
    rect(sk, 0, 0, 40, 30);
    addLine(sk, addPt(sk, 10, -5), addPt(sk, 10, 35));
    const a = areas(sk);
    expect(a).toHaveLength(2);
    expect(a[0]).toBeCloseTo(300, 9);
    expect(a[1]).toBeCloseTo(900, 9);
  });

  it('half disc from one line and one arc keeps a true arc edge', () => {
    const sk = newSketchData();
    const p1 = addPt(sk, 10, 0), p2 = addPt(sk, -10, 0);
    addLine(sk, p2, p1);
    arc(sk, 0, 0, 10, 0, Math.PI, p1, p2);
    const prs = sketchProfiles(sk);
    expect(prs).toHaveLength(1);
    expect(prs[0].area).toBeCloseTo((Math.PI * 100) / 2, 9);
    expect(prs[0].loop.edges.map((e) => e.type).sort()).toEqual(['arc', 'line']);
  });

  it('rounded rectangle: area is exact, not faceted', () => {
    const sk = newSketchData(), w = 40, h = 30, r = 5;
    const P = (x: number, y: number) => addPt(sk, x, y);
    const b1 = P(r, 0), b2 = P(w - r, 0), r1 = P(w, r), r2 = P(w, h - r), t1 = P(w - r, h), t2 = P(r, h), l1 = P(0, h - r), l2 = P(0, r);
    addLine(sk, b1, b2); addLine(sk, r1, r2); addLine(sk, t1, t2); addLine(sk, l1, l2);
    arc(sk, w - r, r, r, -Math.PI / 2, 0, b2, r1); arc(sk, w - r, h - r, r, 0, Math.PI / 2, r2, t1);
    arc(sk, r, h - r, r, Math.PI / 2, Math.PI, t2, l1); arc(sk, r, r, r, Math.PI, 1.5 * Math.PI, l2, b1);
    const prs = sketchProfiles(sk);
    expect(prs).toHaveLength(1);
    expect(prs[0].area).toBeCloseTo(w * h - (4 - Math.PI) * r * r, 9);
    expect(prs[0].loop.edges).toHaveLength(8);
  });

  it('a circle crossed by a line splits into two regions (the prototype could not do this)', () => {
    const sk = newSketchData();
    circle(sk, 0, 0, 10);
    addLine(sk, addPt(sk, -20, 5), addPt(sk, 20, 5));
    const a = areas(sk);
    expect(a).toHaveLength(2);
    expect(a[0] + a[1]).toBeCloseTo(Math.PI * 100, 9);
    const cap = 100 * Math.acos(0.5) - 5 * Math.sqrt(75); // circular segment above y = 5
    expect(a[0]).toBeCloseTo(cap, 9);
  });

  it('a circle overlapping a rectangle edge gives three regions: notch, lens and the rest', () => {
    const sk = newSketchData();
    rect(sk, 0, 0, 40, 30);
    circle(sk, 40, 15, 8);
    const a = areas(sk);
    expect(a).toHaveLength(3);
    const half = (Math.PI * 64) / 2;
    expect(a[0]).toBeCloseTo(half, 9);
    expect(a[1]).toBeCloseTo(half, 9);
    expect(a[2]).toBeCloseTo(1200 - half, 9);
  });

  it('two overlapping circles: lens plus two crescents', () => {
    const sk = newSketchData();
    circle(sk, 0, 0, 10); circle(sk, 10, 0, 10);
    const a = areas(sk);
    expect(a).toHaveLength(3);
    const lens = 2 * 100 * Math.acos(0.5) - 10 * Math.sqrt(75);
    expect(a[0]).toBeCloseTo(lens, 8);
    expect(a[1]).toBeCloseTo(Math.PI * 100 - lens, 8);
    expect(a[2]).toBeCloseTo(Math.PI * 100 - lens, 8);
  });

  it('construction curves never form regions', () => {
    const sk = newSketchData();
    rect(sk, 0, 0, 10, 10);
    const c = circle(sk, 5, 5, 3);
    (sk.curves.find((x) => x.id === c) as any).construction = true;
    expect(sketchProfiles(sk)).toHaveLength(1);
  });
});
