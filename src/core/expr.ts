/** Parses what the user types into a value box: numbers with + − * / ( ), optional "mm". Null if invalid. */
export function parseExpr(src: string): number | null {
  const s = String(src).toLowerCase().replace(/mm/g, '').replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/,/g, '.');
  if (!s.trim()) return null;
  let i = 0;
  const peek = (): string | undefined => { while (s[i] === ' ') i++; return s[i]; };
  const num = (): number => {
    peek();
    const m = /^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));
    if (!m) throw new Error('number expected');
    i += m[0].length;
    return parseFloat(m[0]);
  };
  const factor = (): number => {
    const c = peek();
    if (c === '-') { i++; return -factor(); }
    if (c === '+') { i++; return factor(); }
    if (c === '(') {
      i++;
      const v = expr();
      if (peek() !== ')') throw new Error(') expected');
      i++;
      return v;
    }
    return num();
  };
  const term = (): number => {
    let v = factor();
    for (;;) {
      const c = peek();
      if (c === '*') { i++; v *= factor(); }
      else if (c === '/') { i++; const q = factor(); if (q === 0) throw new Error('divide by zero'); v /= q; }
      else return v;
    }
  };
  const expr = (): number => {
    let v = term();
    for (;;) {
      const c = peek();
      if (c === '+') { i++; v += term(); }
      else if (c === '-') { i++; v -= term(); }
      else return v;
    }
  };
  try {
    const v = expr();
    if (peek() !== undefined) return null;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}
