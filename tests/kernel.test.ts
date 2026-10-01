import { beforeAll, describe, expect, it } from 'vitest';
import { testBox } from '../src/kernel/ops';
import { loadKernel, meshVolume } from './helpers/kernel';

beforeAll(loadKernel);

describe('kernel: box', () => {
  it('40 × 30 × 20 box has an exact volume of 24 000', () => {
    const m = testBox(40, 30, 20);
    expect(m.volume).toBeCloseTo(24000, 6);
    expect(meshVolume(m.positions, m.indices)).toBeCloseTo(24000, 2);
  });

  it('sits with its corner at the origin', () => {
    const m = testBox(40, 30, 20);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < m.positions.length; i++) {
      min[i % 3] = Math.min(min[i % 3], m.positions[i]);
      max[i % 3] = Math.max(max[i % 3], m.positions[i]);
    }
    [0, 0, 0].forEach((v, k) => expect(min[k]).toBeCloseTo(v, 4));
    [40, 30, 20].forEach((v, k) => expect(max[k]).toBeCloseTo(v, 4));
  });

  it('keeps face and edge identity: 6 faces, 12 edges', () => {
    const m = testBox(40, 30, 20);
    expect(new Set(m.faceGroups.map((g) => g.faceId)).size).toBe(6);
    expect(new Set(m.edgeGroups.map((g) => g.edgeId)).size).toBe(12);
    expect(m.indices.length / 3).toBe(12);
  });
});
