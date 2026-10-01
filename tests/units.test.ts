// Millimeters / inches: the model stays in mm, only what is shown and typed changes.
import { afterEach, describe, expect, it } from 'vitest';
import { dragStep, fmtArea, fmtLen, fmtU, fromUser, gridSizes, setUnitValue, toUser } from '../src/core/units';

afterEach(() => setUnitValue('mm'));

describe('units', () => {
  it('millimeters: nothing changes', () => {
    expect(toUser(12.5)).toBe(12.5);
    expect(fromUser(12.5)).toBe(12.5);
    expect(fmtU(12.345)).toBe('12.35 mm');
    expect(fmtArea(400)).toBe('400 mm²');
  });
  it('inches: 25.4 mm is one inch, both ways, shown to three decimals', () => {
    setUnitValue('in');
    expect(toUser(25.4)).toBeCloseTo(1, 12);
    expect(fromUser(1)).toBeCloseTo(25.4, 12);
    expect(fromUser(toUser(37.123))).toBeCloseTo(37.123, 12);
    expect(fmtLen(60)).toBe('2.362');
    expect(fmtLen(40)).toBe('1.575');
    expect(fmtU(25.4)).toBe('1 in');
    expect(fmtArea(645.16)).toBe('1 in²');
    expect(fmtArea(400)).toBe('0.62 in²');
  });
  it('the grid follows the unit: 10 / 50 mm lines, or 0.5 / 2.5 in lines that reach 7.5 in', () => {
    expect(gridSizes('mm')).toEqual({ minor: 10, major: 50, extent: 150 });
    const g = gridSizes('in');
    expect(g.minor).toBeCloseTo(12.7, 9);
    expect(g.major).toBeCloseTo(63.5, 9);
    expect(g.extent).toBeCloseTo(190.5, 9);
    expect(g.major / g.minor).toBeCloseTo(5, 9); // five thin lines to each heavy one, like the mm grid
    expect(g.extent / g.major).toBeCloseTo(3, 9);
  });
  it('the drag arrow moves in 0.1 mm or 0.005 in steps (Shift coarse, Alt fine)', () => {
    expect([dragStep(false, false), dragStep(true, false), dragStep(false, true)]).toEqual([0.1, 1, 0.01]);
    setUnitValue('in');
    expect([dragStep(false, false), dragStep(true, false), dragStep(false, true)]).toEqual([0.005, 0.1, 0.001]);
  });
});
