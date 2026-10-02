const fs = require('fs');
function rep(f, pairs) { let t = fs.readFileSync(f, 'utf8'); const crlf = t.includes('\r\n'); const fix = (s) => crlf ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n'); for (const [a0, b0] of pairs) { const a = fix(a0), b = fix(b0); if (!t.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 80)); t = t.replace(a, () => b); } fs.writeFileSync(f, t); }

rep('src/kernel/sweep.ts', [[`function slab(C: Vec3, m: Vec3, S: number, sc: Scope): Shape3D {`, `export function slab(C: Vec3, m: Vec3, S: number, sc: Scope): Shape3D {`]]);

rep('src/model/types.ts', [
  [`'shell' | 'pattern' | 'mirror' | 'text' | 'thread';`, `'shell' | 'pattern' | 'mirror' | 'text' | 'thread' | 'combine' | 'transform' | 'split' | 'offsetbody';`],
  [`'pattern' | 'mirror' | 'text' | 'thread', number>;`, `'pattern' | 'mirror' | 'text' | 'thread' | 'combine' | 'transform' | 'split' | 'offsetbody', number>;`],
  [`mirror: 0, text: 0, thread: 0 });`, `mirror: 0, text: 0, thread: 0, combine: 0, transform: 0, split: 0, offsetbody: 0 });`],
]);
rep('src/files/format.ts', [[`'mirror', 'text', 'thread']);`, `'mirror', 'text', 'thread', 'combine', 'transform', 'split', 'offsetbody']);`]]);

rep('src/kernel/protocol.ts', [
  [`export interface BuildResult { bodies: BodyResult[]; steps: StepResult[] }`, `/** consumed: bodies a Combine used up (they are gone from the model, and from the Browser). */
export interface BuildResult { bodies: BodyResult[]; steps: StepResult[]; consumed: string[] }`],
  [`  | {
      kind: 'thread';`, `  | {
      kind: 'combine';
      id: string;
      /** The body that is kept, and the bodies used on it. */
      target: string | null;
      tools: string[];
      operation: 'Join' | 'Cut' | 'Intersect';
      /** Keep the tool bodies after combining (Cut and Intersect often want this). */
      keepTools: boolean;
    }
  | {
      kind: 'transform';
      id: string;
      bodies: string[];
      /** 'free': scale, then turn, then move. 'lay': turn so the picked face is the bottom, and sit on the build plate. */
      mode: 'free' | 'lay';
      move: Vec3;
      /** Turn about this axis (a direction) through the pivot. */
      rotAxis: Vec3;
      rotDeg: number;
      /** 1 = unchanged. */
      scale: number;
      pivot: 'body' | 'origin';
      /** Leave the originals and make copies. */
      copy: boolean;
      lay: FaceSpec | null;
      bodyIds: string[];
    }
  | {
      kind: 'split';
      id: string;
      body: string | null;
      plane: { o: Vec3; n: Vec3 } | null;
      keys: 'None' | 'Pins' | 'Rib' | 'Dovetail';
      keySize: number;
      keyCount: number;
      keyDepth: number;
      clearance: number;
      /** The new body (the side the plane's normal points away from). */
      bodyIds: string[];
    }
  | {
      kind: 'offsetbody';
      id: string;
      bodies: string[];
      /** Positive grows the body, negative shrinks it. */
      distance: number;
      sharp: boolean;
      copy: boolean;
      bodyIds: string[];
    }
  | {
      kind: 'thread';`],
]);

rep('src/model/steps.ts', [[`  if (f.type === 'thread') {`, `  if (f.type === 'combine') {
    const P = f.params as any;
    return { kind: 'combine', id: f.id, target: P.target || null, tools: P.tools || [], operation: P.operation === 'Cut' ? 'Cut' : P.operation === 'Intersect' ? 'Intersect' : 'Join', keepTools: !!P.keepTools };
  }
  if (f.type === 'transform') {
    const P = f.params as any, ax: Vec3 = P.rotAxis === 'X' ? [1, 0, 0] : P.rotAxis === 'Y' ? [0, 1, 0] : [0, 0, 1];
    return { kind: 'transform', id: f.id, bodies: P.bodies || [], mode: P.mode === 'Lay a face down' ? 'lay' : 'free', move: [+P.x || 0, +P.y || 0, +P.z || 0], rotAxis: ax, rotDeg: +P.angle || 0, scale: (+P.scale || 100) / 100, pivot: P.pivot === 'Origin' ? 'origin' : 'body', copy: P.copy === 'Copy', lay: P.face || null, bodyIds: (f.bodyIds as string[]) || [] };
  }
  if (f.type === 'split') {
    const P = f.params as any, fr = resolveRefIn(features, P.ref);
    return { kind: 'split', id: f.id, body: P.body || null, plane: fr ? { o: fr.o, n: fr.n } : null, keys: P.keys || 'None', keySize: +P.keySize || 0, keyCount: +P.keyCount || 1, keyDepth: +P.keyDepth || 0, clearance: +P.clearance || 0, bodyIds: (f.bodyIds as string[]) || [] };
  }
  if (f.type === 'offsetbody') {
    const P = f.params as any;
    return { kind: 'offsetbody', id: f.id, bodies: P.bodies || [], distance: +P.distance || 0, sharp: P.corners !== 'Round', copy: P.result === 'New body', bodyIds: (f.bodyIds as string[]) || [] };
  }
  if (f.type === 'thread') {`]]);
