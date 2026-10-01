// Picking planes in the viewport: for tools that ask for one (Create sketch, Offset plane) and for
// select-first (click a plane, then start a tool). Hover = orange, selected = blue.
import * as THREE from 'three';
import { $ } from '../core/dom';
import { emit } from '../app/hub';
import { refKey, state, type PickOpts } from '../app/state';
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

/** The plane under the cursor, if a click on it would do something. */
function planeUnderCursor(): PlaneVis | null {
  const opts = state.pick;
  const cands = pickablePlanes().filter((v) => {
    if (opts && opts.beforeIndex != null && v.ref.kind === 'plane') {
      const id = v.ref.id;
      return state.features.findIndex((f) => f.id === id) < opts.beforeIndex;
    }
    return true;
  });
  const hit = ray.intersectObjects(cands.map((v) => v.fill), false)[0];
  return hit ? (hit.object.userData.vis as PlaneVis) : null;
}

/** Whether the viewport takes plane clicks right now. */
const planesClickable = (): boolean => !!state.pick || (!state.active && state.mode === 'solid');

export function hoverMove(): void {
  const v = planesClickable() ? planeUnderCursor() : null;
  const key = v ? v.key : null;
  if (key !== state.hoverKey) { state.hoverKey = key; emit('select'); }
  canvas.style.cursor = v ? 'pointer' : '';
  if (state.pick) {
    pickTip.textContent = state.pick.prompt;
    pickTip.style.display = 'block';
    pickTip.style.transform = `translate(${Math.round(mouse.x + 14)}px, ${Math.round(mouse.y + 20)}px)`;
  }
}

export function hoverLeave(): void {
  pickTip.style.display = 'none';
  if (state.hoverKey) { state.hoverKey = null; emit('select'); }
}

export function clearSelection(): void {
  if (!state.selection.length) return;
  state.selection = [];
  emit('select');
}

/** A click in the viewport that was not a drag. */
export function clickAt(e: PointerEvent): void {
  if (e.button !== 0) return;
  const v = planeUnderCursor();
  if (state.pick) {
    if (!v) return;
    const p = state.pick;
    endPick();
    p.onPick(v.ref);
    return;
  }
  if (state.active || state.mode !== 'solid') return;
  if (!v) {
    if (!e.shiftKey && state.selection.length) { clearSelection(); message('Selection cleared'); }
    return;
  }
  const had = state.selection.some((s) => s.key === v.key);
  if (e.shiftKey) state.selection = had ? state.selection.filter((s) => s.key !== v.key) : state.selection.concat({ kind: 'plane', key: v.key, ref: v.ref });
  else state.selection = had && state.selection.length === 1 ? [] : [{ kind: 'plane', key: v.key, ref: v.ref }];
  emit('select');
  if (state.selection.length) message(`${planeName(v.ref)} selected. sk sketches on it, pl offsets a plane from it.`);
}

/** A plane selected before the tool was started (select first, then tool). */
export function selectedPlaneRef(): PlaneRef | null {
  const s = state.selection.find((x) => x.kind === 'plane');
  return s ? s.ref : null;
}

export function planeName(ref: PlaneRef | null): string {
  if (!ref) return '';
  if (ref.kind === 'origin') return ref.id + ' plane';
  if (ref.kind === 'plane') { const id = ref.id; const p = state.features.find((f) => f.id === id); return p ? p.name : 'Missing plane'; }
  return 'Face of ' + ref.bodyName;
}

export { refKey };
