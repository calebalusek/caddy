// Command bar (AutoCAD-style): type an alias or a name, fuzzy and usage-ranked suggestions. Plus the toolbar.
import { $, esc } from '../core/dom';
import { icon } from '../core/icons';
import { byId, COMMANDS, runCommand, type Command } from '../app/commands';
import { on } from '../app/hub';
import { state } from '../app/state';
import { TOOL_NAMES, toolPrompt } from '../sketch/tools';
import { message } from './message';

const GROUP_LABEL: Record<string, string> = { file: 'File', create: 'Create', modify: 'Modify', construct: 'Constraints', print: 'Print', sketch: 'Sketch', finish: 'Sketch', view: 'View' };

function score(c: Command, q: string): number {
  const a = c.alias.toLowerCase(), n = c.name.toLowerCase();
  let s = -1;
  if (a === q) s = 1200; else if (a.startsWith(q)) s = 800 - (a.length - q.length) * 10;
  if (n === q) s = Math.max(s, 1100); else if (n.startsWith(q)) s = Math.max(s, 700 - (n.length - q.length));
  else if (n.split(/[ /]/).some((w) => w.startsWith(q))) s = Math.max(s, 600);
  for (const k of c.keys) { if (k === q) s = Math.max(s, 650); else if (k.startsWith(q)) s = Math.max(s, 500 - (k.length - q.length)); }
  if (s < 0 && q.length >= 2) {
    let j = 0, gaps = 0;
    for (const ch of n) { if (ch === q[j]) j++; else if (j > 0 && j < q.length) gaps++; }
    if (j === q.length) s = 200 - gaps * 5;
  }
  if (s >= 0) {
    s += Math.min(state.usage[c.id] || 0, 10) * 15;
    if (state.mode === 'sketch' && c.ctx === 'sketch') s += 250;
    if (state.mode !== 'sketch' && c.ctx === 'sketch' && !c.starts) s -= 400;
  }
  return s;
}

let sugList: Command[] = [], sugIdx = 0;
const cmdInput = $<HTMLInputElement>('#cmdInput');
const sugsEl = $('#sugs');

export function updateSugs(): void {
  const q = cmdInput.value.trim().toLowerCase();
  if (!q) { hideSugs(); return; }
  sugList = COMMANDS.map((c) => ({ c, s: score(c, q) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).slice(0, 7).map((x) => x.c);
  sugIdx = 0;
  if (!sugList.length) { sugsEl.innerHTML = `<li class="none">No command matches “${esc(q)}”</li>`; sugsEl.classList.add('show'); return; }
  sugsEl.innerHTML = sugList
    .map((c, i) => {
      const planned = !c.run && !c.step;
      const where = c.ctx === 'sketch' && state.mode !== 'sketch' ? (c.starts ? 'Starts a sketch' : 'In a sketch') : GROUP_LABEL[c.grp];
      return `<li role="option" id="sug-${i}" data-i="${i}" aria-selected="${i === 0}" class="g-${c.grp}${planned ? ' planned' : ''}">${icon(c.icon)}<span class="s-name">${c.name}${planned ? '<small>planned</small>' : ''}</span><span class="s-group">${where}</span><kbd>${c.alias}</kbd></li>`;
    })
    .join('');
  sugsEl.classList.add('show');
  cmdInput.setAttribute('aria-activedescendant', 'sug-0');
}
function moveSug(d: number): void {
  if (!sugList.length) return;
  sugIdx = (sugIdx + d + sugList.length) % sugList.length;
  sugsEl.querySelectorAll('li[role=option]').forEach((li, i) => li.setAttribute('aria-selected', String(i === sugIdx)));
  cmdInput.setAttribute('aria-activedescendant', 'sug-' + sugIdx);
}
export function hideSugs(): void {
  sugsEl.classList.remove('show');
  sugList = [];
  cmdInput.removeAttribute('aria-activedescendant');
}

/** iPad mode has no command line: the same guidance is shown as plain text beside the tool's name. */
export function updatePrompt(): void {
  updatePromptInner();
  const g = document.getElementById('tGuide');
  if (g) g.textContent = !state.active && !state.pick && state.mode !== 'sketch' ? 'Tap a tool above' : cmdInput.placeholder;
}
function updatePromptInner(): void {
  const pr = $('#prompt');
  if (state.active) {
    pr.textContent = state.active.def.title;
    pr.className = 'prompt active';
    cmdInput.disabled = true;
    cmdInput.placeholder = state.pick ? state.pick.prompt + '. Esc to cancel.' : state.active.def.prompt + '. Enter to finish.';
    return;
  }
  cmdInput.disabled = false;
  if (state.pick) { pr.textContent = state.pick.title; pr.className = 'prompt pick'; cmdInput.placeholder = state.pick.prompt + '. Esc to cancel.'; return; }
  if (state.mode === 'sketch' && state.sketch) {
    pr.textContent = state.tool ? `${state.sketch.name}: ${TOOL_NAMES[state.tool.type]}` : state.sketch.name;
    pr.className = 'prompt sketch';
    cmdInput.placeholder = toolPrompt();
    return;
  }
  pr.textContent = 'Command';
  pr.className = 'prompt';
  cmdInput.placeholder = 'Start typing anywhere, like sk, ex or pl';
}

/** A printable key pressed anywhere starts typing a command. */
export function typeIntoCommand(key: string): void {
  cmdInput.focus();
  cmdInput.value += key;
  updateSugs();
}
export const commandInputEmpty = (): boolean => !cmdInput.value;
export const isCommandInput = (el: EventTarget | null): boolean => el === cmdInput;

// ---- toolbar ----
type Group = [label: string, color: string, ids: string[]];
const SOLID_GROUPS: Group[] = [
  ['Create', 'create', ['sketch', 'extrude', 'revolve', 'sweep', 'hole', 'text', 'thread']],
  ['Modify', 'modify', ['fillet', 'chamfer', 'shell', 'patrect', 'mirror']],
  ['Bodies', 'modify', ['transform', 'combine', 'split', 'offsetbody']],
  ['Construct', 'construct', ['plane']],
  ['Look', 'print', ['appearance', 'renderview']],
  ['Print', 'print', ['overhang', 'stl', '3mf', 'step']],
];
const SKETCH_GROUPS: Group[] = [
  ['Create', 'sketch', ['line', 'rectangle', 'circle', 'arc', 'polygon', 'slot', 'stext', 'sproject']],
  ['Modify', 'modify', ['move', 'soffset', 'trim', 'sfillet', 'schamfer', 'smirror']],
  ['Constraints', 'construct', ['dimension', 'coincident', 'midpt', 'tangent', 'hv', 'perp', 'par', 'equal', 'fix']],
];
const SHORT: Record<string, string> = { stext: 'Text', renderview: 'Render', appearance: 'Materials', midpt: 'Midpoint', sketch: 'Sketch', patrect: 'Pattern', transform: 'Move/Turn', sproject: 'Project', sfillet: 'Fillet', schamfer: 'Chamfer', smirror: 'Mirror', offsetbody: 'Offset body', split: 'Split', overhang: 'Overhangs', stl: 'STL', '3mf': '3MF', step: 'STEP', soffset: 'Offset', plane: 'Offset plane', hv: 'Horiz/Vert', perp: 'Perpendicular' };

export function renderToolbar(): void {
  const sk = state.mode === 'sketch';
  const html = (sk ? SKETCH_GROUPS : SOLID_GROUPS)
    .map(([label, g, ids]) =>
      `<div class="tgroup g-${g}" role="group" aria-label="${label}"><div class="tgroup-btns">${ids
        .map((id) => {
          const c = byId(id)!;
          const planned = !c.run && !c.step;
          const on = c.tool ? !!state.tool && state.tool.type === c.tool : !sk && !!state.active && state.active.type === id;
          const pressed = c.tool || on ? ` aria-pressed="${on}"` : '';
          return `<button class="tbtn${planned ? ' planned' : ''}" data-cmd="${id}"${pressed} title="${c.name} (${c.alias})${planned ? ', planned' : ''}">${icon(c.icon)}<span class="tname">${SHORT[id] || c.name}</span><span class="talias">${c.alias}</span></button>`;
        })
        .join('')}</div><div class="tgroup-label"><span>${label}</span></div></div>`,
    )
    .join('');
  $('#toolbar').innerHTML = `<div class="tabs"><span class="tab${sk ? '' : ' on'}">Solid</span>${sk ? '<span class="tab on sk">Sketch</span>' : ''}</div>
    <div class="tgroups">${html}</div>`;
}

export function initCommandBar(): void {
  cmdInput.addEventListener('input', updateSugs);
  cmdInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSug(1); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); moveSug(-1); return; }
    if (e.key === 'Escape') { cmdInput.value = ''; hideSugs(); cmdInput.blur(); return; }
    if (e.key === 'Tab' && sugList.length) { e.preventDefault(); cmdInput.value = sugList[sugIdx].alias.toLowerCase(); updateSugs(); return; }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!cmdInput.value.trim()) { if (state.last) runCommand(state.last); return; }
      if (sugList.length) runCommand(sugList[sugIdx].id);
      else message(`Unknown command: ${cmdInput.value.trim()}`, 'warn');
    }
  });
  cmdInput.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== cmdInput) hideSugs(); }, 120));
  sugsEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const li = (e.target as HTMLElement).closest<HTMLElement>('li[data-i]');
    if (li) runCommand(sugList[+li.dataset.i!].id);
  });
  $('#toolbar').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-cmd]');
    if (b) { b.blur(); runCommand(b.dataset.cmd!); }
  });
  on('mode', () => { if (!cmdInput.value) hideSugs(); renderToolbar(); updatePrompt(); });
  renderToolbar();
  updatePrompt();
}
