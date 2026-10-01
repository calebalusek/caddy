import { describe, expect, it } from 'vitest';
import { parseExpr } from '../src/core/expr';
import { frameFromFace, offsetFrame, ORIGIN, toLocal, toWorld, vcross, vdot } from '../src/model/frames';

describe('value boxes: typed math', () => {
  it('evaluates expressions like 40/2+3', () => {
    expect(parseExpr('40/2+3')).toBe(23);
    expect(parseExpr(' (1.5 + 2.5) * -2 ')).toBe(-8);
    expect(parseExpr('12,5 mm')).toBe(12.5);
    expect(parseExpr('6×2')).toBe(12);
  });
  it('rejects anything that is not a finished number', () => {
    for (const bad of ['', 'abc', '4+', '(2', '1/0', '2 3']) expect(parseExpr(bad)).toBeNull();
  });
});

describe('plane frames', () => {
  it('origin planes are right-handed (u × v = n)', () => {
    for (const f of Object.values(ORIGIN)) expect(vcross(f.u, f.v)).toEqual(f.n);
  });
  it('offsets move along the normal: XZ + 25 sits at y = −25 (toward the Front view)', () => {
    const f = offsetFrame(ORIGIN.XZ, 25);
    expect(f.o).toEqual([0, -25, 0]);
    expect(toWorld(f, 10, 5)).toEqual([10, -25, 5]);
    expect(offsetFrame(ORIGIN.XY, -8).o).toEqual([0, 0, -8]);
  });
  it('toLocal undoes toWorld', () => {
    const f = offsetFrame(ORIGIN.YZ, 12);
    expect(toLocal(f, toWorld(f, 7, -3))).toEqual([7, -3]);
  });
  it('builds a frame on a flat face through the clicked point', () => {
    const f = frameFromFace([0, 0, 2], [10, 20, 8]);
    expect(f.n).toEqual([0, 0, 1]);
    expect(f.o).toEqual([0, 0, 8]);
    expect(vdot(f.u, f.n)).toBeCloseTo(0);
    expect(vcross(f.u, f.v)).toEqual(f.n);
    expect(f.ext).toEqual([-20, 40, -10, 50]);
  });
});
