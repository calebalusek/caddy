// Messages between the UI thread and the geometry worker.

/** Triangles and edge lines for one body, with face/edge identity kept. */
export interface BodyMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  /** Triangle index ranges per B-rep face: [start, count, faceId]. */
  faceGroups: { start: number; count: number; faceId: number }[];
  /** Line-segment vertex positions (pairs of points). */
  edgeLines: Float32Array;
  /** Segment-vertex ranges per B-rep edge: [start, count, edgeId]. */
  edgeGroups: { start: number; count: number; edgeId: number }[];
  volume: number;
}

export interface KernelOps {
  ping: { args: []; result: 'ready' };
  /** Step 0 proof: a w × d × h box, corner at the origin. */
  testBox: { args: [w: number, d: number, h: number]; result: BodyMesh };
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
