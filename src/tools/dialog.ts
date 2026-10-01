// Tool menus (feature dialogs). Each tool registers a definition: its fields, defaults, live preview
// and what happens on OK. This file owns the shared behavior every tool gets for free:
// values start at 0, Enter/Esc, typed math, the drag arrow, docking and the remembered position.
import * as THREE from 'three';
import { $, cssv, esc, fmt } from '../core/dom';
import { parseExpr } from '../core/expr';
import { icon } from '../core/icons';
import { emit, on } from '../app/hub';
import { regenerate } from '../app/regenerate';
import { rebuildSolids } from '../app/solids';
import { pushUndo, snapshotDoc } from '../app/undo';
import { state } from '../app/state';
import type { BuildStep } from '../kernel/protocol';
import type { Feature } from '../model/types';
import { message } from '../ui/message';
import { makeMovable, placePanel } from '../ui/panel';
import { arrowMat, camera, canvas, onFrame, previewEdgeMat, previewEdges, previewGroup, previewMat, previewMesh, scene, V3, vp, ZAX } from '../view/scene';
import { finishSketch } from '../sketch/session';
import { endPick, ray } from './pick';

export interface FieldDef<P> {
  key: string;
  kind: 'length' | 'choice' | 'chip';
  label: string;
  /** length: the box that gets focus when the menu opens. */
  primary?: boolean;
  unit?: string;
  /** choice */
  options?: string[];
  lockOnEdit?: boolean;
  hintId?: string;
  /** chip: a selection box showing what is picked. `act` makes it clickable. */
  chipId?: string;
  act?: string;
  note?: string;
  showIf?: (p: P) => boolean;
}

export interface ChipState { text: string; set?: boolean; picking?: boolean }
/** The drag arrow: it sits at tip and moves along axis from base. */
export interface Handle { base: V3; tip: V3; axis: V3; dir: number; value: number }
export interface PreviewResult { geo?: THREE.BufferGeometry | null; handle?: Handle | null; cut?: boolean; ok: boolean }

export interface ToolDef<P = any> {
  type: string;
  title: string;
  icon: string;
  /** Toolbar group color class, e.g. g-create. */
  gc: string;
  prompt: string;
  fields: FieldDef<P>[];
  advanced?: FieldDef<P>[];
  /** Parameter the drag arrow changes. */
  distanceKey?: string;
  /** The drag arrow never goes below this (sizes cannot be negative). */
  minDistance?: number;
  defaults: () => P;
  onOpen?: (A: ActiveDialog<P>) => void;
  chips?: (A: ActiveDialog<P>) => Record<string, ChipState>;
  onAct?: (A: ActiveDialog<P>, act: string) => void;
  /** Return true if Esc was used up (e.g. it only ended a pick). */
  onEscape?: (A: ActiveDialog<P>) => boolean;
  preview: (A: ActiveDialog<P>) => PreviewResult;
  /** A build step for the kernel that previews this tool live on the body (fillet, chamfer). */
  draftStep?: (A: ActiveDialog<P>) => BuildStep | null;
  /** Mouse over the viewport while the menu is open: highlight what a click would pick. Return true if something is pickable. */
  hover?: (A: ActiveDialog<P>) => boolean;
  /** A click in the viewport while the menu is open. */
  click?: (A: ActiveDialog<P>, e: PointerEvent) => void;
  /** Something clicked in the Browser or History while the menu is open (standing rule 2). Return true if it was used. */
  pickRef?: (A: ActiveDialog<P>, kind: string, id: string) => boolean;
  /** Pressing on something of the tool's own in the viewport (a hole marker) starts a drag; return its data, or null. */
  dragStart?: (A: ActiveDialog<P>, e: PointerEvent) => any;
  dragMove?: (A: ActiveDialog<P>, data: any, e: PointerEvent) => void;
  dragEnd?: (A: ActiveDialog<P>, data: any) => void;
  /** The bodies were rebuilt while the menu is open. */
  onBuilt?: (A: ActiveDialog<P>) => void;
  /** The menu is closing: remove the tool's highlights. */
  onClose?: (A: ActiveDialog<P>) => void;
  /** Create or update the feature. Return true to close the menu. */
  commit: (A: ActiveDialog<P>, params: P) => boolean;
}

export interface ActiveDialog<P = any> {
  type: string;
  def: ToolDef<P>;
  params: P;
  edit: Feature | null;
  note?: string;
  /** Reopened by Ctrl+Z: the timeline as it was before this feature's last change. Ctrl+Z again goes back to it. */
  undoBefore?: string;
}

const TOOLS: Record<string, ToolDef> = {};
export const registerTool = <P>(def: ToolDef<P>): void => { TOOLS[def.type] = def; };
export const hasTool = (type: string): boolean => type in TOOLS;

const dialogEl = document.createElement('section');
dialogEl.className = 'dialog';
dialogEl.setAttribute('aria-labelledby', 'dlgTitle');
const dimEl = $('#dim');

// ---- drag arrow ----
const arrow = new THREE.Group();
arrow.visible = false;
{
  const shaftG = new THREE.CylinderGeometry(0.75, 0.75, 14, 12); shaftG.translate(0, 7, 0); shaftG.rotateX(Math.PI / 2);
  const coneG = new THREE.ConeGeometry(2.7, 7.5, 24); coneG.translate(0, 17.75, 0); coneG.rotateX(Math.PI / 2);
  const pickG = new THREE.CylinderGeometry(5, 5, 24, 8); pickG.translate(0, 12, 0); pickG.rotateX(Math.PI / 2);
  const shaft = new THREE.Mesh(shaftG, arrowMat), cone = new THREE.Mesh(coneG, arrowMat);
  shaft.renderOrder = cone.renderOrder = 10;
  const grab = new THREE.Mesh(pickG, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, depthTest: false }));
  grab.name = 'grab';
  arrow.add(shaft, cone, grab);
  arrow.userData.dir = 1;
  scene.add(arrow);
}
const handleAxis = new V3(), handleDir = new V3(0, 0, 1);

/** Distance along the arrow's axis closest to the cursor ray; null when looking straight down the axis. */
function axisParam(): number | null {
  const o = ray.ray.origin, d = ray.ray.direction, w0 = o.clone().sub(handleAxis);
  const b = d.dot(handleDir), dd = d.dot(w0), ee = handleDir.dot(w0), denom = 1 - b * b;
  if (denom < 0.02) return null;
  return (ee - b * dd) / denom;
}

export interface HandleDrag { t0: number | null; v0: number; y0: number }
/** If the pointer went down on the drag arrow, start dragging it. */
export function handleDragStart(e: PointerEvent): HandleDrag | null {
  const A = state.active;
  if (!A || !A.def.distanceKey || !arrow.visible || e.button !== 0) return null;
  if (!ray.intersectObject(arrow.getObjectByName('grab')!, false).length) return null;
  return { t0: axisParam(), v0: A.params[A.def.distanceKey], y0: e.clientY };
}
export function handleDragMove(e: PointerEvent, d: HandleDrag, camR: number): void {
  const t = axisParam();
  const v = t === null || d.t0 === null ? d.v0 + (d.y0 - e.clientY) * camR * 0.0025 : d.v0 + (t - d.t0);
  // smooth: 0.1 mm by default; Shift = whole millimeters, Alt = 0.01
  const step = e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1;
  setDistance(+(Math.round(v / step) * step).toFixed(2));
}
export const overHandle = (): boolean => arrow.visible && ray.intersectObject(arrow.getObjectByName('grab')!, false).length > 0;

const tmp = new V3();
onFrame(() => {
  if (!arrow.visible) return;
  const s = camera.position.distanceTo(arrow.position) / 170, dir = arrow.userData.dir as number;
  arrow.scale.set(s, s, s * dir);
  tmp.copy(arrow.position).addScaledVector(handleDir, 26 * s * dir).project(camera);
  if (tmp.z < 1) {
    dimEl.style.transform = `translate(${Math.round(((tmp.x + 1) / 2) * vp.clientWidth + 12)}px, ${Math.round(((1 - tmp.y) / 2) * vp.clientHeight - 12)}px)`;
    dimEl.style.visibility = 'visible';
  } else dimEl.style.visibility = 'hidden';
});

// ---- building the menu ----
function fieldHTML<P>(f: FieldDef<P>, params: any, editing: boolean): string {
  if (f.kind === 'length')
    return `<div class="field" data-field="${f.key}"><label for="f-${f.key}">${f.label}</label><div class="len"><input id="f-${f.key}" data-key="${f.key}" class="len-input${f.primary ? ' primary' : ''}" type="text" inputmode="decimal" autocomplete="off" spellcheck="false" value="${fmt(params[f.key] || 0)}" aria-describedby="h-${f.key}"><span class="unit">${f.unit || 'mm'}</span></div><div class="fhint" id="h-${f.key}"></div></div>`;
  if (f.kind === 'choice') {
    const dis = editing && f.lockOnEdit ? ' disabled title="Fixed after the feature is created"' : '';
    return `<fieldset class="field" data-field="${f.key}"${dis}><legend>${f.label}</legend><div class="seg-row">${f.options!.map((o) => `<label><input type="radio" name="f-${f.key}" data-key="${f.key}" value="${o}"${params[f.key] === o ? ' checked' : ''}><span>${o}</span></label>`).join('')}</div>${f.hintId ? `<div class="auto-hint" id="${f.hintId}"></div>` : ''}</fieldset>`;
  }
  const tag = f.act ? 'button type="button"' : 'div';
  return `<div class="field" data-field="${f.key}"><span class="flabel">${f.label}</span><${tag} class="selchip" id="${f.chipId}"${f.act ? ` data-act="${f.act}"` : ''}></${f.act ? 'button' : 'div'}>${f.note ? `<div class="auto-hint">${f.note}</div>` : ''}</div>`;
}

const cloneParams = <P>(p: P): P => JSON.parse(JSON.stringify(p));

export function openDialog(type: string, editFeature?: Feature | null): void {
  const def = TOOLS[type];
  if (!def) return;
  if (state.active) cancelDialog(true);
  if (state.pick) endPick();
  if (state.mode === 'sketch') finishSketch(true);
  const params = editFeature ? cloneParams(editFeature.params) : def.defaults();
  const A: ActiveDialog = (state.active = { type, def, params, edit: editFeature || null });
  dialogEl.innerHTML = `
    <div class="dhead ${def.gc}">${icon(def.icon)}<h2 id="dlgTitle">${editFeature ? 'Edit ' + esc(editFeature.name) : def.title}</h2>
      <button class="iconbtn" data-act="cancel" aria-label="Cancel">${icon('close')}</button></div>
    <div class="dbody">
      ${def.fields.map((f) => fieldHTML(f, params, !!editFeature)).join('')}
      ${def.advanced && def.advanced.length ? `<details class="adv"><summary>More options</summary><div class="dbody" style="padding:0">${def.advanced.map((f) => fieldHTML(f, params, !!editFeature)).join('')}</div></details>` : ''}
    </div>
    <div class="dfoot"><span class="keys">Enter to finish, Esc to cancel</span>
      <button class="btn" data-act="cancel">Cancel</button><button class="btn primary" data-act="ok" id="okBtn">OK</button></div>`;
  dialogEl.dataset.tool = type;
  vp.appendChild(dialogEl);
  regenerate();
  emit('mode');
  applyShowIf();
  updateChips();
  updatePreview();
  placePanel(dialogEl);
  if (def.onOpen) def.onOpen(A);
  else focusPrimary();
}

function applyShowIf(): void {
  const A = state.active;
  if (!A) return;
  A.def.fields.concat(A.def.advanced || []).forEach((f) => {
    if (!f.showIf) return;
    const el = dialogEl.querySelector<HTMLElement>(`[data-field="${f.key}"]`);
    if (el) el.style.display = f.showIf(A.params) ? '' : 'none';
  });
}

/** The tool changed its own values (picked a circle, switched Objects): show them in the menu, and show or hide the fields that depend on them. */
export function syncFields(): void {
  const A = state.active;
  if (!A) return;
  A.def.fields.concat(A.def.advanced || []).forEach((f) => {
    if (f.kind === 'length') { const el = dialogEl.querySelector<HTMLInputElement>('#f-' + f.key); if (el) el.value = fmt(A.params[f.key] || 0); }
    else if (f.kind === 'choice') dialogEl.querySelectorAll<HTMLInputElement>(`input[name="f-${f.key}"]`).forEach((i) => { i.checked = i.value === A.params[f.key]; });
  });
  applyShowIf(); updateChips();
  placePanel(dialogEl);
}

export function focusPrimary(): void {
  const inp = dialogEl.querySelector<HTMLInputElement>('.len-input.primary') || dialogEl.querySelector<HTMLInputElement>('.len-input');
  if (inp) { inp.focus({ preventScroll: true }); inp.select(); }
}

export function updateChips(): void {
  const A = state.active;
  if (!A || !A.def.chips) return;
  const chips = A.def.chips(A);
  Object.keys(chips).forEach((id) => {
    const el = dialogEl.querySelector<HTMLElement>('#' + id);
    if (!el) return;
    const c = chips[id];
    el.className = 'selchip' + (c.picking ? ' picking' : c.set ? ' set' : '');
    el.innerHTML = (c.set && !c.picking ? '<span class="dot"></span>' : '') + esc(c.text);
  });
}

export function updatePreview(): void {
  const A = state.active;
  if (!A) { previewGroup.visible = false; arrow.visible = false; dimEl.style.display = 'none'; return; }
  const res = A.def.preview(A);
  const col = cssv(res.cut ? '--cut' : '--accent-fill');
  previewMat.color.set(col); previewEdgeMat.color.set(col); arrowMat.color.set(col);
  previewMat.depthTest = !res.cut; previewEdgeMat.depthTest = !res.cut;
  previewMat.opacity = res.cut ? 0.35 : 0.5;
  previewMat.needsUpdate = true; previewEdgeMat.needsUpdate = true;
  previewMesh.geometry.dispose(); previewEdges.geometry.dispose();
  if (res.geo) { previewMesh.geometry = res.geo; previewEdges.geometry = new THREE.EdgesGeometry(res.geo, 25); previewGroup.visible = true; }
  else { previewMesh.geometry = new THREE.BufferGeometry(); previewEdges.geometry = new THREE.BufferGeometry(); previewGroup.visible = false; }
  const h = res.handle;
  if (h) {
    arrow.visible = true;
    arrow.position.copy(h.tip);
    arrow.quaternion.setFromUnitVectors(ZAX, h.axis);
    arrow.userData.dir = h.dir;
    handleAxis.copy(h.base); handleDir.copy(h.axis);
    dimEl.style.display = 'block';
    dimEl.textContent = fmt(h.value) + ' mm';
    dimEl.classList.toggle('cut', !!res.cut);
  } else { arrow.visible = false; dimEl.style.display = 'none'; }
  const ok = dialogEl.querySelector<HTMLButtonElement>('#okBtn');
  if (ok) ok.disabled = !res.ok;
  // tools that preview on the real body (fillet, chamfer): rebuild shortly after the last change
  if (A.def.draftStep) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { if (state.active === A) void rebuildSolids(); }, 70);
  }
}
let draftTimer: ReturnType<typeof setTimeout> | undefined;

/** Set a choice field from code (e.g. Join/Cut picked automatically). */
export function setChoice(key: string, value: string): void {
  dialogEl.querySelectorAll<HTMLInputElement>(`input[name="f-${key}"]`).forEach((i) => { i.checked = i.value === value; });
}
/** Set the small note under a field. */
export function setHint(id: string, text: string): void {
  const el = dialogEl.querySelector<HTMLElement>('#' + id);
  if (el) el.textContent = text;
}

function closeDialog(): void {
  const was = state.active;
  clearTimeout(draftTimer);
  if (was && was.def.onClose) was.def.onClose(was);
  state.active = null;
  state.hoverKey = null;
  dialogEl.remove();
  if (state.pick) endPick();
  canvas.style.cursor = '';
  regenerate();
  updatePreview();
  emit('mode', 'select');
}

export function cancelDialog(silent?: boolean): void {
  const A = state.active;
  if (!A) return;
  // a menu that Ctrl+Z reopened and the user closed: the step can still be undone later
  if (A.undoBefore && A.edit) pushUndo({ kind: 'feature', id: A.edit.id, before: A.undoBefore });
  closeDialog();
  if (!silent) message(`${A.def.title} canceled`);
}

/** Move the drag arrow to where the tool says it is now, without starting another rebuild. */
export function refreshHandle(): void {
  const A = state.active;
  if (!A) return;
  const h = A.def.preview(A).handle;
  if (!h) { arrow.visible = false; dimEl.style.display = 'none'; return; }
  arrow.visible = true;
  arrow.position.copy(h.tip);
  arrow.quaternion.setFromUnitVectors(ZAX, h.axis);
  arrow.userData.dir = h.dir;
  handleAxis.copy(h.base); handleDir.copy(h.axis);
  dimEl.style.display = 'block';
  dimEl.textContent = fmt(h.value) + ' mm';
}

export function setDistance(v: number): void {
  const A = state.active;
  if (!A || !A.def.distanceKey) return;
  const key = A.def.distanceKey;
  if (A.def.minDistance != null) v = Math.max(A.def.minDistance, v);
  A.params[key] = v;
  const inp = dialogEl.querySelector<HTMLInputElement>('#f-' + key);
  if (inp) {
    inp.value = fmt(v);
    inp.classList.remove('invalid');
    inp.removeAttribute('aria-invalid');
    const h = dialogEl.querySelector('#h-' + key);
    if (h) h.textContent = '';
  }
  updatePreview();
}

export function commitDialog(): void {
  const A = state.active;
  if (!A) return;
  if (dialogEl.querySelector('.len-input.invalid')) { message('Fix the highlighted value first', 'warn'); return; }
  const before = A.undoBefore || snapshotDoc();
  if (!A.def.commit(A, cloneParams(A.params))) return;
  const f = A.edit || state.features[state.features.length - 1];
  if (f) pushUndo({ kind: 'feature', id: f.id, before });
  A.undoBefore = undefined;
  closeDialog();
}

/** Esc while a tool menu is open. */
export function escapeDialog(): void {
  const A = state.active;
  if (!A) return;
  if (A.def.onEscape && A.def.onEscape(A)) return;
  cancelDialog();
}

/** A number typed in the viewport goes straight into the tool's main value box. */
export function typeIntoDialog(key: string): boolean {
  const inp = dialogEl.querySelector<HTMLInputElement>('.len-input');
  if (!inp) return false;
  inp.focus();
  inp.value = key;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

export function initDialogs(): void {
  makeMovable(dialogEl);
  // the bodies were rebuilt: what the tool points at may have moved
  on('built', () => { const A = state.active; if (!A) return; updateChips(); if (A.def.onBuilt) A.def.onBuilt(A); });
  dimEl.addEventListener('click', focusPrimary);

  dialogEl.addEventListener('input', (e) => {
    const t = e.target as HTMLInputElement;
    const A = state.active;
    if (!t.classList.contains('len-input') || !A) return;
    const v = parseExpr(t.value), hint = dialogEl.querySelector('#h-' + t.dataset.key)!;
    if (v === null) {
      t.classList.add('invalid'); t.setAttribute('aria-invalid', 'true');
      hint.textContent = 'Use numbers and + − * / ( ), like 40/2+3';
    } else {
      t.classList.remove('invalid'); t.removeAttribute('aria-invalid');
      hint.textContent = '';
      A.params[t.dataset.key!] = v;
      updatePreview();
    }
  });
  dialogEl.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    const A = state.active;
    if (t.type !== 'radio' || !A) return;
    A.params[t.dataset.key!] = t.value;
    if (t.dataset.key === 'operation') A.params.opAuto = false;
    applyShowIf(); updateChips(); updatePreview();
    placePanel(dialogEl); // fields appeared or went away: keep the whole menu on screen
  });
  dialogEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); escapeDialog(); return; }
    const t = e.target as HTMLInputElement;
    if (e.key === 'Enter' && !t.matches('button, summary')) { e.preventDefault(); e.stopPropagation(); commitDialog(); return; }
    if (t.classList.contains('len-input') && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const cur = parseExpr(t.value);
      if (cur === null) return;
      t.value = fmt(cur + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
      t.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (!((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z')) e.stopPropagation();
  });
  dialogEl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    const A = state.active;
    if (!b || !A) return;
    if (b.dataset.act === 'ok') commitDialog();
    else if (b.dataset.act === 'cancel') cancelDialog();
    else if (A.def.onAct) A.def.onAct(A, b.dataset.act!);
  });
}
