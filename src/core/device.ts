// Which kind of device this is, so an iPad opens in iPad mode by itself.
export type Device = 'desktop' | 'tablet';

export interface DeviceHints { ua: string; platform: string; maxTouchPoints: number; width: number; coarsePointer: boolean }

/**
 * An iPad (iPadOS reports itself as a Mac, so a "Mac" with a touch screen is an iPad) or any other
 * large touch-first screen gets iPad mode. A desktop or laptop keeps the mouse-and-keyboard layout.
 */
export function detectDevice(h: DeviceHints): Device {
  if (/iPad/i.test(h.ua)) return 'tablet';
  if (/Mac/i.test(h.platform) && h.maxTouchPoints > 1) return 'tablet';
  if (h.coarsePointer && h.maxTouchPoints > 1 && h.width >= 700) return 'tablet';
  return 'desktop';
}

export const currentHints = (): DeviceHints => ({
  ua: navigator.userAgent,
  platform: navigator.platform || '',
  maxTouchPoints: navigator.maxTouchPoints || 0,
  width: Math.max(window.innerWidth, window.innerHeight),
  coarsePointer: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
});
