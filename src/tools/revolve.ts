// Revolve (REV): spin a sketch region around an axis (a sketch line, an origin axis or a straight
// body edge). The result previews live on the model.
import * as THREE from 'three';
import { emit } from '../app/hub';
import { markDirty } from '../app/regenerate';
import { baseBodies, findProfile, whenBuilt } from '../app/solids';
import { bodyById, feats, state, type ProfileSel } from '../app/state';
import { fmt } from '../core/format';
import type { BuildStep, Operation } from '../kernel/protocol';
import { profileSpec } from '../kernel/spec';
import { toWorld, vadd, vcross, vdot, vnorm, vsc, vsub } from '../model/frames';
import { axisWorld, type AxisRef } from '../model/steps';
import type { OtherFeature, Vec3 } from '../model/types';
import { PT } from '../sketch/model';
import { refreshProfiles, sketchGroupVisible, toScreen } from '../sketch/visuals';
import { message } from '../ui/message';
import { insideAnyBody, setBoldSegments, setHoverEdge, visibleBodies } from '../view/bodies';
import { edgeAtCursor, profileAtCursor } from '../view/hit';
import { v3 } from '../view/planes';
import { focusPrimary, registerTool, setChoice, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';
import { autoProfile } from './extrude';
import { mouse } from './pick';

interface RevolveParams {
  sketchId: string | null;
  key: string | null;
  hint?: { pts: [number, number][]; area: number };
  axis: AxisRef | null;
  angle: number;
  direction: 'One side' | 'Symmetric';
  operation: Operation;
  opAuto: boolean;
}
type Dlg = ActiveDialog<RevolveParams> & { toolBox?: THREE.Box3 };

const bodyName = (id: string): string => { const b = bodyById(id); return b ? b.name : 'a body'; };
const axisOf = (P: RevolveParams): ReturnType<typeof axisWorld> => axisWorld(state.features, bodyName, P.axis);

/** The axis a click would pick: a sketch line, an origin axis or a straight body edge near the cursor. */
function axisAtCursor(): { ref: AxisRef; segs: [Vec3, Vec3][] } | null {
  let best: { ref: AxisRef; segs: [Vec3, Vec3][] } | null = null, bd = 9;
  const segD = (a: Vec3, b: Vec3): number => {
    const pa = toScreen(v3(a)), pb = toScreen(v3(b));
    if (pa.behind || pb.behind) return Infinity;
    const dx = pb.x - pa.x, dy = pb.y - pa.y, L2 = dx * dx + dy * dy;
    let t = L2 ? ((mouse.x - pa.x) * dx + (mouse.y - pa.y) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(mouse.x - pa.x - dx * t, mouse.y - pa.y - dy * t);
  };
  feats('sketch').forEach((s) => {
    if (!s.frame || !sketchGroupVisible(s)) return;
    s.curves.forEach((c) => {
      if (c.type !== 'line') return;
      const a = toWorld(s.frame!, ...PT(s, c.p1)), b = toWorld(s.frame!, ...PT(s, c.p2)), d = segD(a, b);
      if (d < bd) { bd = d; best = { ref: { kind: 'line', sketchId: s.id, lineId: c.id }, segs: [[a, b]] }; }
    });
  });
  ([['X', [1, 0, 0]], ['Y', [0, 1, 0]], ['Z', [0, 0, 1]]] as ['X' | 'Y' | 'Z', Vec3][]).forEach(([id, dv]) => {
    const a = vsc(dv, id === 'Z' ? 0 : -150), b = vsc(dv, id === 'Z' ? 70 : 150), d = segD(a, b);
    if (d < bd) { bd = d; best = { ref: { kind: 'origin', id }, segs: [[a, b]] }; }
  });
  const eh = edgeAtCursor(baseBodies());
  if (eh && eh.edge.kind === 'line' && (!best || bd > 2)) best = { ref: { kind: 'edge', bodyId: eh.bodyId, a: eh.edge.a, b: eh.edge.b }, segs: eh.segs };
  return best;
}

/** Bold blue line along the chosen axis. */
function drawAxis(A: Dlg): void {
  const w = axisOf(A.params);
  setBoldSegments(w ? [[vadd(w.A, vsc(w.d, -60)), vadd(w.A, vsc(w.d, 60))]] : []);
}

/** Join, Cut or New body, from where the revolved shape lands. */
function autoOperation(A: Dlg): Operation {
  const P = A.params, r = findProfile(P), ax = axisOf(P), bodies = visibleBodies();
  A.toolBox = undefined;
  if (!r || !ax || !bodies.length) return 'New body';
  const fr = r.sk.frame!, e0 = vnorm(vcross(fr.n, ax.d));
  let side = 0, rmax = 0, z0 = Infinity, z1 = -Infinity;
  r.pr.loop.poly.forEach(([x, y]) => {
    const q = vsub(toWorld(fr, x, y), ax.A), s = vdot(q, e0), z = vdot(q, ax.d);
    if (!side && Math.abs(s) > 1e-6) side = Math.sign(s);
    rmax = Math.max(rmax, Math.abs(s)); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
  });
  const e = vsc(e0, side || 1), f = vcross(ax.d, e), box = new THREE.Box3();
  for (let i = 0; i < 16; i++) { const t = (i * Math.PI) / 8, rad = vadd(vsc(e, rmax * Math.cos(t)), vsc(f, rmax * Math.sin(t))); [z0, z1].forEach((z) => box.expandByPoint(v3(vadd(vadd(ax.A, vsc(ax.d, z)), rad)))); }
  A.toolBox = box.expandByScalar(1e-3);
  // a point inside the revolved shape, halfway around the sweep
  const ang = (Math.min(360, Math.abs(P.angle || 0)) * Math.PI) / 180, a0 = P.direction === 'Symmetric' ? -ang / 2 : P.angle < 0 ? -ang : 0, tm = a0 + ang / 2;
  const q = vsub(toWorld(fr, r.pr.inner![0], r.pr.inner![1]), ax.A), rr = Math.abs(vdot(q, e0));
  const probe = vadd(vadd(ax.A, vsc(ax.d, vdot(q, ax.d))), vadd(vsc(e, rr * Math.cos(tm)), vsc(f, rr * Math.sin(tm))));
  if (insideAnyBody(v3(probe))) return 'Cut';
  return bodies.some((b) => b.box.intersectsBox(box)) ? 'Join' : 'New body';
}

/** Which body a Join goes to: the one the shape touches, else the newest. */
function joinBody(A: Dlg): string | null {
  if (!state.bodies.length) return null;
  const hit = A.toolBox ? visibleBodies().find((b) => b.box.intersectsBox(A.toolBox!)) : null;
  return (hit && bodyById(hit.id) ? hit.id : null) || state.bodies[state.bodies.length - 1].id;
}

function setProfile(A: Dlg, sel: ProfileSel): void {
  const P = A.params;
  delete P.hint;
  P.sketchId = sel.sketchId; P.key = sel.key;
  // a construction line in that sketch is the natural axis
  if (!P.axis) { const sk = feats('sketch').find((s) => s.id === sel.sketchId), cl = sk && sk.curves.find((c) => c.type === 'line' && c.construction); if (sk && cl) P.axis = { kind: 'line', sketchId: sk.id, lineId: cl.id }; }
}

registerTool<RevolveParams>({
  type: 'revolve',
  title: 'Revolve',
  icon: 'revolve',
  gc: 'g-create',
  prompt: 'Pick a profile and an axis, then set the angle',
  fields: [
    { key: 'profile', kind: 'chip', label: 'Profile', chipId: 'selChip' },
    { key: 'axis', kind: 'chip', label: 'Axis', chipId: 'axisChip' },
    { key: 'angle', kind: 'length', label: 'Angle', unit: '°', primary: true },
    { key: 'direction', kind: 'choice', label: 'Direction', options: ['One side', 'Symmetric'] },
    { key: 'operation', kind: 'choice', label: 'Operation', options: ['Join', 'Cut', 'New body'], lockOnEdit: true, hintId: 'opHint' },
  ],
  defaults: () => {
    const p = autoProfile(), sk = p ? feats('sketch').find((s) => s.id === p.sketchId) : null;
    const cl = sk && sk.curves.find((c) => c.type === 'line' && c.construction);
    const se = state.selection.find((s) => s.kind === 'edge');
    const edge = se && se.kind === 'edge' ? baseBodies().find((b) => b.id === se.bodyId)?.edges.find((e) => e.id === se.edgeId && e.kind === 'line') : null;
    const axis: AxisRef | null = edge && se && se.kind === 'edge' ? { kind: 'edge', bodyId: se.bodyId, a: edge.a, b: edge.b } : sk && cl ? { kind: 'line', sketchId: sk.id, lineId: cl.id } : null;
    // a full turn is the natural starting angle
    return { sketchId: p ? p.sketchId : null, key: p ? p.key : null, axis, angle: 360, direction: 'One side', operation: 'New body', opAuto: true };
  },
  chips: (A) => {
    const r = findProfile(A.params), w = axisOf(A.params);
    return {
      selChip: { set: !!r, text: r ? 'Profile in ' + r.sk.name : 'Click a sketch profile' },
      axisChip: { set: !!w, text: w ? w.name[0].toUpperCase() + w.name.slice(1) : 'Click a sketch line, origin axis or body edge' },
    };
  },
  draftStep: (A: Dlg): BuildStep | null => {
    const P = A.params, r = findProfile(P), ax = axisOf(P), ang = Math.abs(P.angle || 0);
    if (!r || !ax || ang < 0.01) return null;
    const bodyId = A.edit ? (A.edit as OtherFeature).bodyId || null : P.operation === 'Join' ? joinBody(A) || 'draft-body' : P.operation === 'New body' ? 'draft-body' : null;
    return { kind: 'revolve', id: A.edit ? A.edit.id : 'draft', profile: profileSpec(r.sk.frame!, r.pr), axis: { A: ax.A, d: ax.d }, ang0: P.direction === 'Symmetric' ? -ang / 2 : P.angle < 0 ? -ang : 0, angle: ang, operation: P.operation, bodyId };
  },
  preview: (A: Dlg) => {
    const P = A.params, r = findProfile(P), ax = axisOf(P);
    refreshProfiles();
    drawAxis(A);
    if (P.opAuto && !A.edit) { P.operation = autoOperation(A); setChoice('operation', P.operation); } else autoOperation(A);
    setHint('opHint', P.opAuto ? 'Picked automatically' : '');
    return { ok: !!r && !!ax };
  },
  onBuilt: (A: Dlg) => {
    drawAxis(A);
    setHint('opHint', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : A.params.opAuto ? 'Picked automatically' : '');
  },
  hover: () => {
    const ax = axisAtCursor();
    if (ax) { if (state.hovered) { state.hovered = null; refreshProfiles(); } setHoverEdge(ax.segs, 'ax' + JSON.stringify(ax.ref)); return true; }
    setHoverEdge(null);
    const ph = profileAtCursor(), h = ph ? ph.sel : null;
    if ((h && h.sketchId + h.key) !== (state.hovered && state.hovered.sketchId + state.hovered.key)) { state.hovered = h; refreshProfiles(); }
    return !!h;
  },
  click: (A: Dlg) => {
    const P = A.params, ax = axisAtCursor(), ph = profileAtCursor();
    if (ax) { P.axis = ax.ref; const w = axisOf(P); message(`Axis set: ${w ? w.name : 'axis'}`, 'ok'); }
    else if (ph) setProfile(A, ph.sel);
    else { message('Click a sketch profile, or a line / origin axis / body edge for the axis'); focusPrimary(); return; }
    setHoverEdge(null);
    updateChips(); updatePreview(); focusPrimary();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'sketch') return false;
    const s = feats('sketch').find((x) => x.id === id);
    if (!s || s.error || !s.profiles || !s.profiles.length) { message('That sketch has no closed profile to revolve', 'warn'); return true; }
    const pr = s.profiles.filter((p) => p.outer).sort((a, b) => b.area - a.area)[0] || s.profiles[0];
    setProfile(A, { sketchId: s.id, key: pr.key });
    updateChips(); updatePreview(); focusPrimary();
    message(`Profile from ${s.name}`);
    return true;
  },
  onClose: () => { state.hovered = null; setHoverEdge(null); setBoldSegments([]); refreshProfiles(); },
  commit: (A: Dlg, P) => {
    const r = findProfile(P), ax = axisOf(P);
    if (!r) { message('Click a sketch profile to revolve', 'warn'); return false; }
    if (!ax) { message('Pick an axis to revolve around', 'warn'); return false; }
    if (Math.abs(P.angle || 0) < 0.01) { message('The angle needs to be more than 0°', 'warn'); focusPrimary(); return false; }
    P.opAuto = false;
    let f: OtherFeature;
    if (A.edit) { f = A.edit as OtherFeature; f.params = P as unknown as Record<string, unknown>; }
    else {
      const n = ++state.counters.revolve;
      f = { id: 'r' + n, type: 'revolve', name: (P.operation === 'Cut' ? 'RevolveCut' : 'Revolve') + n, params: P as unknown as Record<string, unknown> };
      let bid = P.operation === 'Join' ? joinBody(A) : null;
      if (P.operation === 'New body' || (P.operation === 'Join' && !bid)) { const bn = ++state.counters.body; state.bodies.push({ id: 'b' + bn, name: 'Body' + bn, visible: true }); bid = 'b' + bn; }
      if (bid) f.bodyId = bid;
      state.features.push(f);
      state.selected = null; state.treeSel = null; state.selection = [];
    }
    markDirty();
    message(A.edit ? `${f.name} updated` : `${f.name}: ${fmt(Math.abs(P.angle))}° around ${ax.name}`, 'ok');
    setTimeout(() => void whenBuilt().then(() => { if (f.error) { message(`${f.name} needs attention: ${f.note}`, 'warn'); emit('doc'); } }), 0);
    return true;
  },
});

