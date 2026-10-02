const fs = require('fs');
function rep(f, pairs) { let t = fs.readFileSync(f, 'utf8'); const crlf = t.includes('\r\n'); const fix = (s) => crlf ? s.replace(/\r?\n/g, '\r\n') : s.replace(/\r\n/g, '\n'); for (const [a0, b0] of pairs) { const a = fix(a0), b = fix(b0); if (!t.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 80)); t = t.replace(a, () => b); } fs.writeFileSync(f, t); }

rep('src/kernel/model.ts', [
  [`import { Scope, tup } from './scope';`, `import { offsetShape, splitBody } from './bodyops';\nimport { Scope, tup } from './scope';`],
  [`  const toolCache = new Map<string, ToolRec[]>();`, `  const toolCache = new Map<string, ToolRec[]>();
  /** Bodies a Combine has used up. */
  const consumed = new Set<string>();`],
  [`  return { bodies, results, run, setScope:`, `  return { bodies, results, run, consumed, setScope:`],
  [`function runSteps(steps: BuildStep[], sc: Scope): { bodies: BodyState[]; results: StepResult[] } {
  const r = makeRunner(steps, sc);
  r.run(steps);
  return { bodies: r.bodies.filter((b) => b.shape), results: r.results };
}`, `function runSteps(steps: BuildStep[], sc: Scope): { bodies: BodyState[]; results: StepResult[]; consumed: string[] } {
  const r = makeRunner(steps, sc);
  r.run(steps);
  return { bodies: r.bodies.filter((b) => b.shape), results: r.results, consumed: [...r.consumed] };
}

/** A copy's faces carry the original's tags (optionally marked), matched by their order. */
function remapTags(orig: Shape3D, copy: Shape3D, tags: Map<string, string>, mark: string | null, sc: Scope): Map<string, string> {
  const a = sc.all(orig.faces), b = sc.all(copy.faces), out = new Map<string, string>();
  if (a.length !== b.length) return out;
  a.forEach((f, i) => { const t = tags.get(signature(f)); if (t) out.set(signature(b[i]), mark ? mark + '|' + t : t); });
  return out;
}`],
  [`    const { bodies, results } = runSteps(steps, sc);
    return { bodies: bodies.map((b) => bodyResult(b, sc)), steps: results };`, `    const { bodies, results, consumed } = runSteps(steps, sc);
    return { bodies: bodies.map((b) => bodyResult(b, sc)), steps: results, consumed };`],
  [`steps: runner.results.slice() } };`, `steps: runner.results.slice(), consumed: [...runner.consumed] } };`],
  [`  const saved = R.bodies.map((b) => ({ b, shape: b.shape, tags: b.tags, keeps: b.keeps })), nBodies = R.bodies.length, nRes = R.results.length;`, `  const saved = R.bodies.map((b) => ({ b, shape: b.shape, tags: b.tags, keeps: b.keeps })), nBodies = R.bodies.length, nRes = R.results.length, consumedBefore = new Set(R.consumed);
  let gone = new Set<string>();`],
  [`      bodies = full.bodies; step = full.results[full.results.length - 1];`, `      bodies = full.bodies; step = full.results[full.results.length - 1]; gone = full.consumed;`],
  [`      bodies = R.bodies; step = R.results[R.results.length - 1];
    }`, `      bodies = R.bodies; step = R.results[R.results.length - 1]; gone = new Set(R.consumed);
    }`],
  [`        if (!b) { removed.push(meshBody(a.shape)); return; }`, `        if (!b) { if (!gone.has(a.id)) removed.push(meshBody(a.shape)); return; } // a body a Combine used up is not "removed" matter`],
  [`    R.forget(draft.id);`, `    R.forget(draft.id);
    R.consumed.clear(); consumedBefore.forEach((x) => R.consumed.add(x));`],
  [`      } else if (st.kind === 'thread') {`, `      } else if (st.kind === 'combine') {
        const T = st.target ? bodies.find((x) => x.id === st.target) : null;
        if (!st.target) { res.error = true; res.note = 'click the body to keep'; continue; }
        if (!T || !T.shape) { res.error = true; res.note = 'its first body is gone'; continue; }
        if (!st.tools.length) { res.error = true; res.note = 'click the bodies to ' + (st.operation === 'Join' ? 'join to it' : st.operation === 'Cut' ? 'cut from it' : 'intersect with it'); continue; }
        const tools = st.tools.map((id) => bodies.find((x) => x.id === id)).filter((x): x is BodyState => !!x && !!x.shape && x !== T);
        if (tools.length < st.tools.length) { res.error = true; res.note = (st.tools.length - tools.length) + ' of its bodies are gone'; continue; }
        let shape: Shape3D = T.shape, tags = T.tags, keeps = T.keeps.slice();
        for (const tool of tools) {
          keeps = keeps.concat(tool.keeps);
          const op = st.operation === 'Join' ? 'fuse' : st.operation === 'Cut' ? 'cut' : 'common';
          const out: Shape3D = keeps.length ? keep(unifyKeeping(sc.add(rawBoolean(op, shape, tool.shape!)), keeps, sc)) : keep(op === 'fuse' ? shape.fuse(tool.shape!) : op === 'cut' ? shape.cut(tool.shape!) : shape.intersect(tool.shape!));
          if (!(measureVolume(out) > 1e-9)) { res.error = true; res.note = st.operation === 'Intersect' ? 'the bodies do not overlap' : 'nothing is left of the body'; break; }
          tags = retag(out, tags, tool.tags, () => st.id + ':c', sc);
          shape = out;
        }
        if (res.error) continue;
        T.shape = shape; T.tags = tags; T.keeps = keeps;
        if (!st.keepTools) tools.forEach((x) => { x.shape = null; consumed.add(x.id); });
      } else if (st.kind === 'transform') {
        const src = st.bodies.map((id) => bodies.find((x) => x.id === id)).filter((x): x is BodyState => !!x && !!x.shape);
        if (!st.bodies.length) { res.error = true; res.note = 'click the bodies to move'; continue; }
        if (src.length < st.bodies.length) { res.error = true; res.note = (st.bodies.length - src.length) + ' of its bodies are gone'; continue; }
        if (!(st.scale > 0)) { res.error = true; res.note = 'the scale needs to be more than 0 %'; continue; }
        let lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
        src.forEach((b) => { const [l, h] = boxOf(b.shape!); lo = lo.map((v, i) => Math.min(v, l[i])) as Vec3; hi = hi.map((v, i) => Math.max(v, h[i])) as Vec3; });
        const pivot: Vec3 = st.pivot === 'origin' ? [0, 0, 0] : [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
        let rot: { axis: Vec3; deg: number } | null = Math.abs(st.rotDeg) > 1e-9 ? { axis: st.rotAxis, deg: st.rotDeg } : null, scale = st.scale;
        if (st.mode === 'lay') {
          // turn the picked flat face to point down
          const owner = st.lay ? src.find((x) => x.id === st.lay!.bodyId) : null;
          if (!st.lay) { res.error = true; res.note = 'click the flat face to lay down'; continue; }
          if (!owner) { res.error = true; res.note = 'the picked face is not on one of the bodies'; continue; }
          const f = matchFace(owner.shape!, st.lay, owner.tags, sc);
          if (!f) { res.error = true; res.note = 'its face is gone'; continue; }
          if (f.geomType !== 'PLANE') { res.error = true; res.note = 'lay a flat face down'; continue; }
          const fn = vnorm(tup(f.normalAt())), cr = vcross(fn, [0, 0, -1]), s = vlen(cr);
          rot = s > 1e-9 ? { axis: vnorm(cr), deg: (Math.atan2(s, -fn[2]) * 180) / Math.PI } : fn[2] > 0 ? { axis: [1, 0, 0], deg: 180 } : null;
          scale = 1;
        }
        const turned = src.map((b) => {
          let r: Shape3D = b.shape!.clone();
          if (scale !== 1) r = r.scale(scale, pivot);
          if (rot) r = r.rotate(rot.deg, pivot, rot.axis);
          return keep(r);
        });
        let move: Vec3 = st.move;
        if (st.mode === 'lay') move = [0, 0, -Math.min(...turned.map((m) => boxOf(m)[0][2]))]; // down onto the build plate
        let slot = 0, short = 0;
        turned.forEach((m, i) => {
          const b = src[i], out: Shape3D = vlen(move) > 1e-12 ? keep(m.clone().translate(move)) : m, tags = remapTags(b.shape!, out, b.tags, null, sc);
          if (st.copy && st.mode !== 'lay') {
            const nid = st.bodyIds[slot++];
            if (!nid) { short++; return; }
            const nb = body(nid);
            nb.shape = out; nb.tags = new Map([...tags].map(([k, v]) => [k, st.id + '|' + v])); nb.keeps = [];
          } else { b.shape = out; b.tags = tags; b.keeps = []; }
        });
        if (short) { res.error = true; res.note = 'its copies are not set up yet'; continue; }
        if (st.mode === 'lay') { const h = Math.max(...turned.map((m) => boxOf(m)[1][2])) + move[2]; res.info = 'Laid on its face, ' + Math.round(h * 100) / 100 + ' mm tall'; }
      } else if (st.kind === 'split') {
        const b = st.body ? bodies.find((x) => x.id === st.body) : null;
        if (!st.body) { res.error = true; res.note = 'click the body to split'; continue; }
        if (!b || !b.shape) { res.error = true; res.note = 'its body is gone'; continue; }
        if (!st.plane) { res.error = true; res.note = 'its splitting plane is gone'; continue; }
        const nid = st.bodyIds[0];
        if (!nid) { res.error = true; res.note = 'its new body is not set up yet'; continue; }
        let r: ReturnType<typeof splitBody>;
        try { r = splitBody(b.shape, st.plane, { type: st.keys, size: st.keySize, count: st.keyCount, depth: st.keyDepth, clearance: st.clearance }, sc); }
        catch (e) { res.error = true; res.note = errText(e); continue; }
        const cutTag = () => st.id + ':cut';
        b.tags = retag(r.pos, b.tags, null, cutTag, sc);
        const nb = body(nid);
        nb.tags = retag(r.neg, new Map(), null, cutTag, sc);
        nb.shape = r.neg; nb.keeps = [];
        b.shape = r.pos; b.keeps = [];
        res.info = r.info;
      } else if (st.kind === 'offsetbody') {
        const src = st.bodies.map((id) => bodies.find((x) => x.id === id)).filter((x): x is BodyState => !!x && !!x.shape);
        if (!st.bodies.length) { res.error = true; res.note = 'click the bodies to offset'; continue; }
        if (src.length < st.bodies.length) { res.error = true; res.note = (st.bodies.length - src.length) + ' of its bodies are gone'; continue; }
        if (Math.abs(st.distance) < 1e-6) { res.error = true; res.note = 'the distance is 0'; continue; }
        let slot = 0, bad = '';
        for (const b of src) {
          let out: Shape3D;
          try { out = offsetShape(b.shape!, st.distance, st.sharp, sc); } catch { bad = st.distance < 0 ? 'that is more than the body can shrink by' : 'the geometry engine could not grow the body by that much'; break; }
          if (!(measureVolume(out) > 1e-9)) { bad = 'that is more than the body can shrink by'; break; }
          if (st.copy) {
            const nid = st.bodyIds[slot++];
            if (!nid) { bad = 'its copies are not set up yet'; break; }
            const nb = body(nid);
            nb.shape = out; nb.tags = retag(out, new Map(), null, () => st.id + ':o', sc); nb.keeps = [];
          } else { b.tags = retag(out, new Map(), null, () => st.id + ':o', sc); b.shape = out; b.keeps = []; }
        }
        if (bad) { res.error = true; res.note = bad; continue; }
      } else if (st.kind === 'thread') {`],
]);
