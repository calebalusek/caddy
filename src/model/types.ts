// The document model: plain data only, so it can be saved, sent to the worker and tested in Node.

export type Vec3 = [number, number, number];

/** A sketch/construction plane: origin, in-plane axes u and v, normal n, and the drawn extent [x0, x1, y0, y1]. */
export interface Frame {
  o: Vec3;
  u: Vec3;
  v: Vec3;
  n: Vec3;
  ext: [number, number, number, number];
}

export type OriginPlaneId = 'XY' | 'XZ' | 'YZ';

export type PlaneRef =
  | { kind: 'origin'; id: OriginPlaneId }
  | { kind: 'plane'; id: string }
  | { kind: 'face'; bodyName: string; frame: Frame };

interface FeatureBase {
  id: string;
  name: string;
  visible?: boolean;
  /** Set by regenerate when the feature cannot be rebuilt. */
  error?: boolean;
  note?: string;
}

export interface PlaneFeature extends FeatureBase {
  type: 'plane';
  params: { ref: PlaneRef | null; distance: number };
  /** Resolved by regenerate. */
  frame?: Frame | null;
}

/** Feature types whose tools are rebuilt in later steps keep their saved parameters untouched. */
export interface OtherFeature extends FeatureBase {
  type: 'sketch' | 'extrude' | 'fillet' | 'revolve' | 'hole' | 'sweep' | 'shell' | 'pattern';
  params: Record<string, unknown>;
  bodyId?: string;
  bodyIds?: string[];
  [key: string]: unknown;
}

export type Feature = PlaneFeature | OtherFeature;
export type FeatureType = Feature['type'];

export interface Body {
  id: string;
  name: string;
  visible: boolean;
  appearance?: unknown;
}

export type Counters = Record<'sketch' | 'extrude' | 'plane' | 'body' | 'fillet' | 'revolve' | 'hole' | 'sweep' | 'shell' | 'pattern', number>;

export const newCounters = (): Counters => ({ sketch: 0, extrude: 0, plane: 0, body: 0, fillet: 0, revolve: 0, hole: 0, sweep: 0, shell: 0, pattern: 0 });
