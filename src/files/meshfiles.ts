// Print files: binary STL and 3MF, built from the kernel's triangles. Plain files, millimeters.
import type { Vec3 } from '../model/types';

export interface MeshBody { name: string; positions: Float32Array; indices: Uint32Array }
type Tri = [Vec3, Vec3, Vec3];

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** A body's triangles, without degenerate (zero-area) ones. */
export function bodyTriangles(b: MeshBody): Tri[] {
  const P = (i: number): Vec3 => [b.positions[i * 3], b.positions[i * 3 + 1], b.positions[i * 3 + 2]], out: Tri[] = [];
  for (let i = 0; i + 2 < b.indices.length; i += 3) {
    const t: Tri = [P(b.indices[i]), P(b.indices[i + 1]), P(b.indices[i + 2])], n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
    if (Math.hypot(n[0], n[1], n[2]) > 1e-12) out.push(t);
  }
  return out;
}

export function stlBytes(bodies: MeshBody[], name: string): { bytes: Uint8Array; tris: number } {
  const tris = bodies.flatMap(bodyTriangles), buf = new ArrayBuffer(84 + tris.length * 50), dv = new DataView(buf);
  const head = ('CADDY binary STL, millimeters: ' + name).slice(0, 80);
  for (let i = 0; i < head.length; i++) dv.setUint8(i, head.charCodeAt(i) & 0x7f);
  dv.setUint32(80, tris.length, true);
  let o = 84;
  tris.forEach((t) => {
    const c = cross(sub(t[1], t[0]), sub(t[2], t[0])), L = Math.hypot(c[0], c[1], c[2]) || 1, n: Vec3 = [c[0] / L, c[1] / L, c[2] / L];
    [n, t[0], t[1], t[2]].forEach((v) => { dv.setFloat32(o, v[0], true); dv.setFloat32(o + 4, v[1], true); dv.setFloat32(o + 8, v[2], true); o += 12; });
    dv.setUint16(o, 0, true);
    o += 2;
  });
  return { bytes: new Uint8Array(buf), tris: tris.length };
}

const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(u8: Uint8Array): number { let c = 0xffffffff; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
/** An uncompressed zip (3MF is a zip package). */
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder(), parts: Uint8Array[] = [], central: Uint8Array[] = [];
  let off = 0;
  files.forEach((f) => {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(12, 0x21, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, sz, true); lh.setUint32(22, sz, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, f.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(14, 0x21, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, sz, true); ch.setUint32(24, sz, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + sz;
  });
  const cd = central.reduce((s, a) => s + a.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cd, true); end.setUint32(16, off, true);
  const all = parts.concat(central, [new Uint8Array(end.buffer)]), out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
  let o = 0;
  all.forEach((a) => { out.set(a, o); o += a.length; });
  return out;
}

/** Corner points shared between triangles (3MF wants an indexed mesh; slicers need it watertight). */
export function indexedMesh(b: MeshBody): { verts: Vec3[]; tris: [number, number, number][] } {
  const map = new Map<string, number>(), verts: Vec3[] = [], tris: [number, number, number][] = [];
  const vi = (p: Vec3): number => { const k = p.map((x) => Math.round(x * 1e5)).join(','); let i = map.get(k); if (i === undefined) { i = verts.length; map.set(k, i); verts.push(p); } return i; };
  bodyTriangles(b).forEach((t) => { const a = vi(t[0]), c = vi(t[1]), d = vi(t[2]); if (a !== c && c !== d && a !== d) tris.push([a, c, d]); });
  return { verts, tris };
}

export function threeMFBytes(bodies: MeshBody[], name: string): { bytes: Uint8Array; tris: number } {
  const esc3 = (s: string): string => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
  const num = (v: number): string => { const s = v.toFixed(5).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };
  let objs = '', items = '', total = 0;
  bodies.forEach((b, bi) => {
    const { verts, tris } = indexedMesh(b);
    total += tris.length;
    objs += `<object id="${bi + 1}" type="model" name="${esc3(b.name)}"><mesh><vertices>` + verts.map((p) => `<vertex x="${num(p[0])}" y="${num(p[1])}" z="${num(p[2])}"/>`).join('') +
      `</vertices><triangles>` + tris.map((t) => `<triangle v1="${t[0]}" v2="${t[1]}" v3="${t[2]}"/>`).join('') + `</triangles></mesh></object>`;
    items += `<item objectid="${bi + 1}"/>`;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">${esc3(name)}</metadata><metadata name="Application">CADDY</metadata><resources>${objs}</resources><build>${items}</build></model>`;
  const types = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`;
  const rels = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
  const enc = new TextEncoder();
  return { bytes: zipStore([{ name: '[Content_Types].xml', data: enc.encode(types) }, { name: '_rels/.rels', data: enc.encode(rels) }, { name: '3D/3dmodel.model', data: enc.encode(model) }]), tris: total };
}

/** How finely curved faces are cut into triangles: chord error in mm, and angle between neighbors in radians. */
export const QUALITY = {
  Draft: { tolerance: 0.1, angularTolerance: 0.5 },
  Standard: { tolerance: 0.03, angularTolerance: 0.25 },
  Fine: { tolerance: 0.01, angularTolerance: 0.1 },
} as const;
export type QualityName = keyof typeof QUALITY;
