// The material library: 20 materials, and anything read from a file is checked before it is used.
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOOK, MAT_LIB, cleanLook, matDef } from '../src/view/materials';

describe('materials', () => {
  it('has the 20 materials from the spec, in four groups, with unique ids', () => {
    expect(MAT_LIB).toHaveLength(20);
    expect(new Set(MAT_LIB.map((m) => m.id)).size).toBe(20);
    expect(MAT_LIB.map((m) => m.name)).toEqual(expect.arrayContaining(['PLA matte', 'PETG gloss', 'Silk PLA', 'ABS', 'TPU flexible', 'Resin', 'Clear resin', 'Carbon fiber', 'Brushed aluminum', 'Stainless steel', 'Chrome', 'Brass', 'Copper', 'Cast iron', 'Oak', 'Walnut', 'Wood PLA', 'Concrete', 'Rubber', 'Glazed ceramic']));
    expect([...new Set(MAT_LIB.map((m) => m.group))]).toEqual(['Plastic', 'Metal', 'Wood', 'Other']);
  });
  it('colors can only be changed on tintable materials (filaments, resin, ceramic)', () => {
    expect(matDef('pla').tint).toBe(true);
    expect(matDef('brass').tint).toBeFalsy();
    expect(matDef('oak').tint).toBeFalsy();
  });
  it('a look from a file is cleaned: unknown materials fall back, bad colors are dropped', () => {
    expect(cleanLook({ id: 'brass' })).toEqual({ id: 'brass' });
    expect(cleanLook({ id: 'pla', color: '#2F6FDB' })).toEqual({ id: 'pla', color: '#2F6FDB' });
    expect(cleanLook({ id: 'unobtainium', color: 'red' })).toEqual({ id: DEFAULT_LOOK.id });
    expect(cleanLook({ id: 'abs', color: '<script>' })).toEqual({ id: 'abs' });
    expect(cleanLook(null)).toEqual({ id: DEFAULT_LOOK.id });
  });
});
