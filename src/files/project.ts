// Projects: autosave to this browser, the library, opening and saving .caddy.json files,
// and exporting print files (STL, 3MF) and STEP.
import { renderDocName } from '../app/commands';
import { emit } from '../app/hub';
import { resetScene } from '../app/history';
import { onDirty, regenerate } from '../app/regenerate';
import { kernel, whenBuilt } from '../app/solids';
import { newDoc, state } from '../app/state';
import { $, storage } from '../core/dom';
import { featureSteps } from '../model/steps';
import { cancelDialog } from '../tools/dialog';
import { message } from '../ui/message';
import { cam, captureView, V3 } from '../view/scene';
import { animateTo, fitView, scenePoints, stopAnimation, VIEWS } from '../view/views';
import { parseProject, safeName, serializeProject, uniqueName, type ProjectFile } from './format';
import { QUALITY, stlBytes, threeMFBytes, type MeshBody, type QualityName } from './meshfiles';
import { store, type ProjectRecord } from './store';

let storageOK = true, suspendSave = false;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let savingNow: Promise<void> | null = null;
export const storageWorks = (): boolean => storageOK;

type SaveStatus = 'saved' | 'saving' | 'off' | 'error' | 'idle';
export function setSaveStatus(s: SaveStatus): void {
  const el = $('#saveState');
  const map: Record<SaveStatus, [string, string]> = { saved: ['Saved', 'ok'], saving: ['Saving…', ''], off: ['Not autosaving: use File › Save to file', 'warn'], error: ['Autosave failed', 'warn'], idle: ['', ''] };
  const [t, c] = map[s];
  el.textContent = t;
  el.className = 'savestate ' + c;
  el.dataset.state = s;
  el.title = s === 'saved' ? 'Saved in this browser. Use File › Save to file for a backup you can move to another computer.' : '';
}

export const projectFile = (): ProjectFile =>
  serializeProject(state.doc, state, { theta: cam.theta, phi: cam.phi, r: cam.r, target: [cam.target.x, cam.target.y, cam.target.z] });

/** A small picture of the model from the home view, for the library card. */
function captureThumb(): string | null {
  const pts = scenePoints(false);
  if (!pts.length) return null;
  const v = VIEWS.home, f = fitView(pts, v.theta, v.phi, 1.08);
  return captureView({ theta: v.theta, phi: v.phi, r: f.r, target: f.target }, 320, 200);
}

function markDirty(): void {
  if (suspendSave) return;
  if (!storageOK) { setSaveStatus('off'); return; }
  if (!state.features.length && !state.doc.renamed && !state.doc.stored) return; // an untouched new project is not worth a library card
  setSaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void autosave(), 700);
}

async function autosave(): Promise<void> {
  clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!storageOK) return;
  const doc = state.doc;
  const run = (async () => {
    await whenBuilt(); // the thumbnail should show the finished model
    const data = projectFile();
    let thumb: string | null = null;
    try { thumb = state.doc === doc && !state.active && state.mode !== 'sketch' ? captureThumb() : null; } catch { thumb = null; }
    const rec: ProjectRecord = { id: doc.id, name: doc.name, created: doc.created, modified: Date.now(), data, thumb: thumb || doc.thumb || null, summary: { features: data.features.length, bodies: data.bodies.length } };
    await store.put(rec);
    doc.stored = true;
    if (thumb) doc.thumb = thumb;
    storage.set('caddy-last', doc.id);
  })();
  savingNow = run;
  try {
    await run;
    if (state.doc === doc) setSaveStatus(saveTimer ? 'saving' : 'saved');
  } catch {
    setSaveStatus('error');
    message('Autosave failed. Use File › Save to file to keep a copy.', 'warn');
  } finally {
    if (savingNow === run) savingNow = null;
  }
}
/** Finish any save that is waiting, before switching projects. */
export async function flushSave(): Promise<void> {
  if (saveTimer) await autosave();
  else if (savingNow) await savingNow.catch(() => undefined);
}
export function noteDocChanged(): void { markDirty(); }

/** Replace the open document with a project file's contents. Leaves nothing behind from the old one (standing rule 7). */
function loadProjectData(d: unknown): void {
  const c = parseProject(d);
  suspendSave = true;
  try {
    resetScene();
    state.features = c.features;
    state.bodies = c.bodies;
    state.counters = c.counters;
    state.originPlanesVisible = c.originPlanesVisible;
    regenerate();
    if (c.view) { stopAnimation(); cam.theta = c.view.theta; cam.phi = c.view.phi; cam.r = c.view.r; cam.target.set(...c.view.target); }
    emit('mode', 'select', 'doc');
    const st = document.querySelector('#start');
    if (st) st.remove();
  } finally {
    suspendSave = false;
  }
}

export async function openProjectRecord(rec: ProjectRecord): Promise<boolean> {
  await flushSave();
  try { loadProjectData(rec.data); }
  catch (err) { message(`Couldn't open ${rec.name}: ${(err as Error).message}`, 'warn'); return false; }
  state.doc = { id: rec.id, name: rec.name, created: rec.created || Date.now(), stored: true, renamed: true, thumb: rec.thumb };
  renderDocName();
  setSaveStatus(storageOK ? 'saved' : 'off');
  hideLibrary();
  storage.set('caddy-last', rec.id);
  message(`Opened ${rec.name}`, 'ok');
  return true;
}

export async function newProject(): Promise<void> {
  await flushSave();
  suspendSave = true;
  try { resetScene(); regenerate(); } finally { suspendSave = false; }
  let names: string[] = [];
  if (storageOK) { try { names = (await store.all()).map((r) => r.name); } catch { /* library unavailable */ } }
  let name = 'Untitled part', i = 2;
  while (names.includes(name)) name = 'Untitled part ' + i++;
  state.doc = newDoc(name);
  renderDocName();
  setSaveStatus(storageOK ? 'idle' : 'off');
  hideLibrary();
  emit('mode', 'select', 'doc');
  animateTo({ ...VIEWS.home, target: new V3(15, 10, 8), r: 230 });
  message('New project. Type sk to start a sketch. It saves automatically as you work.');
}

// ---- opening files ----
const fileIn = $<HTMLInputElement>('#fileIn');
export function openFilePicker(): void { fileIn.value = ''; fileIn.click(); }

export async function importFile(file: { name: string; text: () => Promise<string> }): Promise<void> {
  let d: any;
  try { d = JSON.parse(await file.text()); } catch { message(`${file.name} isn't a CADDY project file`, 'warn'); return; }
  if (!d || d.format !== 'caddy') { message(`${file.name} isn't a CADDY project file`, 'warn'); return; }
  const newer = d.version > 2;
  let id: string = d.id || newDoc().id, names: string[] = [];
  if (storageOK) { try { if (await store.get(id)) id = newDoc().id; names = (await store.all()).map((r) => r.name); } catch { /* library unavailable */ } }
  const name = uniqueName(d.name || file.name.replace(/\.caddy(\.json)?$|\.json$/i, ''), names);
  const rec: ProjectRecord = { id, name, created: d.created || Date.now(), modified: Date.now(), data: Object.assign({}, d, { id, name }), thumb: null, summary: { features: (d.features || []).length, bodies: (d.bodies || []).length } };
  if (await openProjectRecord(rec)) {
    if (storageOK) { state.doc.stored = false; state.doc.renamed = true; markDirty(); }
    message(newer ? `Opened ${name}. It was saved by a newer CADDY, so some parts may be missing.` : `Opened ${name} from ${file.name}`, newer ? 'warn' : 'ok');
  }
}

// ---- writing files ----
type SaveResult = 'saved' | 'downloaded' | 'canceled' | 'failed';
/**
 * Write a file. Where the browser supports it (Chrome, Edge) this opens the real Save As window so the
 * user picks the folder; elsewhere it goes to the downloads folder. The picker must open straight from
 * the click, so the file's contents are produced after the user has chosen where it goes.
 */
async function saveBytes(filename: string, make: () => Promise<Uint8Array | string>, mime: string, accept: Record<string, string[]>, desc: string): Promise<SaveResult> {
  const pick = (window as any).showSaveFilePicker as undefined | ((o: unknown) => Promise<any>);
  if (typeof pick === 'function') {
    let handle: any = null;
    try { handle = await pick({ suggestedName: filename, types: [{ description: desc, accept }] }); }
    catch (err) { if (err && (err as Error).name === 'AbortError') return 'canceled'; handle = null; }
    if (handle) {
      try { const w = await handle.createWritable(); await w.write(await make()); await w.close(); return 'saved'; }
      catch { return 'failed'; }
    }
  }
  try {
    const data = await make();
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime })), a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return 'downloaded';
  } catch { return 'failed'; }
}
export const hasSavePicker = (): boolean => typeof (window as any).showSaveFilePicker === 'function';

export async function saveToFile(name?: string): Promise<void> {
  const filename = safeName(name || state.doc.name) + '.caddy.json';
  const r = await saveBytes(filename, async () => JSON.stringify(projectFile(), null, 1), 'application/json', { 'application/json': ['.json'] }, 'CADDY project');
  if (r === 'canceled') message('Save canceled');
  else if (r === 'failed') message("Couldn't save a file here. Your work is still autosaved in this browser.", 'warn');
  else message(r === 'saved' ? `Saved ${filename}` : `Saved ${filename} to your downloads folder. Open it later with File › Open file, or drag it onto CADDY.`, 'ok');
}

export type ExportFormat = 'stl' | '3mf' | 'step';
/** The bodies an export takes: the ones with something selected on them, else every visible body. */
export function exportBodies(): { id: string; name: string }[] {
  const picked = new Set(state.selection.flatMap((s) => (s.kind === 'face' || s.kind === 'edge' ? [s.bodyId] : [])));
  const list = state.bodies.filter((b) => (picked.size ? picked.has(b.id) : b.visible !== false));
  return list.map((b) => ({ id: b.id, name: b.name }));
}
export const exportSelectionOnly = (): boolean => state.selection.some((s) => s.kind === 'face' || s.kind === 'edge');

const meshCache = new Map<string, Promise<MeshBody[]>>();
/** Triangles of the bodies to export at a quality (asked for once per quality while the Save window is open). */
export function exportMeshes(quality: QualityName, bodies: { id: string; name: string }[]): Promise<MeshBody[]> {
  const key = quality + '|' + bodies.map((b) => b.id).join(',');
  let p = meshCache.get(key);
  if (!p) {
    p = kernel.call('exportMesh', featureSteps(state.features), QUALITY[quality], bodies.map((b) => b.id))
      .then((ms) => bodies.flatMap((b) => { const m = ms.find((x) => x.id === b.id); return m ? [{ name: b.name, positions: m.positions, indices: m.indices }] : []; }));
    meshCache.set(key, p);
  }
  return p;
}
export const clearExportCache = (): void => meshCache.clear();

export async function exportFile(fmt: ExportFormat, name: string, quality: QualityName): Promise<void> {
  if (state.mode === 'sketch') { message('Finish the sketch first, then export', 'warn'); return; }
  if (state.active) cancelDialog(true);
  const bodies = exportBodies();
  if (!bodies.length) { message('Nothing to export yet. Make a solid body first.', 'warn'); return; }
  const file = safeName(name || state.doc.name) + '.' + fmt;
  let tris = 0;
  const make = async (): Promise<Uint8Array> => {
    if (fmt === 'step') return kernel.call('exportStep', featureSteps(state.features), bodies);
    const meshes = await exportMeshes(quality, bodies);
    const out = fmt === 'stl' ? stlBytes(meshes, state.doc.name) : threeMFBytes(meshes, state.doc.name);
    tris = out.tris;
    return out.bytes;
  };
  const types: Record<ExportFormat, [string, Record<string, string[]>, string]> = {
    stl: ['model/stl', { 'model/stl': ['.stl'] }, 'STL file'],
    '3mf': ['model/3mf', { 'model/3mf': ['.3mf'] }, '3MF file'],
    step: ['application/step', { 'application/step': ['.step', '.stp'] }, 'STEP file'],
  };
  const [mime, accept, desc] = types[fmt];
  const r = await saveBytes(file, make, mime, accept, desc);
  const n = bodies.length, what = `${n} bod${n > 1 ? 'ies' : 'y'}` + (fmt === 'step' ? ', exact geometry, mm' : `, ${tris.toLocaleString()} triangles, mm`);
  if (r === 'canceled') message('Export canceled');
  else if (r === 'failed') message(`Couldn't build the ${fmt.toUpperCase()} file`, 'warn');
  else message(`Exported ${file} (${what})` + (r === 'downloaded' ? ' to your downloads folder' : ''), 'ok');
}

// ---- library ----
const libEl = $('#lib');
let libOpen = false;
export const isLibraryOpen = (): boolean => libOpen;
const libHooks: { refresh: () => Promise<void> } = { refresh: async () => undefined };
/** The library's screen lives in ui/library.ts; it registers its refresh here. */
export function setLibraryRefresh(fn: () => Promise<void>): void { libHooks.refresh = fn; }
export async function showLibrary(): Promise<void> {
  await flushSave();
  libOpen = true;
  libEl.hidden = false;
  await libHooks.refresh();
  const first = libEl.querySelector<HTMLElement>('.pthumb') || libEl.querySelector<HTMLElement>('[data-lib="new"]');
  if (first) first.focus();
}
export function hideLibrary(): void { libOpen = false; libEl.hidden = true; }
export async function libraryList(): Promise<ProjectRecord[]> {
  if (!storageOK) return [];
  try { return (await store.all()).sort((a, b) => b.modified - a.modified); }
  catch { storageOK = false; return []; }
}

export async function initProjects(): Promise<void> {
  onDirty(markDirty);
  fileIn.addEventListener('change', () => { const f = fileIn.files && fileIn.files[0]; if (f) void importFile(f); });
  document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
  document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
  document.addEventListener('drop', (e) => { document.body.classList.remove('dropping'); const f = e.dataTransfer && e.dataTransfer.files[0]; if (!f) return; e.preventDefault(); void importFile(f); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) void autosave(); });
  addEventListener('pagehide', () => { if (saveTimer) void autosave(); });
  renderDocName();
  setSaveStatus('idle');
  try {
    const list = await store.all();
    if (list.length) { await showLibrary(); message('Welcome back. Pick a project to reopen, or start a new one.'); }
  } catch { storageOK = false; setSaveStatus('off'); }
}
