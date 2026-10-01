// Messages between the UI thread and the geometry worker. Plain data only.
import type { PatternParams } from '../model/pattern';
import type { Frame, Vec3 } from '../model/types';
import type { Edge2 } from '../sketch/profiles';
import type { P2 } from '../sketch/model';

/** A closed boundary in sketch coordinates: exact lines and arcs, or one full circle. */
export type LoopSpec = { edges: Edge2[] } | { circle: { c: P2; r: number } };
/** A region on a plane: outer boundary and holes. */
export interface ProfileSpec { frame: Frame; outer: LoopSpec; holes: LoopSpec[] }
/** A flat face of an existing body used as the profile (press-pull). */
export interface FaceSpec { bodyId: string; n: Vec3; w: number; p: Vec3; surf?: string }

/** How a saved feature points at a body edge. Geometric, the same as in version 1 files. */
export type EdgeRef =
  | { kind?: 'line'; bodyId: string; a: Vec3; b: Vec3; n1: Vec3; n2: Vec3 }
  | { kind: 'round'; bodyId: string; center: Vec3; axis: Vec3; R: number; closed: boolean; mid: Vec3; sr?: unknown; pts?: Vec3[] };

export type Operation = 'Join' | 'Cut' | 'New body';

/** One piece of a sweep path in the path sketch's own coordinates: an exact line or arc. A full circle is one arc with full = true. */
export type PathSeg =
  | { cid: string; type: 'line'; a: P2; b: P2 }
  | { cid: string; type: 'arc'; a: P2; b: P2; c: P2; r: number; ccw: boolean; full?: boolean };
/** A sweep path: connected pieces in order, on the plane of the sketch they were drawn in. */
export interface PathSpec { frame: Frame; segs: PathSeg[]; closed: boolean }

export type BuildStep =
  | {
      kind: 'extrude';
      id: string;
      profile: ProfileSpec | null;
      face: FaceSpec | null;
      /** Start along the plane normal, and thickness. */
      z0: number;
      depth: number;
      operation: Operation;
      bodyId: string | null;
    }
  | { kind: 'fillet'; id: string; mode: 'fillet' | 'chamfer'; r: number; edges: EdgeRef[] }
  | {
      kind: 'revolve';
      id: string;
      profile: ProfileSpec | null;
      /** A point on the axis and its direction; must lie in the profile's plane. */
      axis: { A: Vec3; d: Vec3 } | null;
      /** Degrees: where the sweep starts (measured from the sketch plane) and how far it goes. */
      ang0: number;
      angle: number;
      operation: Operation;
      bodyId: string | null;
    }
  | {
      kind: 'hole';
      id: string;
      /** Where to drill: a fixed spot (from a sketch point), a spot on a body face, or null if its sketch point is gone. */
      at: (HoleSpot | null)[];
      d: number;
      through: boolean;
      depth: number;
      type: 'Simple' | 'Counterbore' | 'Countersink';
      cbD: number;
      cbDepth: number;
      csD: number;
    }
  | {
      kind: 'shell';
      id: string;
      bodyId: string | null;
      /** Faces left open (any kind of face). None = a closed hollow. */
      faces: FaceSpec[];
      thickness: number;
      direction: 'Inside' | 'Outside';
    }
  | {
      kind: 'mirror';
      id: string;
      /** Bodies to mirror. */
      bodies: string[];
      /** The mirror plane: a point on it and its normal. */
      plane: { o: Vec3; n: Vec3 } | null;
      /** Join: the mirror image is fused to its body (a symmetric part). New body: a separate copy. */
      operation: 'Join' | 'New body';
      /** The bodies the copies become when they are separate. */
      bodyIds: string[];
    }
  | {
      kind: 'pattern';
      id: string;
      params: PatternParams;
      /** Bodies made by the copies (one per copy that becomes a new body), in order. */
      bodyIds: string[];
    }
  | {
      kind: 'sweep';
      id: string;
      profile: ProfileSpec | null;
      face: FaceSpec | null;
      path: PathSpec | null;
      /** Why there is no path, for the feature's warning. */
      pathNote?: string;
      /** Perpendicular: the profile turns with the path. Parallel: it keeps its direction. */
      orientation: 'Perpendicular' | 'Parallel';
      /** Sharp path corners: replaced by a smooth bend, or joined with a mitre. */
      corners: 'Round' | 'Mitered';
      operation: Operation;
      bodyId: string | null;
    };
export type SweepStep = Extract<BuildStep, { kind: 'sweep' }>;
export type HoleSpot = { c: Vec3; dir: Vec3 } | { face: FaceSpec };

export interface FaceInfo {
  id: number;
  /** "<feature id>:<role>": which feature made this face. Fillet faces are "F:<fillet id>:<edge index>". */
  surf: string;
  planar: boolean;
  /** Outward normal and a point on the face (planar faces: exact; curved: at the face's middle). */
  n: Vec3;
  p: Vec3;
  area: number;
}

export interface EdgeInfo {
  id: number;
  kind: 'line' | 'round' | 'other';
  a: Vec3;
  b: Vec3;
  mid: Vec3;
  /** Round edges (circles and circular arcs). */
  center?: Vec3;
  axis?: Vec3;
  R?: number;
  closed?: boolean;
  /** The two faces that meet at this edge, and their outward normals at its middle. */
  faces: number[];
  n1: Vec3;
  n2: Vec3;
}

/** Triangles and edge lines for one body, with face/edge identity kept. */
export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Index ranges per B-rep face. */
  faceGroups: { start: number; count: number; faceId: number }[];
  /** Line-segment vertex positions (pairs of points). */
  edgeLines: Float32Array;
  /** Segment-vertex ranges per B-rep edge. */
  edgeGroups: { start: number; count: number; edgeId: number }[];
  volume: number;
}

export interface BodyResult {
  id: string;
  mesh: BodyMesh;
  faces: FaceInfo[];
  edges: EdgeInfo[];
  volume: number;
  box: [Vec3, Vec3];
}

export interface StepResult { id: string; error?: boolean; note?: string; box?: [Vec3, Vec3] }
export interface BuildResult { bodies: BodyResult[]; steps: StepResult[] }

/** A tool's live preview: the model as it is, the model with the tool applied, and what the tool takes away and adds. */
export interface PreviewBody { id: string; volume: number; box: [Vec3, Vec3] }
export interface DraftResult {
  /** The model as it is; null when it is the same one the caller already has (baseKey). */
  base: BuildResult | null;
  baseKey: string;
  /** Sizes of the bodies with the tool applied, and how the tool's own step went. */
  draft: { bodies: PreviewBody[]; step: StepResult };
  removed: BodyMesh[];
  added: BodyMesh[];
}

export interface KernelOps {
  ping: { args: []; result: 'ready' };
  /** A w × d × h box with a corner at the origin (self-test). */
  testBox: { args: [w: number, d: number, h: number]; result: BodyMesh };
  /** Rebuild every body from the timeline. */
  build: { args: [steps: BuildStep[]]; result: BuildResult };
  /** The same, with one more step applied on top: for tools that preview on the real body. */
  buildDraft: { args: [steps: BuildStep[], draft: BuildStep | null, haveKey: string | null]; result: DraftResult };
  /** Triangles for STL / 3MF at a chosen fineness. ids = which bodies (null = all). */
  exportMesh: { args: [steps: BuildStep[], quality: { tolerance: number; angularTolerance: number }, ids: string[] | null]; result: { id: string; positions: Float32Array; indices: Uint32Array; volume: number }[] };
  /** A STEP file of the listed bodies. */
  exportStep: { args: [steps: BuildStep[], bodies: { id: string; name: string }[]]; result: Uint8Array };
}

export type OpName = keyof KernelOps;

export interface KernelRequest<K extends OpName = OpName> {
  id: number;
  op: K;
  args: KernelOps[K]['args'];
}

export type KernelResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };
