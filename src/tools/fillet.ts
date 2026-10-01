// Fillet (F) and Chamfer (CHA): round or bevel body edges. The result previews live on the body.
import { emit } from '../app/hub';
import { fmtU, unitName } from '../core/units';
import { markDirty } from '../app/regenerate';
import { baseBodies, baseBody, whenBuilt } from '../app/solids';
import { state } from '../app/state';
import { edgeToRef, matchEdge, refIs } from '../kernel/match';
import type { BodyResult, EdgeInfo, EdgeRef } from '../kernel/protocol';
import { vadd, vcross, vdot, vnorm, vsc, vsub } from '../model/frames';
import type { OtherFeature, Vec3 } from '../model/types';
import { message } from '../ui/message';
import { edgeSegments, setBoldSegments, setHoverEdge, setHoverFace } from '../view/bodies';
import { edgeAtCursor, faceAtCursor, type FaceHit } from '../view/hit';
import { selectedEdgeRefs } from '../view/interaction';
import { v3 } from '../view/planes';
import { focusPrimary, refreshHandle, registerTool, setHint, updateChips, updatePreview, type ActiveDialog, type Handle, type ToolDef } from './dialog';

interface FilletParams { kind: 'fillet' | 'chamfer'; edges: EdgeRef[]; r: number }
type Dlg = ActiveDialog<FilletParams>;

/** Picking tolerance grows with the size: the body on screen is already rounded, the edges being picked are the sharp ones. */
const pickTol = (A: Dlg): number => Math.max(0.6, 2.2 * (A.params.r || 0));

/** The sharp edges that border the face under the cursor (click a face to take all its edges). */
function faceEdges(fh: FaceHit): { body: BodyResult; edges: EdgeInfo[] } | null {
  const body = baseBody(fh.bodyId);
  if (!body) return null;
  const n = fh.face.n, p: Vec3 = [fh.point.x, fh.point.y, fh.point.z], d = vdot(n, p);
  const usable = body.edges.filter((e) => e.kind !== 'other');
  if (!fh.face.planar) {
    // a curved face keeps its tag through the preview rebuild
    const ids = new Set(body.faces.filter((f) => f.surf === fh.face.surf && !f.planar).map((f) => f.id));
    return { body, edges: usable.filter((e) => e.faces.some((id) => ids.has(id))) };
  }
  const onPlane = (q: Vec3): boolean => Math.abs(vdot(n, q) - d) < 1e-3;
  return {
    body,
    edges: usable.filter((e) => (e.kind === 'round'
      ? Math.abs(vdot(e.axis!, n)) > 0.999 && onPlane(e.center!)
      : (vdot(e.n1, n) > 0.999 || vdot(e.n2, n) > 0.999) && onPlane(e.a) && onPlane(e.b))),
  };
}

/** Bold blue band on every picked edge that still exists. */
function drawPicked(A: Dlg): void {
  const segs = A.params.edges.flatMap((ref) => {
    const b = baseBody(ref.bodyId), e = b ? matchEdge(b.edges, ref) : null;
    return b && e ? edgeSegments(b, e.id) : [];
  });
  setBoldSegments(segs);
}

/**
 * The drag arrow: it sits on the first picked edge and slides across the neighboring face, so its
 * tip marks how far the fillet or chamfer cuts into the body.
 */
function sizeHandle(A: Dlg): Handle | null {
  for (const ref of A.params.edges) {
    const b = baseBody(ref.bodyId), e = b ? matchEdge(b.edges, ref) : null;
    if (!b || !e) continue;
    const along = e.kind === 'round' ? vnorm(vcross(e.axis!, vsub(e.mid, e.center!))) : vnorm(vsub(e.b, e.a));
    let t = vnorm(vcross(e.n1, along)); // in the first face, square to the edge
    const face = b.faces.find((f) => f.id === e.faces[0]);
    if (face ? vdot(t, vsub(face.p, e.mid)) < 0 : vdot(t, e.n2) > 0) t = vsc(t, -1); // pointing into that face
    const r = Math.max(0, A.params.r || 0);
    return { base: v3(e.mid), tip: v3(vadd(e.mid, vsc(t, r))), axis: v3(t), dir: 1, value: r };
  }
  return null;
}

function make(kind: 'fillet' | 'chamfer'): ToolDef<FilletParams> {
  const word = kind === 'chamfer' ? 'Chamfer' : 'Fillet';
  return {
    type: kind,
    title: word,
    icon: kind,
    gc: 'g-modify',
    prompt: kind === 'chamfer' ? 'Click edges to bevel, then type a distance' : 'Click edges to round, then type a radius',
    fields: [
      { key: 'edges', kind: 'chip', label: 'Edges', chipId: 'edgeChip', note: 'Click an edge again to remove it. Click a face to take all its edges.' },
      { key: 'r', kind: 'length', label: kind === 'chamfer' ? 'Distance' : 'Radius', primary: true },
    ],
    distanceKey: 'r',
    minDistance: 0,
    defaults: () => ({ kind, edges: selectedEdgeRefs(), r: 0 }),
    chips: (A) => { const n = A.params.edges.length; return { edgeChip: { set: n > 0, text: n ? `${n} edge${n > 1 ? 's' : ''} selected` : 'Click the edges to ' + (kind === 'chamfer' ? 'bevel' : 'round') } }; },
    draftStep: (A) => (A.params.edges.length && A.params.r > 0 ? { kind: 'fillet', id: A.edit ? A.edit.id : 'draft', mode: kind, r: A.params.r, edges: A.params.edges } : null),
    preview: (A: Dlg) => { drawPicked(A); return { handle: sizeHandle(A), cut: true, ok: A.params.edges.length > 0 && A.params.r > 0 }; },
    onBuilt: (A: Dlg) => {
      drawPicked(A);
      refreshHandle();
      setHint('h-r', A.note ? A.note[0].toUpperCase() + A.note.slice(1) : '');
    },
    hover: (A: Dlg) => {
      const eh = edgeAtCursor(baseBodies(), pickTol(A));
      if (eh && eh.edge.kind !== 'other') { setHoverFace(null); setHoverEdge(eh.segs, 'd' + eh.bodyId + ':' + eh.edge.id); return true; }
      setHoverEdge(null);
      const fh = faceAtCursor();
      if (fh) { setHoverFace(fh.bodyId, fh.face.id); return true; }
      setHoverFace(null);
      return false;
    },
    click: (A: Dlg) => {
      const P = A.params, eh = edgeAtCursor(baseBodies(), pickTol(A));
      if (eh && eh.edge.kind !== 'other') {
        const i = P.edges.findIndex((r) => refIs(eh.edge, eh.bodyId, r));
        if (i >= 0) P.edges.splice(i, 1); else P.edges.push(edgeToRef(eh.edge, eh.bodyId));
      } else {
        const fh = faceAtCursor(), fe = fh ? faceEdges(fh) : null;
        if (!fh || !fe) { focusPrimary(); return; }
        // clicking a face toggles all of its edges
        const has = (e: EdgeInfo): boolean => P.edges.some((r) => refIs(e, fe.body.id, r));
        const all = fe.edges.length > 0 && fe.edges.every(has);
        if (all) P.edges = P.edges.filter((r) => !fe.edges.some((e) => refIs(e, fe.body.id, r)));
        else fe.edges.forEach((e) => { if (!has(e)) P.edges.push(edgeToRef(e, fe.body.id)); });
        message(all ? "Removed that face's edges" : `Added the face's ${fe.edges.length} edge${fe.edges.length > 1 ? 's' : ''}`);
      }
      setHoverEdge(null); setHoverFace(null);
      updateChips(); updatePreview(); focusPrimary();
    },
    onClose: () => { setHoverEdge(null); setHoverFace(null); setBoldSegments([]); },
    commit: (A: Dlg, P) => {
      if (!P.edges.length) { message('Click at least one edge first', 'warn'); return false; }
      if (!(P.r > 0)) { message(`${word} size needs to be more than 0 ${unitName()}`, 'warn'); focusPrimary(); return false; }
      let f = A.edit as OtherFeature | null;
      if (f) f.params = P as unknown as Record<string, unknown>;
      else { const n = ++state.counters.fillet; f = { id: 'f' + n, type: 'fillet', name: word + n, params: P as unknown as Record<string, unknown> }; state.features.push(f); }
      state.selection = [];
      markDirty();
      const feat = f;
      message(`${feat.name}: ${P.edges.length} edge${P.edges.length > 1 ? 's' : ''}, ${kind === 'chamfer' ? '' : 'R'}${fmtU(P.r)}`, 'ok');
      setTimeout(() => void whenBuilt().then(() => { if (feat.error) { message(`${feat.name} needs attention: ${feat.note}`, 'warn'); emit('doc'); } }), 0);
      return true;
    },
  };
}

registerTool(make('fillet'));
registerTool(make('chamfer'));
