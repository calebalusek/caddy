// Picking planes in the viewport: for tools that ask for one (Create sketch, Offset plane) and for
// select-first (click a plane, then start a tool). Hover = orange, selected = blue.
import * as THREE from 'three';
import { $ } from '../core/dom';
import { emit } from '../app/hub';
import { refKey, state, type PickOpts } from '../app/state';
import { frameFromFace } from '../model/frames';
import type { PlaneRef } from '../model/types';
import { message } from '../ui/message';
import { pickablePlanes, type PlaneVis } from '../view/planes';
import { camera, canvas, vp } from '../view/scene';

export const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
/** Cursor position in viewport pixels. */
export const mouse = { x: 0, y: 0 };

export function setPointer(e: MouseEvent): void {
  const v = vp.getBoundingClientRect(), r = canvas.getBoundingClientRect();
  mouse.x = e.clientX - v.left;
  mouse.y = e.clientY - v.top;
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
}

const pickTip = $('#pickTip');

export function startPick(opts: PickOpts): void {
  state.pick = opts;
  state.hoverKey = null;
  pickTip.textContent = opts.prompt;
  pickTip.classList.remove('bad');
  emit('mode', 'select');
  message(opts.prompt + '. Esc to cancel.');
}

export function endPick(): void {
  state.pick = null;
  state.hoverKey = null;
  pickTip.style.display = 'none';
  canvas.style.cursor = '';
  emit('mode', 'select');
}

export function cancelPick(): void {
  const p = state.pick;
  if (!p) return;
  endPick();
  if (p.onCancel) p.onCancel();
  else message('Selection canceled');
}

/** The plane under the cursor, and how far along the cursor ray it is. */
export function planeUnderCursor(): { vis: PlaneVis; distance: number } | null {
  const opts = state.pick;
  const cands = pickablePlanes().filter((v) => {
    if (opts && opts.beforeIndex != null && v.ref.kind === 'plane') {
      const id = v.ref.id;
      return state.features.findIndex((f) => f.id === id) < opts.beforeIndex;
    }
    return true;
  });
  const hit = ray.intersectObjects(cands.map((v) => v.fill), false)[0];
  return hit ? { vis: hit.object.userData.vis as PlaneVis, distance: hit.distance } : null;
}

export function clearSelection(): void {
  if (!state.selection.length) return;
  state.selection = [];
  emit('select');
}

/** Show the pick prompt next to the cursor while a tool asks for a plane. */
export function showPickTip(problem?: string): void {
  if (!state.pick) return;
  pickTip.textContent = problem || state.pick.prompt;
  pickTip.classList.toggle('bad', !!problem);
  pickTip.style.display = 'block';
  pickTip.style.transform = `translate(${Math.round(mouse.x + 14)}px, ${Math.round(mouse.y + 20)}px)`;
}
export function hidePickTip(): void { pickTip.style.display = 'none'; }

/** A plane selected before the tool was started, or a selected flat body face used as one (select first, then tool). */
export function selectedPlaneRef(): PlaneRef | null {
  for (const s of state.selection) {
    if (s.kind === 'plane') return s.ref;
    if (s.kind === 'face' && s.planar) { const id = s.bodyId, b = state.bodies.find((x) => x.id === id); return { kind: 'face', frame: frameFromFace(s.n, s.p), bodyName: b ? b.name : 'body' }; }
  }
  return null;
}

export function planeName(ref: PlaneRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'origin') return ref.id + ' plane';
  if (ref.kind === 'plane') { const id = ref.id; const p = state.features.find((f) => f.id === id); return p ? p.name : 'Missing plane'; }
  return 'Face of ' + ref.bodyName;
}

export { refKey };
