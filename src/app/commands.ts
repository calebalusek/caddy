// Every command: name, alias, where it applies, toolbar group, icon and search keywords.
// The table is carried over from the prototype. `run` is filled in as each tool is rebuilt;
// `step` says which rebuild step brings it back; neither = a placeholder the prototype never had.
import { $ } from '../core/dom';
import { emit } from './hub';
import { toggleVis, undo } from './history';
import { newProject, noteDocChanged, openFilePicker, showLibrary } from '../files/project';
import { openSaveWindow } from '../ui/savewindow';
import { saveUsage, state } from './state';
import { finishSketch, lookAtSketch, startSketchPick } from '../sketch/session';
import { setTool } from '../sketch/tools';
import { openDialog } from '../tools/dialog';
import { endPick } from '../tools/pick';
import { message } from '../ui/message';
import { applyGridVisibility } from '../view/scene';
import { goHome, setView, zoomFit } from '../view/views';

export interface Command {
  id: string;
  name: string;
  alias: string;
  ctx: 'solid' | 'sketch' | 'any';
  grp: string;
  icon: string;
  keys: string[];
  run?: () => void;
  step?: number;
  /** Sketch tool id, and whether running it outside a sketch starts one. */
  tool?: string;
  starts?: boolean;
}

const C = (id: string, name: string, alias: string, ctx: Command['ctx'], grp: string, icon: string, keys: string[], run?: (() => void) | number, extra?: Partial<Command>): Command =>
  Object.assign({ id, name, alias, ctx, grp, icon, keys }, typeof run === 'function' ? { run } : typeof run === 'number' ? { step: run } : {}, extra || {});

export function startDocRename(): void {
  const b = $('#docName');
  if (!b.isConnected) return;
  const inp = document.createElement('input');
  inp.className = 'docinput';
  inp.value = state.doc.name;
  inp.setAttribute('aria-label', 'Project name');
  b.replaceWith(inp);
  inp.focus();
  inp.select();
  let done = false;
  const finish = (save: boolean): void => {
    if (done) return;
    done = true;
    const v = inp.value.trim();
    if (save && v && v !== state.doc.name) { state.doc.name = v.slice(0, 60); state.doc.renamed = true; noteDocChanged(); message(`Project renamed to ${state.doc.name}`, 'ok'); }
    inp.replaceWith(b);
    renderDocName();
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  inp.addEventListener('blur', () => finish(true));
}
export function renderDocName(): void {
  const b = $('#docName');
  b.textContent = state.doc.name;
  b.title = 'Rename project';
  document.title = state.doc.name + ' · CADDY';
}

export const COMMANDS: Command[] = [
  C('sketch', 'Create sketch', 'SK', 'solid', 'create', 'sketch', ['sketch', 'new sketch', 'draw'], () => startSketchPick(null)),
  C('extrude', 'Extrude', 'EX', 'solid', 'create', 'extrude', ['extrude', 'ext', 'pull', 'push', 'boss', 'pad', 'cut', 'pocket'], () => openDialog('extrude')),
  C('revolve', 'Revolve', 'REV', 'solid', 'create', 'revolve', ['revolve', 'lathe', 'spin', 'turn'], () => openDialog('revolve')),
  C('sweep', 'Sweep', 'SW', 'solid', 'create', 'sweep', ['sweep', 'pipe', 'tube', 'follow path', 'rail'], () => openDialog('sweep')),
  C('hole', 'Hole', 'HO', 'solid', 'create', 'hole', ['hole', 'bore', 'drill', 'counterbore', 'countersink'], () => openDialog('hole')),
  C('thread', 'Thread', 'TH', 'solid', 'create', 'thread', ['thread', 'screw', 'bolt', 'nut']),
  C('fillet', 'Fillet', 'F', 'solid', 'modify', 'fillet', ['fillet', 'round', 'radius', 'round edge'], () => openDialog('fillet')),
  C('chamfer', 'Chamfer', 'CHA', 'solid', 'modify', 'chamfer', ['chamfer', 'bevel', 'break edge'], () => openDialog('chamfer')),
  C('shell', 'Shell', 'SH', 'solid', 'modify', 'shell', ['shell', 'hollow'], 7),
  C('patrect', 'Rectangular pattern', 'PTR', 'solid', 'modify', 'pattern', ['pattern', 'array', 'grid'], 7),
  C('patcirc', 'Circular pattern', 'PTC', 'solid', 'modify', 'pattern', ['pattern', 'polar array', 'circular', 'bolt circle'], 7),
  C('mirror', 'Mirror', 'MI', 'solid', 'modify', 'mirror', ['mirror', 'flip', 'symmetry']),
  C('plane', 'Offset plane', 'PL', 'solid', 'construct', 'plane', ['plane', 'construction plane', 'work plane', 'offset plane', 'datum'], () => openDialog('plane')),
  C('overhang', 'Overhang check', 'OV', 'solid', 'print', 'overhang', ['overhang', 'support', 'printability']),
  C('stl', 'Export STL', 'STL', 'solid', 'print', 'export', ['export', 'stl', 'save mesh', 'print file'], () => openSaveWindow('export', 'stl')),
  C('3mf', 'Export 3MF', '3MF', 'solid', 'print', 'export', ['export', '3mf', 'slicer', 'print file'], () => openSaveWindow('export', '3mf')),
  C('step', 'Export STEP', 'STEP', 'solid', 'print', 'export', ['export', 'step', 'stp', 'cad file', 'exact'], () => openSaveWindow('export', 'step')),
  C('line', 'Line', 'L', 'sketch', 'sketch', 'line', ['line', 'polyline'], () => setTool('line'), { tool: 'line', starts: true }),
  C('rectangle', 'Rectangle', 'REC', 'sketch', 'sketch', 'rect', ['rectangle', 'box', 'square'], () => setTool('rect'), { tool: 'rect', starts: true }),
  C('circle', 'Circle', 'C', 'sketch', 'sketch', 'circle', ['circle'], () => setTool('circle'), { tool: 'circle', starts: true }),
  C('stext', 'Text', 'TE', 'sketch', 'sketch', 'text', ['text', 'emboss', 'engrave', 'label']),
  C('arc', 'Arc', 'A', 'sketch', 'sketch', 'arc', ['arc', 'curve', '3 point arc'], () => setTool('arc'), { tool: 'arc', starts: true }),
  C('polygon', 'Polygon', 'POL', 'sketch', 'sketch', 'polygon', ['polygon', 'hexagon', 'octagon', 'nut'], () => setTool('polygon'), { tool: 'polygon', starts: true }),
  C('trim', 'Trim', 'TR', 'sketch', 'modify', 'trim', ['trim', 'cut back', 'delete segment'], () => setTool('trim'), { tool: 'trim' }),
  C('soffset', 'Offset', 'OF', 'sketch', 'modify', 'soffset', ['offset', 'offset curve', 'parallel copy'], () => setTool('offset'), { tool: 'offset' }),
  C('move', 'Move', 'M', 'sketch', 'modify', 'move', ['move', 'translate', 'displace', 'relocate'], () => setTool('move'), { tool: 'move' }),
  C('dimension', 'Dimension', 'D', 'sketch', 'construct', 'dimension', ['dimension', 'dim', 'size', 'measure'], () => setTool('dim'), { tool: 'dim' }),
  C('coincident', 'Coincident', 'CO', 'sketch', 'construct', 'coincident', ['coincident', 'join points', 'connect', 'merge'], () => setTool('coincident'), { tool: 'coincident' }),
  C('tangent', 'Tangent', 'TA', 'sketch', 'construct', 'tangent', ['tangent', 'tangency'], () => setTool('tangent'), { tool: 'tangent' }),
  C('midpt', 'Midpoint', 'MP', 'sketch', 'construct', 'midpoint', ['midpoint', 'middle', 'center on line'], () => setTool('midpt'), { tool: 'midpt' }),
  C('hv', 'Horizontal/Vertical', 'HV', 'sketch', 'construct', 'hv', ['horizontal', 'vertical', 'level', 'plumb'], () => setTool('hv'), { tool: 'hv' }),
  C('perp', 'Perpendicular', 'PE', 'sketch', 'construct', 'perp', ['perpendicular', 'square', '90'], () => setTool('perp'), { tool: 'perp' }),
  C('par', 'Parallel', 'PA', 'sketch', 'construct', 'par', ['parallel'], () => setTool('par'), { tool: 'par' }),
  C('equal', 'Equal', 'EQ', 'sketch', 'construct', 'equal', ['equal', 'same size', 'match'], () => setTool('equal'), { tool: 'equal' }),
  C('fix', 'Fix', 'FIX', 'sketch', 'construct', 'fix', ['fix', 'lock', 'anchor', 'ground', 'unfix'], () => setTool('fix'), { tool: 'fix' }),
  C('finish', 'Finish sketch', 'FS', 'sketch', 'finish', 'finish', ['finish', 'finish sketch', 'done', 'exit sketch'], () => finishSketch()),
  C('lookat', 'Look at sketch', 'LA', 'sketch', 'view', 'look', ['look at', 'normal view'], () => lookAtSketch()),
  C('home', 'Home view', 'HOME', 'any', 'view', 'view', ['home', 'iso', 'isometric', 'reset view'], () => goHome()),
  C('bottom', 'Bottom view', 'BO', 'any', 'view', 'view', ['bottom', 'underside'], () => setView('bottom')),
  C('back', 'Back view', 'BA', 'any', 'view', 'view', ['back', 'rear'], () => setView('back')),
  C('left', 'Left view', 'LE', 'any', 'view', 'view', ['left'], () => setView('left')),
  C('top', 'Top view', 'TOP', 'any', 'view', 'view', ['top', 'plan view'], () => setView('top')),
  C('front', 'Front view', 'FR', 'any', 'view', 'view', ['front', 'elevation'], () => setView('front')),
  C('right', 'Right view', 'RI', 'any', 'view', 'view', ['right', 'side view'], () => setView('right')),
  C('fit', 'Zoom to fit', 'ZE', 'any', 'view', 'view', ['zoom extents', 'fit', 'zoom all'], () => zoomFit()),
  C('appearance', 'Appearance', 'AP', 'solid', 'print', 'appearance', ['appearance', 'material', 'materials', 'color', 'colour', 'paint', 'finish', 'texture', 'wood', 'metal'], 8),
  C('renderview', 'Render view', 'RV', 'any', 'view', 'render', ['render', 'render view', 'realistic', 'photo', 'shaded'], 8),
  C('designview', 'Design view', 'DV', 'any', 'view', 'view', ['design view', 'matte', 'modeling view'], () => message('Design view')),
  C('grid', 'Toggle grid', 'GR', 'any', 'view', 'grid', ['grid'], () => { state.gridOn = !state.gridOn; applyGridVisibility(); message(state.gridOn ? 'Grid shown' : 'Grid hidden'); }),
  C('origin', 'Toggle origin planes', 'ORI', 'any', 'view', 'origin', ['origin', 'origin planes'], () => toggleVis('origin')),
  C('undo', 'Undo', 'U', 'any', 'view', 'undo', ['undo', 'back'], () => undo()),
  C('save', 'Save to file', 'SAVE', 'any', 'file', 'save', ['save', 'save file', 'export project', 'backup', 'download'], () => openSaveWindow('project')),
  C('openfile', 'Open file', 'OPEN', 'any', 'file', 'open', ['open', 'open file', 'load', 'import'], () => openFilePicker()),
  C('projects', 'Projects', 'PROJ', 'any', 'file', 'folder', ['projects', 'library', 'recent', 'files', 'home screen'], () => void showLibrary()),
  C('newproject', 'New project', 'NEW', 'any', 'file', 'plus', ['new', 'new project', 'new part', 'new file'], () => void newProject()),
  C('renameproject', 'Rename project', 'RENP', 'any', 'file', 'rename', ['rename project', 'project name'], () => startDocRename()),
];

export const byId = (id: string): Command | undefined => COMMANDS.find((c) => c.id === id);

/** Why a command does nothing yet. Every button explains itself (standing rule 8). */
export const notReadyText = (c: Command): string =>
  c.step ? `${c.name} arrives in step ${c.step} of the rebuild. It works in the prototype today.` : `${c.name} isn't built yet. It's on the list.`;

export function runCommand(id: string): void {
  const c = byId(id);
  if (!c) return;
  state.usage[id] = (state.usage[id] || 0) + 1;
  saveUsage();
  const input = $<HTMLInputElement>('#cmdInput');
  input.value = '';
  emit('mode'); // hides suggestions, refreshes the prompt
  if (!c.run) { message(notReadyText(c)); return; }
  if (document.activeElement === input) input.blur();
  if (c.ctx === 'sketch' && state.mode !== 'sketch') {
    // a draw command typed outside a sketch starts one, then the tool
    if (c.starts) { state.last = id; startSketchPick(c.tool); return; }
    message(`${c.name} works inside a sketch. Type sk to start one, or double-click a sketch to edit it.`);
    return;
  }
  if (state.pick && !state.active && c.ctx !== 'any') endPick();
  state.last = id;
  c.run();
}
