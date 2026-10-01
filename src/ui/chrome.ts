// Top bar and viewport chrome: theme, device mode, File menu, project name, Design/Render switch, tips.
import { $, root, storage } from '../core/dom';
import { icon } from '../core/icons';
import { byId, notReadyText, renderDocName, runCommand, startDocRename } from '../app/commands';
import { emit, on } from '../app/hub';
import { state } from '../app/state';
import { message } from './message';
import { openMenu } from './menu';

export const isDark = (): boolean => {
  const t = root.getAttribute('data-theme');
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};

function initTheme(): void {
  const saved = storage.get('caddy-theme');
  if (saved) root.setAttribute('data-theme', saved);
  const btn = $('#themeBtn');
  const apply = (): void => { btn.innerHTML = icon(isDark() ? 'sun' : 'moon'); emit('theme'); };
  btn.addEventListener('click', () => {
    root.setAttribute('data-theme', isDark() ? 'light' : 'dark');
    storage.set('caddy-theme', root.getAttribute('data-theme')!);
    apply();
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', apply);
  apply();
}

// Placeholder: each mode gets its own settings. The tablet values are where iPad behavior plugs in
// once the desktop version is final.
const DEVICE_SETTINGS = {
  desktop: { label: 'Desktop', touchTargets: 32, gestures: false, pencilSketching: false, commandLine: true },
  tablet: { label: 'iPad', touchTargets: 44, gestures: true, pencilSketching: true, commandLine: 'on-demand' },
} as const;
type Device = keyof typeof DEVICE_SETTINGS;

function initDevice(): void {
  const apply = (mode: string): void => {
    const m: Device = mode in DEVICE_SETTINGS ? (mode as Device) : 'desktop';
    state.device = m;
    root.setAttribute('data-device', m);
    document.querySelectorAll<HTMLElement>('#devSwitch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.device === m)));
    storage.set('caddy-device', m);
  };
  document.querySelectorAll<HTMLElement>('#devSwitch button').forEach((b) => { b.innerHTML = icon(b.dataset.device!) + `<span>${DEVICE_SETTINGS[b.dataset.device as Device].label}</span>`; });
  $('#devSwitch').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-device]');
    if (!b) return;
    apply(b.dataset.device!);
    message(b.dataset.device === 'tablet'
      ? 'iPad mode is a placeholder for now. Touch gestures, larger controls and Apple Pencil sketching will be added once the desktop version is finished.'
      : 'Desktop mode: mouse, keyboard and command line.');
  });
  apply(storage.get('caddy-device') || 'desktop');
}

function initFileMenu(): void {
  $('#fileBtn').addEventListener('click', (e) => {
    const btn = e.currentTarget as HTMLElement, b = btn.getBoundingClientRect();
    const cmd = (id: string) => () => runCommand(id);
    openMenu([
      { label: 'New project', icon: 'plus', act: cmd('newproject') },
      { label: 'Projects…', icon: 'folder', act: cmd('projects') },
      { sep: true },
      { label: 'Open file…  Ctrl+O', icon: 'open', act: cmd('openfile') },
      { label: 'Save to file…  Ctrl+S', icon: 'save', act: cmd('save') },
      { sep: true },
      { label: 'Export STL…', icon: 'export', act: cmd('stl') },
      { label: 'Export 3MF…', icon: 'export', act: cmd('3mf') },
      { label: 'Export STEP…', icon: 'export', act: cmd('step') },
      { sep: true },
      { label: 'Rename project', icon: 'rename', act: startDocRename },
    ], b.left, b.bottom + 4, btn);
  });
  $('#docName').addEventListener('click', startDocRename);
  renderDocName();
}

function initViewMode(): void {
  $('#rmode').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-m]');
    if (!b) return;
    if (b.dataset.m === 'render') message(notReadyText(byId('renderview')!));
    else message('Design view');
  });
  // the sketch bar takes this spot while sketching
  on('mode', () => { $('#rmode').hidden = state.mode === 'sketch'; });
}

export function initChrome(): void {
  initTheme();
  initDevice();
  initFileMenu();
  initViewMode();
  $('#startClose').innerHTML = icon('close');
  $('#startClose').addEventListener('click', () => $('#start').remove());
}
