// Browser panel (left), History bar (bottom), their right-click menus and renaming.
import { $, esc, fmt } from '../core/dom';
import { icon } from '../core/icons';
import { emit, on } from '../app/hub';
import { deleteBody, deleteFeature, markDirty, toggleVis } from '../app/history';
import { bodyById, featById, feats, state } from '../app/state';
import type { Feature, OriginPlaneId, PlaneRef } from '../model/types';
import { enterSketch, finishSketch, lookAtSketch, selectSketch } from '../sketch/session';
import { hasTool, openDialog } from '../tools/dialog';
import { endPick } from '../tools/pick';
import { message } from './message';
import { openMenu, type MenuItem } from './menu';

const TOOL_STEP: Record<string, number> = { sketch: 2, extrude: 3, fillet: 3, revolve: 5, hole: 5, sweep: 6, shell: 7, pattern: 7 };

/** Open whatever a Browser/History item refers to for editing. */
export function editRef(ref: string): void {
  const [kind, id] = ref.split(':');
  const f = featById(id);
  if (!f) return;
  if (f.type === 'sketch') { enterSketch(f); return; }
  const tool = kind === 'fillet' ? String((f.params as any).kind || 'fillet') : kind;
  if (hasTool(tool)) openDialog(tool, f);
  else message(`Editing ${f.name} arrives in step ${TOOL_STEP[kind] || '?'} of the rebuild.`);
}

function ctxItems(ref: string): MenuItem[] {
  const [kind, id] = ref.split(':');
  if (kind === 'origin')
    return [{ label: state.originPlanesVisible ? 'Hide origin planes' : 'Show origin planes', icon: state.originPlanesVisible ? 'eyeoff' : 'eye', act: () => toggleVis('origin') }];
  if (kind === 'body') {
    const b = bodyById(id);
    if (!b) return [];
    return [
      { label: 'Rename', icon: 'rename', act: () => startRename(ref) },
      { label: b.visible ? 'Hide' : 'Show', icon: b.visible ? 'eyeoff' : 'eye', act: () => toggleVis(ref) },
      { sep: true },
      { label: 'Delete body', icon: 'trash', danger: true, act: () => deleteBody(b) },
    ];
  }
  const f = featById(id);
  if (!f) return [];
  const items: MenuItem[] = [];
  if (kind === 'plane') items.push({ label: 'Edit plane', icon: 'plane', act: () => editRef(ref) });
  else if (f.type === 'sketch') {
    const editing = state.sketch === f;
    items.push({ label: editing ? 'Finish sketch' : 'Edit sketch', icon: editing ? 'finish' : 'sketch', act: () => (editing ? finishSketch() : enterSketch(f)) });
    if (!f.error) items.push({ label: 'Look at', icon: 'look', act: () => lookAtSketch(f) });
  }
  else if (kind === 'extrude') { const cut = (f.params as any).operation === 'Cut'; items.push({ label: 'Edit ' + (cut ? 'cut' : 'extrude'), icon: cut ? 'cut' : 'extrude', act: () => editRef(ref) }); }
  items.push({ label: 'Rename', icon: 'rename', act: () => startRename(ref) });
  if (kind === 'fillet') { const k = String((f.params as any).kind || 'fillet'); items.push({ label: 'Edit ' + k, icon: k, act: () => editRef(ref) }); }
  if (['revolve', 'hole', 'sweep', 'shell', 'pattern'].includes(kind)) items.push({ label: 'Edit ' + kind, icon: kind, act: () => editRef(ref) });
  if (kind === 'sketch' || kind === 'plane') items.push({ label: f.visible === false ? 'Show' : 'Hide', icon: f.visible === false ? 'eye' : 'eyeoff', act: () => toggleVis(ref) });
  items.push({ sep: true }, { label: 'Delete', icon: 'trash', danger: true, act: () => deleteFeature(f) });
  return items;
}
const openCtx = (ref: string, x: number, y: number, opener: HTMLElement): void => openMenu(ctxItems(ref), x, y, opener);

/**
 * Standing rule 2: while a tool is asking for something, clicking it in the Browser or History picks it.
 * Returns true if the click was used by the tool.
 */
function toolPick(kind: string, id: string): boolean {
  if (!state.pick) return false;
  let ref: PlaneRef | null = null;
  if (kind === 'origin' && (id === 'XY' || id === 'XZ' || id === 'YZ')) ref = { kind: 'origin', id: id as OriginPlaneId };
  else if (kind === 'plane') {
    const f = featById(id);
    const idx = state.features.findIndex((x) => x.id === id);
    if (!f || f.error) { message('That plane needs attention first', 'warn'); return true; }
    if (state.pick.beforeIndex != null && idx >= state.pick.beforeIndex) { message('Pick a plane that comes earlier in the History', 'warn'); return true; }
    ref = { kind: 'plane', id };
  }
  if (!ref) return false;
  const p = state.pick;
  endPick();
  p.onPick(ref);
  return true;
}

// ---- Browser ----
const eyeBtn = (ref: string, name: string, visible: boolean): string =>
  `<button class="eye" data-vis="${ref}" aria-pressed="${visible}" aria-label="${visible ? 'Hide' : 'Show'} ${esc(name)}">${icon(visible ? 'eye' : 'eyeoff')}</button>`;
function row(ref: string, kind: string, ic: string, name: string, visible: boolean | undefined, extra?: string): string {
  const cls = ['row', visible === false ? 'hidden' : '', extra || ''].join(' ');
  return `<li class="${cls}" data-ref="${ref}"><button class="rowbtn k-${kind}" data-ref="${ref}" aria-haspopup="menu">${icon(ic)}<span class="nm">${esc(name)}</span></button>${eyeBtn(ref, name, visible !== false)}</li>`;
}
const staticRow = (ic: string, name: string, cls?: string): string => `<li class="row static ${cls || ''}"><span class="rowbtn">${icon(ic)}<span class="nm">${name}</span></span></li>`;
/** Origin planes can be picked from the Browser while a tool asks for a plane. */
const originPlaneRow = (id: OriginPlaneId): string =>
  `<li class="row static"><button class="rowbtn" data-ref="origin:${id}" style="color:inherit">${icon('plane')}<span class="nm">${id} plane</span></button></li>`;
const openSections: Record<string, boolean> = { origin: false, sketches: true, construction: true, bodies: true };

export function renderTree(): void {
  const sks = feats('sketch'), pls = feats('plane'), bs = state.bodies;
  const sec = (key: string, title: string, count: number, inner: string): string =>
    `<details data-sec="${key}"${openSections[key] ? ' open' : ''}><summary><span class="nm">${title}</span><span class="count">${count}</span></summary>${inner}</details>`;
  $('#tree').innerHTML =
    `<details data-sec="origin"${openSections.origin || state.pick ? ' open' : ''}><summary data-ref="origin"><span class="nm">Origin</span>${eyeBtn('origin', 'origin planes', state.originPlanesVisible)}</summary><ul>
      ${staticRow('point', 'Origin point')}${staticRow('axis', 'X axis', 'axis-x')}${staticRow('axis', 'Y axis', 'axis-y')}${staticRow('axis', 'Z axis', 'axis-z')}
      ${originPlaneRow('XY')}${originPlaneRow('XZ')}${originPlaneRow('YZ')}</ul></details>` +
    sec('sketches', 'Sketches', sks.length, sks.length ? `<ul>${sks.map((f) => row('sketch:' + f.id, 'sketch', 'sketch', f.name, f.visible, (f.error ? 'err ' : '') + (state.sketch === f ? 'editing ' : '') + (state.treeSel === f.id ? 'tsel' : ''))).join('')}</ul>` : '<div class="empty">Type sk to start a sketch</div>') +
    sec('construction', 'Construction', pls.length, pls.length ? `<ul>${pls.map((f) => row('plane:' + f.id, 'plane', 'plane', f.name, f.visible, (f.error ? 'err ' : '') + (state.selection.some((s) => s.key === 'plane:' + f.id) ? 'tsel' : ''))).join('')}</ul>` : '<div class="empty">Offset planes show up here</div>') +
    sec('bodies', 'Bodies', bs.length, bs.length ? `<ul>${bs.map((b) => row('body:' + b.id, 'body', 'body', b.name, b.visible)).join('')}</ul>` : '<div class="empty">Extrude a profile to make a body</div>');
}

// ---- History ----
function tip(f: Feature): string {
  const p = f.params as any;
  switch (f.type) {
    case 'sketch': return f.name;
    case 'shell': return `${f.name}: ${fmt(p.thickness)} mm walls`;
    case 'pattern': return `${f.name}: ${String(p.ptype).toLowerCase()} pattern`;
    case 'sweep': return `${f.name} along a path`;
    case 'revolve': return `${f.name}, ${fmt(Math.abs(p.angle))}°`;
    case 'hole': return `${f.name}, Ø${fmt(p.d)} mm`;
    case 'fillet': return `${f.name}, ${p.edges.length} edge${p.edges.length > 1 ? 's' : ''}, ${p.kind === 'chamfer' ? '' : 'R'}${fmt(p.r)} mm`;
    default: return `${f.name}, ${fmt(p.distance)} mm`;
  }
}
export function renderTimeline(): void {
  $('#timeline').innerHTML = state.features
    .map((f) => {
      const p = f.params as any;
      const cut = f.type === 'extrude' && p.operation === 'Cut';
      const editing = (!!state.active && state.active.edit === f) || state.sketch === f;
      const kind = cut ? 'cut' : f.type;
      const t = tip(f);
      return `<li><button class="tl-item k-${kind}${editing ? ' editing' : ''}${f.error ? ' err' : ''}" data-ref="${f.type}:${f.id}" title="${esc(t)}${f.error ? ' (needs attention' + (f.note ? ': ' + f.note : '') + ')' : ''}" aria-label="${esc(t)}" aria-haspopup="menu">${icon(cut ? 'cut' : f.type === 'fillet' ? p.kind : f.type)}</button></li>`;
    })
    .join('');
}

// ---- rename ----
const renamer = $('#renamer'), renameInput = $<HTMLInputElement>('#renameInput');
let renaming: string | null = null;
const objFor = (ref: string): { name: string } | undefined => { const [kind, id] = ref.split(':'); return kind === 'body' ? bodyById(id) : featById(id); };

export function startRename(ref: string): void {
  const o = objFor(ref);
  if (!o) return;
  const anchor = document.querySelector<HTMLElement>(`#tree [data-ref="${ref}"] .nm`) || document.querySelector<HTMLElement>(`#timeline [data-ref="${ref}"]`);
  if (!anchor) return;
  const r = anchor.getBoundingClientRect();
  renaming = ref;
  renamer.style.display = 'block';
  renamer.style.left = Math.max(4, r.left - 7) + 'px';
  renamer.style.top = Math.max(4, anchor.closest('#timeline') ? r.top - 36 : r.top - 3) + 'px';
  renameInput.style.width = Math.max(150, r.width + 40) + 'px';
  renameInput.value = o.name;
  renameInput.focus();
  renameInput.select();
}
function endRename(save: boolean): void {
  if (!renaming) return;
  const ref = renaming;
  renaming = null;
  renamer.style.display = 'none';
  const o = objFor(ref), v = renameInput.value.trim();
  if (save && o && v && v !== o.name) {
    const old = o.name;
    o.name = v.slice(0, 40);
    markDirty();
    emit('doc');
    message(`Renamed ${old} to ${o.name}`, 'ok');
  }
  const back = document.querySelector<HTMLElement>(`#tree [data-ref="${ref}"] .rowbtn`) || document.querySelector<HTMLElement>(`#timeline [data-ref="${ref}"]`);
  if (back) back.focus();
}

export function initTree(): void {
  const tree = $('#tree');
  tree.addEventListener('toggle', (e) => {
    const d = e.target as HTMLDetailsElement;
    if (!d.dataset || !d.dataset.sec) return;
    // Origin opens by itself while a tool asks for a plane; that should not stick afterwards.
    if (d.dataset.sec === 'origin' && state.pick) return;
    openSections[d.dataset.sec] = d.open;
  }, true);
  let lastClick = { ref: '', t: 0 };
  tree.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const eye = t.closest<HTMLElement>('[data-vis]');
    if (eye) { e.preventDefault(); toggleVis(eye.dataset.vis!); return; }
    const b = t.closest<HTMLElement>('.rowbtn[data-ref]');
    if (!b) return;
    const ref = b.dataset.ref!, [kind, id] = ref.split(':');
    if (toolPick(kind, id)) return;
    if (kind === 'origin') return;
    // The tree re-renders on click, so a native dblclick never arrives: detect the second click here.
    const now = performance.now();
    if (lastClick.ref === ref && now - lastClick.t < 450) {
      lastClick = { ref: '', t: 0 };
      if (!(state.sketch && ref === 'sketch:' + state.sketch.id)) editRef(ref);
      return;
    }
    lastClick = { ref, t: now };
    if (kind === 'sketch' && !state.active && state.mode !== 'sketch') {
      // single click highlights the whole sketch (through bodies); double-click edits it
      const f = featById(id);
      selectSketch(state.treeSel === id ? null : id);
      if (f && state.treeSel) message(f.visible === false ? `${f.name} is hidden; showing its highlight anyway` : `${f.name} highlighted. Double-click to edit it.`);
      return;
    }
    if (kind === 'plane' && !state.active) {
      const key = 'plane:' + id, had = state.selection.some((s) => s.key === key);
      const sel = { kind: 'plane' as const, key, ref: { kind: 'plane' as const, id } };
      state.selection = had ? state.selection.filter((s) => s.key !== key) : e.shiftKey ? state.selection.concat(sel) : [sel];
      emit('select', 'doc');
    }
  });
  tree.addEventListener('contextmenu', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-ref]');
    if (!el || el.dataset.ref!.startsWith('origin:')) return;
    e.preventDefault();
    openCtx(el.dataset.ref!, e.clientX, e.clientY, el.querySelector<HTMLElement>('.rowbtn') || el);
  });
  tree.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.rowbtn[data-ref]');
    if (!b || b.dataset.ref!.startsWith('origin:')) return;
    if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = b.getBoundingClientRect(); openCtx(b.dataset.ref!, r.left + 20, r.bottom, b); }
    else if (e.key === 'F2') { e.preventDefault(); startRename(b.dataset.ref!); }
    else if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); editRef(b.dataset.ref!); }
  });

  const tl = $('#timeline');
  let pickT = 0;
  tl.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.tl-item');
    if (!b) return;
    const [kind, id] = b.dataset.ref!.split(':');
    if (toolPick(kind, id)) { pickT = performance.now(); e.stopPropagation(); }
  });
  tl.addEventListener('dblclick', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.tl-item');
    // A double-click that just picked this item for the open tool should not also open its editor.
    if (!b || (state.active && performance.now() - pickT < 700)) return;
    editRef(b.dataset.ref!);
  });
  tl.addEventListener('contextmenu', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.tl-item');
    if (!b) return;
    e.preventDefault();
    openCtx(b.dataset.ref!, e.clientX, e.clientY - 10, b);
  });
  tl.addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('.tl-item');
    if (!b) return;
    if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); editRef(b.dataset.ref!); }
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); const r = b.getBoundingClientRect(); openCtx(b.dataset.ref!, r.left, r.top - 10, b); }
    else if (e.key === 'F2') { e.preventDefault(); startRename(b.dataset.ref!); }
  });

  renameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); endRename(true); }
    else if (e.key === 'Escape') { e.preventDefault(); endRename(false); }
    e.stopPropagation();
  });
  renameInput.addEventListener('blur', () => endRename(true));

  const render = (): void => { renderTree(); renderTimeline(); };
  on('doc', render);
  on('mode', render);
  // Hover also fires 'select'; only redraw the Browser when the selection itself changed.
  let selSig = '';
  on('select', () => {
    const sig = state.selection.map((s) => s.key).join('|') + '#' + (state.treeSel || '');
    if (sig !== selSig) { selSig = sig; renderTree(); }
  });
  render();
}
