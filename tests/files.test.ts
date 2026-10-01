// Files: project round trip, opening real version 1 files from the prototype, and print/CAD exports
// re-read and checked (volume, watertight).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDate, bumpVersion, parseProject, safeName, serializeProject, uniqueName } from '../src/files/format';
import { bodyTriangles, indexedMesh, QUALITY, stlBytes, threeMFBytes, type MeshBody } from '../src/files/meshfiles';
import { buildModel, exportMeshes, exportStep } from '../src/kernel/model';
import { computeProfiles, featureSteps, resolveFrames } from '../src/model/steps';
import type { Feature } from '../src/model/types';
import { loadKernel } from './helpers/kernel';

beforeAll(loadKernel);

const v1 = (name: string): any => JSON.parse(readFileSync(new URL(`./fixtures/v1/${name}.caddy.json`, import.meta.url), 'utf8'));
/** Open a project the way the app does, and build it. */
function open(data: unknown): { features: Feature[]; steps: ReturnType<typeof featureSteps>; content: ReturnType<typeof parseProject> } {
  const content = parseProject(data);
  resolveFrames(content.features);
  computeProfiles(content.features);
  return { features: content.features, steps: featureSteps(content.features), content };
}
/** Exact volume of the plate fixture: 60 × 40 × 8 plate, Ø6 through hole, 15 × 20 × 3 pocket, R2 fillet and 1.5 chamfer on 40 mm edges. */
const PLATE = 60 * 40 * 8 - Math.PI * 9 * 8 - 15 * 20 * 3 - (4 - Math.PI) * 40 - (1.5 * 1.5 / 2) * 40;

function signedVolume(tris: ReturnType<typeof bodyTriangles>): number {
  let v = 0;
  tris.forEach(([a, b, c]) => { v += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]); });
  return v / 6;
}
/** Every edge must be used by exactly two triangles, once in each direction. */
function openEdges(tris: [number, number, number][]): number {
  const m = new Map<string, number>();
  tris.forEach((t) => { for (let i = 0; i < 3; i++) { const a = t[i], b = t[(i + 1) % 3]; m.set(a + '>' + b, (m.get(a + '>' + b) || 0) + 1); } });
  let bad = 0;
  m.forEach((n, k) => { const [a, b] = k.split('>'); if (n !== 1 || m.get(b + '>' + a) !== 1) bad++; });
  return bad;
}

describe('project files', () => {
  it('opens a version 1 file written by the prototype: same features, exact volume', () => {
    const { features, steps, content } = open(v1('plate-pocket-fillet'));
    expect(features.map((f) => f.type)).toEqual(['sketch', 'extrude', 'plane', 'sketch', 'extrude', 'fillet', 'fillet']);
    expect(content.bodies.map((b) => b.name)).toEqual(['Body1']);
    expect(content.counters).toMatchObject({ sketch: 2, extrude: 2, plane: 1, body: 1, fillet: 2 });
    const r = buildModel(steps);
    expect(r.steps.filter((s) => s.error)).toEqual([]);
    expect(r.bodies).toHaveLength(1);
    expect(r.bodies[0].volume).toBeCloseTo(PLATE, 5);
    // the prototype's faceted copy of the same part was a little smaller; the kernel's is exact
    expect(r.bodies[0].faces.filter((f) => !f.planar)).toHaveLength(2); // hole wall + fillet
  });

  it('opens a version 1 file with Revolve and Hole: exact washer minus the drilled hole', () => {
    const { features, steps } = open(v1('revolve-hole'));
    expect(features.map((f) => f.type)).toEqual(['sketch', 'revolve', 'hole']);
    const r = buildModel(steps);
    expect(r.steps.filter((s) => s.error)).toEqual([]);
    expect(r.bodies[0].volume).toBeCloseTo(Math.PI * 300 * 5 - Math.PI * 4 * 5, 5);
  });

  it('round-trips: save as version 2, open again, identical model', () => {
    const first = open(v1('plate-pocket-fillet'));
    first.features.filter((f) => f.type === 'sketch').forEach((s, i) => { if (s.type === 'sketch') s.hist = ['snapshot-' + i]; });
    const saved = serializeProject({ id: 'prj-x', name: 'Round trip', created: 5 }, { features: first.features, bodies: first.content.bodies, counters: first.content.counters, originPlanesVisible: true }, { theta: 1, phi: 0.5, r: 300, target: [1, 2, 3] });
    expect(saved.version).toBe(2);
    const text = JSON.stringify(saved);
    expect(text).not.toMatch(/"profiles"|"frame":\{"o":\[0,0,8\]|"status"|"error"/); // nothing computed is saved, only the recipe
    const again = open(JSON.parse(text));
    expect(again.content).toMatchObject({ id: 'prj-x', name: 'Round trip', created: 5, originPlanesVisible: true, view: { theta: 1, phi: 0.5, r: 300, target: [1, 2, 3] } });
    expect(again.features.map((f) => [f.id, f.type, f.name])).toEqual(first.features.map((f) => [f.id, f.type, f.name]));
    const sk = again.features[0];
    expect(sk.type === 'sketch' && sk.hist).toEqual(['snapshot-0']); // sketch undo history travels with the file
    expect(buildModel(again.steps).bodies[0].volume).toBeCloseTo(PLATE, 5);
  });

  it('rejects files that are not CADDY projects, and skips unknown feature types instead of failing', () => {
    expect(() => parseProject({ hello: 1 })).toThrow('not a CADDY project');
    expect(() => parseProject(null)).toThrow();
    const d = v1('plate-pocket-fillet');
    d.features.push({ id: 'z1', type: 'from-the-future', name: 'X', params: {} });
    expect(parseProject(d).features).toHaveLength(7);
  });

  it('file name helpers', () => {
    expect(bumpVersion('Bracket')).toBe('Bracket v2');
    expect(bumpVersion('Bracket v2')).toBe('Bracket v3');
    expect(bumpVersion('Bracket-v9')).toBe('Bracket-v10');
    expect(addDate('Bracket', new Date(2026, 9, 1))).toBe('Bracket 2026-10-01');
    expect(addDate('Bracket 2026-10-01', new Date(2026, 9, 1))).toBe('Bracket 2026-10-01');
    expect(safeName('a/b:c*?"<>|d')).toBe('a b c d');
    expect(uniqueName('Part', ['Part', 'Part (2)'])).toBe('Part (3)');
  });
});

describe('exports', () => {
  const meshes = (q: keyof typeof QUALITY = 'Fine'): MeshBody[] => exportMeshes(open(v1('plate-pocket-fillet')).steps, QUALITY[q], null).map((m) => ({ name: 'Body1', positions: m.positions, indices: m.indices }));

  it('STL: valid binary file, triangle count in the header, volume matches the body', () => {
    const { bytes, tris } = stlBytes(meshes(), 'Plate');
    expect(bytes.length).toBe(84 + tris * 50);
    const dv = new DataView(bytes.buffer);
    expect(dv.getUint32(80, true)).toBe(tris);
    expect(new TextDecoder().decode(bytes.slice(0, 30))).toBe('CADDY binary STL, millimeters:');
    // re-read the triangles from the file itself
    const read: ReturnType<typeof bodyTriangles> = [];
    for (let i = 0, o = 84; i < tris; i++, o += 50) read.push([0, 1, 2].map((k) => [dv.getFloat32(o + 12 + k * 12, true), dv.getFloat32(o + 16 + k * 12, true), dv.getFloat32(o + 20 + k * 12, true)]) as any);
    expect(Math.abs(signedVolume(read) - PLATE) / PLATE).toBeLessThan(0.001); // curved faces are faceted in a mesh; Fine keeps it within 0.1 %
    expect(signedVolume(read)).toBeGreaterThan(0); // outward-facing triangles
  });

  it('3MF: valid package, millimeters, one named object per body, every edge shared by exactly two triangles', () => {
    const steps = open(v1('plate-pocket-fillet')).steps;
    const two = exportMeshes(steps, QUALITY.Fine, null).map((m) => ({ name: 'Plate & <holes>', positions: m.positions, indices: m.indices }));
    const { bytes, tris } = threeMFBytes(two, 'Plate');
    const text = new TextDecoder().decode(bytes);
    expect(bytes[0]).toBe(0x50); expect(bytes[1]).toBe(0x4b); // zip signature
    for (const part of ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']) expect(text).toContain(part);
    expect(text).toContain('<model unit="millimeter"');
    expect(text).toContain('name="Plate &amp; &lt;holes&gt;"');
    expect((text.match(/<object /g) || []).length).toBe(1);
    expect((text.match(/<triangle /g) || []).length).toBe(tris);
    const im = indexedMesh(two[0]);
    expect(openEdges(im.tris)).toBe(0); // watertight
    expect(Math.abs(signedVolume(im.tris.map((t) => t.map((i) => im.verts[i]) as any)) - PLATE) / PLATE).toBeLessThan(0.001);
  });

  it('quality setting: finer means more triangles and a volume closer to exact', () => {
    const vol = (q: keyof typeof QUALITY): { n: number; err: number } => { const t = meshes(q).flatMap(bodyTriangles); return { n: t.length, err: Math.abs(signedVolume(t) - PLATE) }; };
    const d = vol('Draft'), s = vol('Standard'), f = vol('Fine');
    expect(d.n).toBeLessThan(s.n); expect(s.n).toBeLessThan(f.n);
    expect(f.err).toBeLessThan(d.err);
    for (const q of ['Draft', 'Standard', 'Fine'] as const) expect(openEdges(indexedMesh(meshes(q)[0]).tris)).toBe(0);
  });

  it('STEP: exact geometry for other CAD programs (true cylinder, millimeters, named body)', async () => {
    const bytes = await exportStep(open(v1('plate-pocket-fillet')).steps, [{ id: 'b1', name: 'Plate body' }]);
    const text = new TextDecoder().decode(bytes);
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toContain('CYLINDRICAL_SURFACE');
    expect(text).toContain('MANIFOLD_SOLID_BREP');
    expect(text).toMatch(/SI_UNIT\(\s*\.MILLI\.\s*,\s*\.METRE\.\s*\)/);
    expect(text).toContain('Plate body');
  });
});
