// The material library for the Render view: 20 materials, procedural textures (no image files),
// and the three.js material each look becomes. A "look" is {id, color?} and is saved with each body.
import * as THREE from 'three';

export interface MatDef {
  id: string;
  name: string;
  group: 'Plastic' | 'Metal' | 'Wood' | 'Other';
  /** The color can be changed (filament colors). */
  tint?: boolean;
  color: string;
  rough: number;
  metal?: number;
  clearcoat?: number;
  opacity?: number;
  tex?: 'carbon' | 'brushed' | 'oak' | 'walnut' | 'woodpla' | 'concrete';
}
export interface Look { id: string; color?: string }

export const MAT_LIB: MatDef[] = [
  { id: 'pla', name: 'PLA matte', group: 'Plastic', tint: true, color: '#B8C0C8', rough: 0.6 },
  { id: 'petg', name: 'PETG gloss', group: 'Plastic', tint: true, color: '#2F6FDB', rough: 0.2, clearcoat: 0.6 },
  { id: 'silk', name: 'Silk PLA', group: 'Plastic', tint: true, color: '#C9A227', rough: 0.3, metal: 0.45, clearcoat: 0.4 },
  { id: 'abs', name: 'ABS', group: 'Plastic', tint: true, color: '#E8E6E1', rough: 0.45 },
  { id: 'tpu', name: 'TPU flexible', group: 'Plastic', tint: true, color: '#2B2E33', rough: 0.85 },
  { id: 'resin', name: 'Resin', group: 'Plastic', tint: true, color: '#8F959C', rough: 0.3 },
  { id: 'clear', name: 'Clear resin', group: 'Plastic', tint: true, color: '#CFE6F2', rough: 0.05, opacity: 0.45, clearcoat: 1 },
  { id: 'cf', name: 'Carbon fiber', group: 'Plastic', color: '#FFFFFF', rough: 0.4, metal: 0.1, clearcoat: 0.5, tex: 'carbon' },
  { id: 'alu', name: 'Brushed aluminum', group: 'Metal', color: '#D4D7DA', rough: 0.34, metal: 1, tex: 'brushed' },
  { id: 'steel', name: 'Stainless steel', group: 'Metal', color: '#BFC3C7', rough: 0.22, metal: 1 },
  { id: 'chrome', name: 'Chrome', group: 'Metal', color: '#F2F2F2', rough: 0.04, metal: 1 },
  { id: 'brass', name: 'Brass', group: 'Metal', color: '#D2A64B', rough: 0.25, metal: 1 },
  { id: 'copper', name: 'Copper', group: 'Metal', color: '#C8784B', rough: 0.28, metal: 1 },
  { id: 'iron', name: 'Cast iron', group: 'Metal', color: '#5E6166', rough: 0.72, metal: 0.8 },
  { id: 'oak', name: 'Oak', group: 'Wood', color: '#FFFFFF', rough: 0.7, tex: 'oak' },
  { id: 'walnut', name: 'Walnut', group: 'Wood', color: '#FFFFFF', rough: 0.5, clearcoat: 0.3, tex: 'walnut' },
  { id: 'woodpla', name: 'Wood PLA', group: 'Wood', color: '#FFFFFF', rough: 0.82, tex: 'woodpla' },
  { id: 'concrete', name: 'Concrete', group: 'Other', color: '#FFFFFF', rough: 0.95, tex: 'concrete' },
  { id: 'rubber', name: 'Rubber', group: 'Other', color: '#1F2124', rough: 0.92 },
  { id: 'ceramic', name: 'Glazed ceramic', group: 'Other', tint: true, color: '#F2EFE8', rough: 0.12, clearcoat: 1 },
];
export const FILAMENT_COLORS: [string, string][] = [['#F4F4F2', 'White'], ['#1E1F22', 'Black'], ['#8F959C', 'Gray'], ['#D7263D', 'Red'], ['#F46036', 'Orange'], ['#F2C14E', 'Yellow'], ['#2E933C', 'Green'], ['#2F6FDB', 'Blue'], ['#6B4C9A', 'Purple'], ['#E4A1C4', 'Pink']];
export const DEFAULT_LOOK: Look = { id: 'pla', color: '#B8C0C8' };
export const matDef = (id: string): MatDef => MAT_LIB.find((m) => m.id === id) || MAT_LIB[0];
/** Anything saved in a file is checked before it is used. */
export function cleanLook(v: unknown): Look {
  const o = (v && typeof v === 'object' ? v : {}) as { id?: unknown; color?: unknown };
  const id = typeof o.id === 'string' && MAT_LIB.some((m) => m.id === o.id) ? o.id : DEFAULT_LOOK.id;
  return { id, ...(typeof o.color === 'string' && /^#[0-9a-f]{6}$/i.test(o.color) ? { color: o.color } : {}) };
}

// ---- procedural textures (value noise) ----
const hash2 = (x: number, y: number): number => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
function vnoise(x: number, y: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, s = (t: number): number => t * t * (3 - 2 * t), u = s(xf), v = s(yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x: number, y: number): number => vnoise(x, y) * 0.5 + vnoise(x * 2, y * 2) * 0.25 + vnoise(x * 4, y * 4) * 0.125 + vnoise(x * 8, y * 8) * 0.0625;

type Px = (x: number, y: number) => [number, number, number];
const texCache: Record<string, { tex: THREE.CanvasTexture; url: string }> = {};
export function makeTex(kind: NonNullable<MatDef['tex']>): { tex: THREE.CanvasTexture; url: string } {
  if (texCache[kind]) return texCache[kind];
  const S = 512, c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!, img = g.createImageData(S, S), d = img.data;
  const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const wood = (light: string, dark: string, rings: number, fine: number): Px => {
    const L = hex(light), D = hex(dark);
    return (x, y) => {
      const n = fbm(x / 150, y / 26), v = (y / S) * rings + n * 3.4, f = v - Math.floor(v);
      let t = Math.pow(Math.max(0, (f - 0.55) / 0.45), 1.6) * 0.85 + (vnoise(x / 3, y / 45) - 0.5) * fine + (fbm(x / 40, y / 8) - 0.5) * 0.18;
      t = Math.max(0, Math.min(1, t));
      return [L[0] + (D[0] - L[0]) * t, L[1] + (D[1] - L[1]) * t, L[2] + (D[2] - L[2]) * t];
    };
  };
  const fn: Record<string, Px> = {
    oak: wood('#D2A56B', '#8A5A2B', 9, 0.35),
    walnut: wood('#7E5334', '#35200F', 7, 0.3),
    woodpla: wood('#BF9466', '#8E6642', 16, 0.15),
    concrete: (x, y) => { const v = 168 + (fbm(x / 60, y / 60) - 0.5) * 46 + (vnoise(x / 2.2, y / 2.2) - 0.5) * 22 - (hash2(x, y) > 0.996 ? 60 : 0); return [v + 2, v, v - 6]; },
    carbon: (x, y) => {
      const cs = 32, cx = Math.floor(x / cs), cy = Math.floor(y / cs), alt = (cx + cy) % 2 === 0, u = alt ? x % cs : y % cs;
      const v = 34 + 26 * Math.pow(Math.sin((u / cs) * Math.PI), 2) + (vnoise(x / 1.5, y / 1.5) - 0.5) * 8;
      return [v, v + 2, v + 5];
    },
    brushed: (x, y) => { const v = 225 + (vnoise(x / 220, y * 0.9) - 0.5) * 42 + (vnoise(x / 40, y * 0.3) - 0.5) * 14; return [v, v, v]; },
  };
  const f = fn[kind];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const p = f(x, y), i = (y * S + x) * 4; d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2]; d[i + 3] = 255; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.MirroredRepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (kind === 'carbon') t.repeat.set(4, 4);
  if (kind === 'concrete') t.repeat.set(1.5, 1.5);
  const sm = document.createElement('canvas');
  sm.width = sm.height = 96;
  sm.getContext('2d')!.drawImage(c, 0, 0, 96, 96);
  return (texCache[kind] = { tex: t, url: sm.toDataURL('image/jpeg', 0.85) });
}

/** The three.js material for a look. */
export function makeMaterial(look: Look): THREE.MeshPhysicalMaterial {
  const def = matDef(look.id), col = def.tint && look.color ? look.color : def.color;
  const p: THREE.MeshPhysicalMaterialParameters = { roughness: def.rough, metalness: def.metal || 0, color: new THREE.Color(col).convertSRGBToLinear(), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 };
  if (def.clearcoat) { p.clearcoat = def.clearcoat; p.clearcoatRoughness = 0.06; }
  p.envMapIntensity = (def.metal || 0) > 0.5 ? 1.7 : def.rough < 0.35 ? 1.45 : 1.15;
  if (def.opacity) { p.transparent = true; p.opacity = def.opacity; }
  if (def.tex) { const t = makeTex(def.tex).tex; p.map = t; if (def.tex === 'carbon' || def.tex === 'brushed') { p.bumpMap = t; p.bumpScale = 0.015; } }
  return new THREE.MeshPhysicalMaterial(p);
}

/** CSS for a round swatch showing a material's color, shine and texture. */
export function swatchStyle(def: MatDef, color: string | null): string {
  const base = def.tex ? `url(${makeTex(def.tex).url}) center/cover` : def.tint && color ? color : def.color;
  const shine = Math.max(0.12, 0.95 * (1 - def.rough)), metal = def.metal ? 0.45 * def.metal : 0.22;
  return `background: radial-gradient(circle at 34% 28%, rgba(255,255,255,${shine.toFixed(2)}) 0, rgba(255,255,255,0) ${def.rough < 0.2 ? 22 : 42}%), radial-gradient(circle at 50% 50%, rgba(0,0,0,0) 48%, rgba(0,0,0,${metal.toFixed(2)}) 100%), ${base};` + (def.opacity ? 'opacity:.7;' : '');
}
