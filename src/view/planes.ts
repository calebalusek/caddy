// Origin planes and offset planes in the viewport, with hover (orange) and selected (blue) styling.
import * as THREE from 'three';
import { cssv } from '../core/dom';
import { on } from '../app/hub';
import { feats, refKey, state } from '../app/state';
import { ORIGIN, toWorld } from '../model/frames';
import type { Frame, OriginPlaneId, PlaneRef, Vec3 } from '../model/types';
import { disposeGroup, originGroup, planeEdgeMat, scene, V3 } from './scene';

export interface PlaneVis {
  group: THREE.Group;
  fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  ref: PlaneRef;
  key: string;
  frame: Frame;
}

export const v3 = (a: Vec3): V3 => new V3(a[0], a[1], a[2]);
export const frameMatrix = (f: Frame): THREE.Matrix4 => new THREE.Matrix4().makeBasis(v3(f.u), v3(f.v), v3(f.n)).setPosition(v3(f.o));

export function planeShapeGeometry(frame: Frame): THREE.BufferGeometry {
  const [x0, x1, y0, y1] = frame.ext;
  const s = new THREE.Shape();
  s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.applyMatrix4(frameMatrix(frame));
  return g;
}

function makePlaneVis(frame: Frame, ref: PlaneRef): PlaneVis {
  const [x0, x1, y0, y1] = frame.ext;
  const fill = new THREE.Mesh(planeShapeGeometry(frame), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  fill.renderOrder = 2;
  const corners = ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]] as const).map(([x, y]) => v3(toWorld(frame, x, y)));
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), planeEdgeMat);
  const group = new THREE.Group();
  group.add(fill, outline);
  const vis: PlaneVis = { group, fill, ref, key: refKey(ref), frame };
  fill.userData.vis = vis;
  return vis;
}

const originPlanes = new THREE.Group();
originPlanes.visible = false;
originGroup.add(originPlanes);
const originVis: PlaneVis[] = (['XY', 'XZ', 'YZ'] as OriginPlaneId[]).map((id) => {
  const v = makePlaneVis(ORIGIN[id], { kind: 'origin', id });
  originPlanes.add(v.group);
  return v;
});

const featureVis = new Map<string, PlaneVis>();

/** Rebuild the visuals of every offset plane from its resolved frame (called by regenerate). */
export function syncPlaneFeatures(): void {
  featureVis.forEach((v) => { scene.remove(v.group); disposeGroup(v.group); });
  featureVis.clear();
  feats('plane').forEach((f) => {
    if (!f.frame) return;
    const v = makePlaneVis(f.frame, { kind: 'plane', id: f.id });
    v.group.visible = f.visible !== false && state.viewMode !== 'render' && !(state.active && state.active.edit === f);
    scene.add(v.group);
    featureVis.set(f.id, v);
  });
  refreshPlaneStyles();
}

export const allPlaneVis = (): PlaneVis[] => originVis.concat([...featureVis.values()]);

const visibleChain = (o: THREE.Object3D | null): boolean => { for (let x = o; x; x = x.parent) if (!x.visible) return false; return true; };
/** Plane fills that can be hit right now. */
export const pickablePlanes = (): PlaneVis[] => allPlaneVis().filter((v) => visibleChain(v.fill));

export function refreshPlaneStyles(): void {
  const base = new THREE.Color(cssv('--plane')), hov = new THREE.Color(cssv('--accent-fill')), sel = new THREE.Color(cssv('--select'));
  originPlanes.visible = (state.originPlanesVisible || !!state.pick) && state.viewMode !== 'render';
  allPlaneVis().forEach((v) => {
    const isSel = state.selection.some((s) => s.kind === 'plane' && s.key === v.key);
    const isHov = !isSel && state.hoverKey === v.key;
    v.fill.material.color.copy(isSel ? sel : isHov ? hov : base);
    v.fill.material.opacity = isSel || isHov ? 0.4 : 0.17;
  });
}
on('select', refreshPlaneStyles);
on('theme', refreshPlaneStyles);
on('mode', refreshPlaneStyles);
on('view', () => {
  featureVis.forEach((v, id) => { const f = feats('plane').find((x) => x.id === id); v.group.visible = !!f && f.visible !== false && state.viewMode !== 'render' && !(state.active && state.active.edit === f); });
  refreshPlaneStyles();
});

/** Corner points of visible offset planes, for zoom-to-fit. */
export function planeFitPoints(): V3[] {
  const pts: V3[] = [];
  featureVis.forEach((v) => {
    if (!v.group.visible) return;
    const e = v.frame.ext;
    ([[e[0], e[2]], [e[1], e[2]], [e[0], e[3]], [e[1], e[3]]] as const).forEach(([x, y]) => pts.push(v3(toWorld(v.frame, x, y))));
  });
  return pts;
}
