// The Save window (desktop): name the file, add a version or date, pick the format, then Save.
// In Chrome and Edge, Save opens the system's Save As window so the user picks the folder.
import { state } from '../app/state';
import { esc, storage } from '../core/dom';
import { icon } from '../core/icons';
import { addDate, bumpVersion } from '../files/format';
import type { QualityName } from '../files/meshfiles';
import { clearExportCache, exportBodies, exportFile, exportMeshes, exportSelectionOnly, hasSavePicker, saveToFile, type ExportFormat } from '../files/project';
import { message } from './message';

const QUALITY_KEY = 'caddy-export-quality';
const QUALITIES: QualityName[] = ['Draft', 'Standard', 'Fine'];

export function openSaveWindow(kind: 'project' | 'export', fmt?: ExportFormat): void {
  if (state.mode === 'sketch' && kind === 'export') { message('Finish the sketch first, then export', 'warn'); return; }
  const bodies = kind === 'export' ? exportBodies() : [];
  if (kind === 'export' && !bodies.length) { message('Nothing to export yet. Make a solid body first.', 'warn'); return; }
  document.querySelector('.savemodal')?.remove();
  clearExportCache();
  const last = (state.doc.saveNames || {})[kind] || state.doc.name || 'Untitled part';
  const savedQ = storage.get(QUALITY_KEY) as QualityName | null, quality0: QualityName = savedQ && QUALITIES.includes(savedQ) ? savedQ : 'Fine';
  const wrap = document.createElement('div');
  wrap.className = 'savemodal';
  const radio = (name: string, value: string, label: string, on: boolean): string => `<label><input type="radio" name="${name}" value="${value}"${on ? ' checked' : ''}><span>${label}</span></label>`;
  wrap.innerHTML = `<div class="sm-card" role="dialog" aria-modal="true" aria-labelledby="smTitle">
    <div class="sm-head"><span class="sm-ic">${icon(kind === 'export' ? 'export' : 'save')}</span><h2 id="smTitle">${kind === 'export' ? 'Export for printing' : 'Save project'}</h2><button class="iconbtn" data-sm="cancel" aria-label="Close">${icon('close')}</button></div>
    <label class="flabel" for="smName">File name</label>
    <div class="sm-name"><input id="smName" type="text" spellcheck="false" autocomplete="off" value="${esc(last)}"><span class="sm-ext" id="smExt"></span></div>
    <div class="sm-quick"><button type="button" class="btn" data-sm="ver" title="Add or bump a version number">+ Version</button><button type="button" class="btn" data-sm="date" title="Add today's date">+ Date</button></div>
    ${kind === 'export' ? `<span class="flabel">Format</span><div class="seg-row sm-seg" role="radiogroup" aria-label="Format">
      ${radio('smFmt', 'stl', 'STL', fmt !== '3mf' && fmt !== 'step')}${radio('smFmt', '3mf', '3MF', fmt === '3mf')}${radio('smFmt', 'step', 'STEP', fmt === 'step')}</div>
      <div id="smQualityRow"><span class="flabel">Smoothness of curved faces</span><div class="seg-row sm-seg" role="radiogroup" aria-label="Smoothness">
      ${QUALITIES.map((q) => radio('smQ', q, q, q === quality0)).join('')}</div></div>` : ''}
    <div class="sm-info" id="smInfo"></div>
    <div class="sm-dest" id="smDest"></div>
    <div class="sm-foot"><button class="btn" data-sm="cancel">Cancel</button><button class="btn primary" data-sm="save" id="smSave">Save</button></div>
  </div>`;
  document.body.appendChild(wrap);
  const q = <T extends HTMLElement>(s: string): T => wrap.querySelector<T>(s)!;
  const inp = q<HTMLInputElement>('#smName'), ext = q('#smExt'), info = q('#smInfo'), dest = q('#smDest'), saveBtn = q<HTMLButtonElement>('#smSave');
  const picker = hasSavePicker();
  const curFmt = (): ExportFormat | 'json' => (kind === 'export' ? ((wrap.querySelector<HTMLInputElement>('input[name="smFmt"]:checked') || { value: 'stl' }).value as ExportFormat) : 'json');
  const curQ = (): QualityName => ((wrap.querySelector<HTMLInputElement>('input[name="smQ"]:checked') || { value: quality0 }).value as QualityName);
  let alive = true;

  const refresh = (): void => {
    const f = curFmt();
    ext.textContent = f === 'json' ? '.caddy.json' : '.' + f;
    const n = bodies.length, base = `${n} bod${n > 1 ? 'ies' : 'y'}`, tail = ' · millimeters' + (exportSelectionOnly() ? ' · selected bodies only' : '');
    if (kind !== 'export') info.textContent = `${state.features.length} feature${state.features.length === 1 ? '' : 's'} · reopen it later with File › Open file`;
    else if (f === 'step') info.textContent = `${base} · exact geometry for other CAD programs` + tail;
    else {
      // the triangle count depends on the smoothness; it arrives from the geometry engine
      const want = curQ();
      info.textContent = `${base} · counting triangles…` + tail;
      void exportMeshes(want, bodies).then((ms) => {
        if (!alive || curFmt() === 'step' || curQ() !== want) return;
        const tris = ms.reduce((s, m) => s + m.indices.length / 3, 0);
        info.textContent = `${base} · ${tris.toLocaleString()} triangles` + tail + (curFmt() === '3mf' ? ' · each body kept as its own part' : '');
      });
    }
    const qr = wrap.querySelector<HTMLElement>('#smQualityRow');
    if (qr) qr.style.display = f === 'step' ? 'none' : '';
    dest.innerHTML = picker ? `${icon('folder')}<span>You'll choose the folder next.</span>`
      : `${icon('folder')}<span>Saves to your browser's download folder. To pick a folder every time, turn on <b>Ask where to save each file</b> in your browser's settings.</span>`;
    const ok = inp.value.trim().length > 0;
    saveBtn.disabled = !ok;
    inp.classList.toggle('invalid', !ok);
  };
  const close = (): void => { alive = false; wrap.remove(); document.removeEventListener('keydown', onKey, true); };
  const doSave = (): void => {
    const nm = inp.value.trim();
    if (!nm) { inp.focus(); return; }
    const f = curFmt(), ql = curQ();
    state.doc.saveNames = Object.assign({}, state.doc.saveNames, { [kind]: nm });
    if (kind === 'export') storage.set(QUALITY_KEY, ql);
    close();
    if (f === 'json') void saveToFile(nm); else void exportFile(f, nm, ql);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); message('Save canceled'); }
    else if (e.key === 'Enter' && document.activeElement && wrap.contains(document.activeElement) && !(e.target as HTMLElement).closest('button')) { e.preventDefault(); e.stopPropagation(); doSave(); }
    else if (wrap.contains(e.target as Node)) e.stopPropagation(); // typing a name must not start a command
  };
  document.addEventListener('keydown', onKey, true);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) { close(); message('Save canceled'); } });
  wrap.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sm]');
    if (!b) return;
    const a = b.dataset.sm;
    if (a === 'cancel') { close(); message('Save canceled'); }
    else if (a === 'save') doSave();
    else if (a === 'ver') { inp.value = bumpVersion(inp.value.trim() || 'Untitled part'); refresh(); inp.focus(); }
    else if (a === 'date') { inp.value = addDate(inp.value.trim() || 'Untitled part'); refresh(); inp.focus(); }
  });
  wrap.addEventListener('change', refresh);
  inp.addEventListener('input', refresh);
  refresh();
  inp.focus();
  inp.select();
}
