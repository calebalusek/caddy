// Standard views, zoom to fit and smooth camera moves.
import { $, reduceMotion } from '../core/dom';
import { icon } from '../core/icons';
import { message } from '../ui/message';
import { planeFitPoints } from './planes';
import { cam, camera, onFrame, V3 } from './scene';

export interface ViewGoal { theta: number; phi: number; r?: number; target?: V3 }

let anim: { from: Required<ViewGoal>; goal: Required<ViewGoal>; t0: number; dur: number } | null = null;
export const isAnimating = (): boolean => !!anim;
export const stopAnimation = (): void => { anim = null; };

export const VIEWS: Record<string, { theta: number; phi: number }> = {
  home: { theta: -Math.PI / 4, phi: Math.acos(1 / Math.sqrt(3)) },
  bottom: { theta: -Math.PI / 2, phi: Math.PI - 0.001 },
  back: { theta: Math.PI / 2, phi: Math.PI / 2 },
  left: { theta: Math.PI, phi: Math.PI / 2 },
  top: { theta: -Math.PI / 2, phi: 0.001 },
  front: { theta: -Math.PI / 2, phi: Math.PI / 2 },
  right: { theta: 0, phi: Math.PI / 2 },
};

export function animateTo(to: ViewGoal): void {
  const from = { theta: cam.theta, phi: cam.phi, r: cam.r, target: cam.target.clone() };
  let dt = to.theta - from.theta;
  dt = Math.atan2(Math.sin(dt), Math.cos(dt));
  const goal = { theta: from.theta + dt, phi: to.phi, r: to.r != null ? to.r : from.r, target: to.target || from.target };
  if (reduceMotion()) { cam.theta = goal.theta; cam.phi = goal.phi; cam.r = goal.r; cam.target.copy(goal.target); return; }
  anim = { from, goal, t0: performance.now(), dur: 420 };
}

onFrame((now) => {
  if (!anim) return;
  const k = Math.min(1, (now - anim.t0) / anim.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
  const { from, goal } = anim;
  cam.theta = from.theta + (goal.theta - from.theta) * e;
  cam.phi = from.phi + (goal.phi - from.phi) * e;
  cam.r = from.r + (goal.r - from.r) * e;
  cam.target.lerpVectors(from.target, goal.target, e);
  if (k >= 1) anim = null;
});

/** Everything worth keeping on screen. Bodies and sketches join in later steps. */
const extraPoints: Array<() => V3[]> = [];
export const addFitSource = (fn: () => V3[]): void => { extraPoints.push(fn); };
export function scenePoints(includeOrigin: boolean): V3[] {
  const pts: V3[] = includeOrigin ? [new V3()] : [];
  extraPoints.forEach((fn) => pts.push(...fn()));
  pts.push(...planeFitPoints());
  return pts;
}

/** Target and distance that fit a set of world points on screen for a given view direction. */
export function fitView(pts: V3[], theta: number, phi: number, margin = 1.2): { target: V3; r: number } {
  if (!pts.length) return { target: new V3(15, 10, 8), r: 230 };
  const d = new V3(Math.sin(phi) * Math.cos(theta), Math.sin(phi) * Math.sin(theta), Math.cos(phi));
  const f = d.clone().negate();
  const right = new V3().crossVectors(f, new V3(0, 0, 1));
  if (right.lengthSq() < 1e-10) right.set(1, 0, 0);
  right.normalize();
  const up = new V3().crossVectors(right, f).normalize();
  let r0 = Infinity, r1 = -Infinity, u0 = Infinity, u1 = -Infinity, d0 = Infinity, d1 = -Infinity;
  pts.forEach((p) => {
    const a = p.dot(right), b = p.dot(up), c = p.dot(d);
    r0 = Math.min(r0, a); r1 = Math.max(r1, a); u0 = Math.min(u0, b); u1 = Math.max(u1, b); d0 = Math.min(d0, c); d1 = Math.max(d1, c);
  });
  const target = right.clone().multiplyScalar((r0 + r1) / 2).addScaledVector(up, (u0 + u1) / 2).addScaledVector(d, (d0 + d1) / 2);
  const tanH = Math.tan((camera.fov * Math.PI) / 360), aspect = camera.aspect || 1.5;
  const need = Math.max((u1 - u0) / 2 / tanH, (r1 - r0) / 2 / (tanH * aspect)) * margin + (d1 - d0) / 2;
  return { target, r: Math.min(2500, Math.max(60, need)) };
}

/** Orbit angles that look along −n (camera sits on the +n side). */
export function frameAngles(n: V3): { theta: number; phi: number } {
  let phi = Math.acos(Math.max(-1, Math.min(1, n.z))), theta: number;
  if (phi < 0.01) { phi = 0.001; theta = -Math.PI / 2; }
  else if (phi > Math.PI - 0.01) { phi = Math.PI - 0.001; theta = -Math.PI / 2; }
  else theta = Math.atan2(n.y, n.x);
  return { theta, phi };
}

export function setView(name: string): void {
  const v = VIEWS[name];
  animateTo({ ...v, ...fitView(scenePoints(name === 'home'), v.theta, v.phi) });
}
export function setViewDir(dv: V3): void {
  const a = frameAngles(dv.clone().normalize());
  const pts = scenePoints(false);
  animateTo({ ...a, ...fitView(pts.length ? pts : [new V3()], a.theta, a.phi) });
}
export function zoomFit(): void {
  animateTo({ theta: cam.theta, phi: cam.phi, ...fitView(scenePoints(false), cam.theta, cam.phi) });
}
export function goHome(): void {
  setView('home');
  message('Home view');
}

export function initViewsBar(): void {
  const bar = $('.views');
  bar.innerHTML =
    `<button class="vbtn" data-v="home" title="Home: isometric view of the origin and model (HOME)">${icon('home')}Home</button>` +
    `<button class="vbtn" data-v="fit" title="Zoom to fit everything (ZE)">${icon('fit')}Fit</button>`;
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-v]');
    if (!b) return;
    if (b.dataset.v === 'home') goHome();
    else if (b.dataset.v === 'fit') zoomFit();
  });
}
