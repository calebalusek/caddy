// Top bar and viewport chrome: theme, device mode, File menu, project name, Design/Render switch, tips.
import { $, root, storage } from '../core/dom';
import { icon } from '../core/icons';
import { currentHints, detectDevice, type Device } from '../core/device';
import { getUnit, setUnitValue, type Unit } from '../core/units';
import { renderDocName, runCommand, startDocRename } from '../app/commands';
import { emit } from '../app/hub';
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

// Desktop: mouse, keyboard and the command line. iPad: bigger touch targets, an on-screen number pad, drag-to-adjust
// numbers, and a Browser panel that can be put away. Fingers and the Pencil work in both (see view/pointer.ts).
const DEVICE_SETTINGS = {
  desktop: { label: 'Desktop' },
  tablet: { label: 'iPad' },
} as const;

function initDevice(): void {
  const apply = (mode: string): void => {
    const m: Device = mode in DEVICE_SETTINGS ? (mode as Device) : 'desktop';
    state.device = m;
    emit('mode');
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
      ? 'iPad mode: bigger controls and an on-screen number pad. One finger turns the view, two fingers pan and zoom, the Pencil draws.'
      : 'Desktop mode: mouse, keyboard and command line.');
  });
  // an iPad opens in iPad mode by itself; a choice made with the switch is remembered
  apply(storage.get('caddy-device') || detectDevice(currentHints()));
  // iPad mode can put the Browser panel away to give the model the whole screen
  const bt = document.getElementById('browserToggle');
  const setBrowser = (open: boolean): void => { document.body.classList.toggle('no-browser', !open); bt?.setAttribute('aria-pressed', String(open)); storage.set('caddy-browser', open ? 'open' : 'closed'); };
  bt?.addEventListener('click', () => setBrowser(document.body.classList.contains('no-browser')));
  setBrowser(storage.get('caddy-browser') !== 'closed');
}

/** The mm / in switch at the top right. Lengths are stored in mm either way; this changes what is shown and typed. */
function initUnits(): void {
  const apply = (u: Unit, say: boolean): void => {
    setUnitValue(u);
    document.querySelectorAll<HTMLElement>('#unitSwitch button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.unit === u)));
    storage.set('caddy-units', u);
    emit('units');
    if (say) message(u === 'in' ? 'Inches: sizes are shown and typed in inches, and the grid is in inches. The model itself is unchanged.' : 'Millimeters: sizes are shown and typed in millimeters.');
  };
  $('#unitSwitch').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-unit]');
    if (b && b.dataset.unit !== getUnit()) apply(b.dataset.unit as Unit, true);
  });
  apply(storage.get('caddy-units') === 'in' ? 'in' : 'mm', false);
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
      { sep: true },
      { label: 'About and licenses', icon: 'help', act: () => { window.open('licenses.html', '_blank', 'noopener'); } },
    ], b.left, b.bottom + 4, btn);
  });
  $('#docName').addEventListener('click', startDocRename);
  renderDocName();
}

function initViewMode(): void {
  // (the Design / Render switch is handled in view/render.ts)
}

export function initChrome(): void {
  initTheme();
  initDevice();
  initUnits();
  initFileMenu();
  initViewMode();
  $('#startClose').innerHTML = icon('close');
  $('#startClose').addEventListener('click', () => $('#start').remove());
}
