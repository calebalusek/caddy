// Extrude (EX): pull a sketch region or a flat body face into a solid. Join, Cut or New body is
// picked automatically from where the extrude goes; the user can override it.
import * as THREE from 'three';
import { emit } from '../app/hub';
import { markDirty } from '../app/regenerate';
import { baseBody, findProfile, whenBuilt } from '../app/solids';
import { bodyById, feats, state, type ProfileSel } from '../app/state';
import { fmt } from '../core/format';
import type { FaceSpec, Operation } from '../kernel/protocol';
import { extrudeRange } from '../kernel/spec';
import { frameFromFace, toWorld, vdot, vnorm } from '../model/frames';
import type { Frame, OtherFeature, Vec3 } from '../model/types';
import type { Profile } from '../sketch/profiles';
import { profileShape, refreshProfiles } from '../sketch/visuals';
import { message } from '../ui/message';
import { bodyVis, insideAnyBody, setHoverFace, visibleBodies } from '../view/bodies';
import { faceAtCursor, profileAtCursor } from '../view/hit';
import { selectedFlatFace } from '../view/interaction';
import { frameMatrix, v3 } from '../view/planes';
import { focusPrimary, registerTool, setChoice, setHint, updateChips, updatePreview, type ActiveDialog } from './dialog';

interface ExtrudeParams {
  sketchId: string | null;
  key: string | null;
  hint?: { pts: [number, number][]; area: number };
  face?: FaceSpec | null;
  distance: number;
  direction: 'One side' | 'Symmetric';
  operation: Operation;
  opAuto: boolean;
  offset: number;
}
type Dlg = ActiveDialog<ExtrudeParams> & { toolBox?: THREE.Box3 };

/** The sketch region to offer when the tool opens: the selected one, else the obvious one. */
export function autoProfile(): ProfileSel | null {
  if (state.selected && findProfile(state.selected)) return state.selected;
  const biggest = (ps: Profile[]): Profile => ps.filter((p) => p.outer).sort((a, b) => b.area - a.area)[0] || ps[0];
  if (state.treeSel) {
    const s = feats('sketch').find((x) => x.id === state.treeSel);
    if (s && !s.error && s.profiles && s.profiles.length) return { sketchId: s.id, key: biggest(s.profiles).key };
  }
  const vis = feats('sketch').filter((s) => s.visible !== false && !s.error && s.profiles && s.profiles.length);
  const all: ProfileSel[] = [];
  vis.forEach((s) => s.profiles!.forEach((p) => all.push({ sketchId: s.id, key: p.key })));
  if (all.length === 1) return all[0];
  const last = vis.find((s) => s.id === state.lastSketchId) || vis[vis.length - 1];
  if (!last) return null;
  const outer = last.profiles!.filter((p) => p.outer).sort((a, b) => b.area - a.area)[0];
  return outer ? { sketchId: last.id, key: outer.key } : null;
}

/** What is being extruded, resolved against the current sketches and bodies. */
type Source =
  | { kind: 'profile'; frame: Frame; name: string; inner: [number, number]; centroid: [number, number]; pr: Profile }
  | { kind: 'face'; frame: Frame; name: string; bodyId: string; faceId: number; p: Vec3 };
function source(P: ExtrudeParams): Source | null {
  if (P.face) {
    const spec = P.face, b = baseBody(spec.bodyId);
    if (!b) return null;
    const n = vnorm(spec.n);
    let best: { id: number; d: number } | null = null;
    b.faces.forEach((f) => {
      if (!f.planar || vdot(f.n, n) < 0.9999) return;
      const d = Math.abs(vdot(n, f.p) - spec.w) + (f.surf === spec.surf ? 0 : 0.5);
      if (!best || d < best.d) best = { id: f.id, d };
    });
    if (!best) return null;
    const body = bodyById(spec.bodyId);
    return { kind: 'face', frame: frameFromFace(n, spec.p), name: 'Face of ' + (body ? body.name : 'body'), bodyId: spec.bodyId, faceId: (best as { id: number }).id, p: spec.p };
  }
  const r = findProfile(P);
  return r ? { kind: 'profile', frame: r.sk.frame!, name: 'Profile in ' + r.sk.name, inner: r.pr.inner!, centroid: r.pr.centroid!, pr: r.pr } : null;
}

/** A prism over one body face (for the press-pull preview). */
function facePrism(bodyId: string, faceId: number, n: Vec3, z0: number, depth: number): THREE.BufferGeometry | null {
  const v = bodyVis(bodyId), g = v && v.data.mesh.faceGroups.find((x) => x.faceId === faceId);
  if (!v || !g) return null;
  const P = v.data.mesh.positions, I = v.data.mesh.indices, out: number[] = [];
  const at = (i: number, z: number): Vec3 => [P[i * 3] + n[0] * z, P[i * 3 + 1] + n[1] * z, P[i * 3 + 2] + n[2] * z];
  const edges = new Map<string, [number, number]>();
  for (let k = g.start; k < g.start + g.count; k += 3) {
    const t = [I[k], I[k + 1], I[k + 2]];
    out.push(...at(t[0], z0), ...at(t[2], z0), ...at(t[1], z0), ...at(t[0], z0 + depth), ...at(t[1], z0 + depth), ...at(t[2], z0 + depth));
    for (let e = 0; e < 3; e++) {
      const a = t[e], b = t[(e + 1) % 3], key = a < b ? a + '|' + b : b + '|' + a;
      if (edges.has(key)) edges.delete(key); else edges.set(key, [a, b]); // an edge used once is on the boundary
    }
  }
  edges.forEach(([a, b]) => out.push(...at(a, z0), ...at(b, z0), ...at(b, z0 + depth), ...at(a, z0), ...at(b, z0 + depth), ...at(a, z0 + depth)));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  geo.computeVertexNormals();
  return geo;
}

function toolGeometry(src: Source, P: ExtrudeParams): THREE.BufferGeometry | null {
  const { z0, depth } = extrudeRange(P.distance, P.direction, P.offset || 0);
  if (depth < 0.01) return null;
  if (src.kind === 'face') return facePrism(src.bodyId, src.faceId, src.frame.n, z0, depth);
  const geo = new THREE.ExtrudeGeometry(profileShape(src.pr), { depth, bevelEnabled: false, curveSegments: 72 });
  geo.translate(0, 0, z0);
  geo.applyMatrix4(frameMatrix(src.frame));
  return geo;
}

/** Join, Cut or New body, from where the extrude goes. */
function autoOperation(src: Source, P: ExtrudeParams, box: THREE.Box3 | null): Operation {
  const bodies = visibleBodies();
  if (!bodies.length) return 'New body';
  const d = P.distance, sgn = P.direction === 'Symmetric' ? 1 : d < 0 ? -1 : 1, step = Math.min(0.5, Math.abs(d) / 2 || 0.5);
  const probe = src.kind === 'face' ? v3([src.p[0] + src.frame.n[0] * sgn * step, src.p[1] + src.frame.n[1] * sgn * step, src.p[2] + src.frame.n[2] * sgn * step]) : v3(toWorld(src.frame, src.inner[0], src.inner[1], (P.offset || 0) + sgn * step));
  if (insideAnyBody(probe)) return 'Cut';
  if (box && bodies.some((b) => b.box.intersectsBox(box))) return 'Join';
  return 'New body';
}

function setProfile(A: Dlg, sel: ProfileSel): void {
  const P = A.params;
  delete P.face; delete P.hint;
  P.sketchId = sel.sketchId; P.key = sel.key;
}

registerTool<ExtrudeParams>({
  type: 'extrude',
  title: 'Extrude',
  icon: 'extrude',
  gc: 'g-create',
  prompt: 'Distance: type a value or drag the arrow',
  fields: [
    { key: 'profile', kind: 'chip', label: 'Profile', chipId: 'selChip' },
    { key: 'distance', kind: 'length', label: 'Distance', primary: true },
    { key: 'direction', kind: 'choice', label: 'Direction', options: ['One side', 'Symmetric'] },
    { key: 'operation', kind: 'choice', label: 'Operation', options: ['Join', 'Cut', 'New body'], lockOnEdit: true, hintId: 'opHint' },
  ],
  advanced: [{ key: 'offset', kind: 'length', label: 'Start offset from sketch' }],
  distanceKey: 'distance',
  defaults: () => {
    const fs = !state.selected && !state.treeSel ? selectedFlatFace() : null;
    if (fs) return { face: { bodyId: fs.bodyId, surf: fs.surf, n: fs.n, w: vdot(fs.n, fs.p), p: fs.p }, sketchId: null, key: null, distance: 0, direction: 'One side', operation: 'Join', opAuto: true, offset: 0 };
    const p = autoProfile();
    return { sketchId: p ? p.sketchId : null, key: p ? p.key : null, distance: 0, direction: 'One side', operation: 'New body', opAuto: true, offset: 0 };
  },
  chips: (A) => { const s = source(A.params); return { selChip: { set: !!s, text: s ? s.name : 'Click a sketch profile or a flat face' } }; },
  preview: (A: Dlg) => {
    const P = A.params, src = source(P);
    setHint('opHint', P.opAuto ? 'Picked automatically from where the extrude goes' : '');
    refreshProfiles();
    if (!src) return { ok: false };
    const geo = toolGeometry(src, P);
    A.toolBox = undefined;
    if (geo) { geo.computeBoundingBox(); A.toolBox = geo.boundingBox!.clone().expandByScalar(1e-3); }
    if (geo && P.opAuto && !A.edit) { P.operation = autoOperation(src, P, A.toolBox || null); setChoice('operation', P.operation); }
    const fr = src.frame, off = P.offset || 0, sym = P.direction === 'Symmetric';
    const base = src.kind === 'face' ? v3([src.p[0] + fr.n[0] * off, src.p[1] + fr.n[1] * off, src.p[2] + fr.n[2] * off]) : v3(toWorld(fr, src.centroid[0], src.centroid[1], off));
    const tip = base.clone().addScaledVector(v3(fr.n), sym ? Math.abs(P.distance) : P.distance);
    return { geo, handle: { base, tip, axis: v3(fr.n), dir: sym ? 1 : P.distance < 0 ? -1 : 1, value: P.distance }, cut: P.operation === 'Cut', ok: true };
  },
  hover: (A) => {
    const ph = profileAtCursor(), fh = faceAtCursor();
    const useProfile = ph && (!fh || ph.distance - 0.05 <= fh.distance);
    const h = useProfile ? ph!.sel : null;
    if ((h && h.sketchId) !== (state.hovered && state.hovered.sketchId) || (h && h.key) !== (state.hovered && state.hovered.key)) { state.hovered = h; refreshProfiles(); }
    if (!useProfile && fh && fh.face.planar && !(A.params.face && A.params.face.bodyId === fh.bodyId && Math.abs(vdot(A.params.face.n, fh.face.n) - 1) < 1e-6 && Math.abs(vdot(fh.face.n, fh.face.p) - A.params.face.w) < 1e-6)) { setHoverFace(fh.bodyId, fh.face.id); return true; }
    setHoverFace(null);
    return !!h;
  },
  click: (A: Dlg) => {
    const P = A.params, ph = profileAtCursor(), fh = faceAtCursor();
    if (ph && (!fh || ph.distance - 0.05 <= fh.distance)) setProfile(A, ph.sel);
    else if (fh && fh.face.planar) {
      // press-pull: positive pulls the face out (adds material), negative pushes it in (cuts)
      const f = fh.face, p: Vec3 = [fh.point.x, fh.point.y, fh.point.z];
      P.face = { bodyId: fh.bodyId, surf: f.surf, n: f.n, w: vdot(f.n, p), p };
      P.sketchId = null; P.key = null; delete P.hint;
      if (!A.edit) P.opAuto = true;
      message('Face picked. Type a distance: positive pulls it out (adds material), negative pushes it in (cuts).');
    } else if (fh) message('That face is curved. Pick a flat face or a sketch profile.', 'warn');
    else { focusPrimary(); return; }
    setHoverFace(null);
    updateChips(); updatePreview(); focusPrimary();
  },
  pickRef: (A: Dlg, kind, id) => {
    if (kind !== 'sketch') return false;
    const s = feats('sketch').find((x) => x.id === id);
    if (!s || s.error || !s.profiles || !s.profiles.length) { message('That sketch has no closed profile to extrude', 'warn'); return true; }
    const pr = s.profiles.filter((p) => p.outer).sort((a, b) => b.area - a.area)[0] || s.profiles[0];
    setProfile(A, { sketchId: s.id, key: pr.key });
    updateChips(); updatePreview(); focusPrimary();
    message(`Profile in ${s.name} picked`);
    return true;
  },
  onClose: () => { state.hovered = null; setHoverFace(null); refreshProfiles(); },
  commit: (A: Dlg, P) => {
    const src = source(P);
    if (!src) { message('Click a profile in the viewport to extrude', 'warn'); return false; }
    if (extrudeRange(P.distance, P.direction, P.offset || 0).depth < 0.01) { message('Distance needs to be more than 0 mm', 'warn'); focusPrimary(); return false; }
    P.opAuto = false;
    const opWord = P.operation === 'Cut' ? 'cut' : 'extruded';
    let f: OtherFeature;
    let said: string;
    if (A.edit) {
      f = A.edit as OtherFeature;
      f.params = P as unknown as Record<string, unknown>;
      said = `${f.name} updated to ${fmt(P.distance)} mm`;
    } else {
      const n = ++state.counters.extrude;
      f = { id: 'e' + n, type: 'extrude', name: (P.operation === 'Cut' ? 'Cut' : 'Extrude') + n, params: P as unknown as Record<string, unknown> };
      let body = null as ReturnType<typeof bodyById> | null;
      if (P.operation === 'Join' && state.bodies.length) {
        const hit = A.toolBox ? visibleBodies().find((b) => b.box.intersectsBox(A.toolBox!)) : null;
        body = (hit && bodyById(hit.id)) || state.bodies[state.bodies.length - 1];
      }
      if (P.operation === 'New body' || (P.operation === 'Join' && !body)) {
        const bn = ++state.counters.body;
        body = { id: 'b' + bn, name: 'Body' + bn, visible: true };
        state.bodies.push(body);
      }
      if (body) f.bodyId = body.id;
      state.features.push(f);
      state.selected = null; state.treeSel = null; state.selection = [];
      said = `${f.name} ${opWord} ${fmt(Math.abs(P.distance))} mm${body ? (P.operation === 'Join' ? ', joined to ' + body.name : ' as ' + body.name) : ''}`;
    }
    markDirty();
    message(said, 'ok');
    // the kernel reports problems (like nothing to cut) once the rebuild finishes
    setTimeout(() => void whenBuilt().then(() => {
      if (!f.error) return;
      message(f.note === 'nothing to cut' ? `${f.name} has nothing to cut. Move it into a body or change it to Join.` : `${f.name} needs attention: ${f.note || 'check its sketch'}`, 'warn');
      emit('doc');
    }), 0);
    return true;
  },
});

