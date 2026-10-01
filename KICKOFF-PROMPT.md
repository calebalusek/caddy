Hi! This folder contains everything about CADDY, a browser-based parametric CAD app for 3D printing
that I've been designing with Claude in claude.ai. We're moving it here to rebuild it properly.

Please:
1. Read `CLAUDE.md`, then `docs/SPEC.md`, `docs/HISTORY.md` and `docs/ACCEPTANCE-TESTS.md`.
2. Look through `reference/caddy-prototype-source.js` and open `reference/caddy-prototype.html` in a
   browser (e.g. with Playwright) so you see how everything looks and behaves.
3. Propose a step-by-step plan to rebuild CADDY as a TypeScript + Vite web app on OpenCascade.js
   (or replicad) running in a Web Worker, with three.js rendering — matching the prototype's tools,
   UI and my standing rules, and passing the acceptance tests. Suggest the order (I'd like the core
   sketch → extrude → fillet → save/export loop working first), how you'll test, and anything you
   recommend changing.
4. Don't start building until I approve the plan. Set up git from the start and commit each working step.

Keep explanations plain and short — what changed, what you tested, what's next.
