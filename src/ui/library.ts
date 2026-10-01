// The project library screen: cards with a picture, edit time and feature count; rename,
// duplicate and delete (with a confirm).
import { renderDocName } from '../app/commands';
import { resetScene } from '../app/history';
import { regenerate } from '../app/regenerate';
import { newDoc, state } from '../app/state';
import { $, esc } from '../core/dom';
import { icon } from '../core/icons';
import { uniqueName } from '../files/format';
import { hideLibrary, isLibraryOpen, libraryList, newProject, openFilePicker, openProjectRecord, setLibraryRefresh, setSaveStatus, storageWorks } from '../files/project';
import { store, type ProjectRecord } from '../files/store';
import { message } from './message';
import { openMenu } from './menu';

const libEl = $('#lib'), libGrid = $('#libGrid');
let libList: ProjectRecord[] = [];

function ago(t: number): string {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} hr ago`;
  if (s < 172800) return 'yesterday';
  return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function cardHTML(r: ProjectRecord): string {
  const cur = r.id === state.doc.id, n = r.summary ? r.summary.features : 0;
  return `<div class="pcard${cur ? ' current' : ''}" data-id="${esc(r.id)}">
    <button class="pthumb" data-act="open" aria-label="Open ${esc(r.name)}">${r.thumb ? `<img src="${r.thumb}" alt="">` : icon('body')}</button>
    <div class="pmeta"><div class="pname">${esc(r.name)}${cur ? ' <span class="pcur">open</span>' : ''}</div><div class="pinfo">Edited ${ago(r.modified)} · ${n} feature${n === 1 ? '' : 's'}</div></div>
    <button class="iconbtn pmore" data-act="more" aria-label="More actions for ${esc(r.name)}" aria-haspopup="menu">${icon('more')}</button>
  </div>`;
}
async function refreshLibrary(): Promise<void> {
  libList = await libraryList();
  libGrid.innerHTML = libList.length ? libList.map(cardHTML).join('')
    : `<div class="lib-empty">${storageWorks() ? 'No saved projects yet. Start one with New project; it saves automatically as you work.' : "Browser storage is turned off here, so projects can't be kept in the library. Use Open file and Save to file instead."}</div>`;
}

async function duplicateProject(r: ProjectRecord): Promise<void> {
  const now = Date.now(), id = newDoc().id, name = uniqueName(r.name + ' copy', libList.map((x) => x.name));
  await store.put(Object.assign({}, r, { id, name, created: now, modified: now, data: Object.assign({}, r.data, { id, name }) }));
  await refreshLibrary();
  message(`Duplicated as ${name}`, 'ok');
}
async function deleteProject(r: ProjectRecord): Promise<void> {
  await store.del(r.id);
  if (r.id === state.doc.id) { resetScene(); state.doc = newDoc(); regenerate(); renderDocName(); setSaveStatus('idle'); }
  await refreshLibrary();
  message(`Deleted ${r.name}`);
}
function renameProjectCard(card: HTMLElement, r: ProjectRecord): void {
  const nm = card.querySelector('.pname')!, inp = document.createElement('input');
  inp.className = 'docinput'; inp.value = r.name; inp.setAttribute('aria-label', 'Project name');
  nm.replaceWith(inp);
  inp.focus(); inp.select();
  let done = false;
  const finish = async (save: boolean): Promise<void> => {
    if (done) return;
    done = true;
    const v = inp.value.trim().slice(0, 60);
    if (save && v && v !== r.name) {
      r.name = v; r.data = Object.assign({}, r.data, { name: v });
      await store.put(r);
      if (r.id === state.doc.id) { state.doc.name = v; renderDocName(); }
    }
    void refreshLibrary();
  };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void finish(true); } else if (e.key === 'Escape') { e.preventDefault(); void finish(false); } e.stopPropagation(); });
  inp.addEventListener('blur', () => void finish(true));
}

export function initLibrary(): void {
  setLibraryRefresh(refreshLibrary);
  libEl.addEventListener('click', (e) => {
    const t = e.target as HTMLElement, top = t.closest<HTMLElement>('[data-lib]');
    if (top) { const a = top.dataset.lib; if (a === 'new') void newProject(); else if (a === 'open') openFilePicker(); else if (a === 'close') hideLibrary(); return; }
    if (t === libEl) { hideLibrary(); return; }
    const card = t.closest<HTMLElement>('.pcard');
    if (!card) return;
    const r = libList.find((x) => x.id === card.dataset.id);
    if (!r) return;
    const btn = t.closest<HTMLElement>('[data-act]'), act = btn && btn.dataset.act;
    const openIt = (): void => { if (r.id === state.doc.id) hideLibrary(); else void openProjectRecord(r); };
    if (act === 'open') openIt();
    else if (act === 'more') {
      const b = btn!.getBoundingClientRect();
      openMenu([
        { label: 'Open', icon: 'open', act: openIt },
        { label: 'Rename', icon: 'rename', act: () => renameProjectCard(card, r) },
        { label: 'Duplicate', icon: 'copy', act: () => void duplicateProject(r) },
        { sep: true },
        { label: 'Delete…', icon: 'trash', danger: true, act: () => {
          card.classList.add('confirm');
          card.insertAdjacentHTML('beforeend', `<div class="pconfirm" role="alertdialog" aria-label="Delete ${esc(r.name)}?"><span>Delete “${esc(r.name)}”? This can’t be undone.</span><div><button class="btn" data-act="keep">Cancel</button><button class="btn danger" data-act="del">Delete</button></div></div>`);
          card.querySelector<HTMLElement>('[data-act="keep"]')!.focus();
        } },
      ], b.left, b.bottom + 4, btn);
    } else if (act === 'del') void deleteProject(r);
    else if (act === 'keep') { card.classList.remove('confirm'); const c = card.querySelector('.pconfirm'); if (c) c.remove(); }
  });
  libGrid.addEventListener('keydown', (e) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && t.closest('.pconfirm')) { e.stopPropagation(); const card = t.closest('.pcard')!; card.classList.remove('confirm'); card.querySelector('.pconfirm')!.remove(); }
  });
  // Esc closes the library (unless a delete confirm is showing)
  document.addEventListener('keydown', (e) => {
    if (!isLibraryOpen() || e.key !== 'Escape') return;
    if ((e.target as HTMLElement).closest && (e.target as HTMLElement).closest('.pcard.confirm, .docinput')) return;
    e.preventDefault(); e.stopPropagation();
    hideLibrary();
  }, true);
}
