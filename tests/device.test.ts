// An iPad opens in iPad mode by itself; a desktop or laptop does not.
import { describe, expect, it } from 'vitest';
import { detectDevice } from '../src/core/device';

const base = { ua: '', platform: '', maxTouchPoints: 0, width: 1400, coarsePointer: false };

describe('device detection', () => {
  it('an iPad (old and new Safari, which claims to be a Mac) is a tablet', () => {
    expect(detectDevice({ ...base, ua: 'Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X) AppleWebKit/605.1.15', platform: 'iPad', maxTouchPoints: 5, width: 1180, coarsePointer: true })).toBe('tablet');
    expect(detectDevice({ ...base, ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5, width: 1366, coarsePointer: true })).toBe('tablet');
  });
  it('a Mac or a Windows laptop (even one with a touch screen and a mouse) is a desktop', () => {
    expect(detectDevice({ ...base, platform: 'MacIntel', maxTouchPoints: 0 })).toBe('desktop');
    expect(detectDevice({ ...base, platform: 'Win32', maxTouchPoints: 10, coarsePointer: false })).toBe('desktop');
  });
  it('another big touch-first screen is a tablet; a phone is not', () => {
    expect(detectDevice({ ...base, platform: 'Linux armv81', maxTouchPoints: 5, width: 1280, coarsePointer: true })).toBe('tablet');
    expect(detectDevice({ ...base, platform: 'Linux armv81', maxTouchPoints: 5, width: 640, coarsePointer: true })).toBe('desktop');
  });
});
