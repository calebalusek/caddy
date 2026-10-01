# CADDY — Rebuild plan (approved 2026-09-30)

Rebuild the prototype in `reference/` as a TypeScript + Vite web app on a real geometry kernel.
Each step ends with tests passing and a git commit.

## Steps

| # | Step | What it delivers |
|---|---|---|
| 0 | Setup | Git repo with the handoff committed as-is. Vite + TypeScript project. Kernel running in a Web Worker, proven by a box with an exact volume. |
| 1 | App shell | Top bar, toolbar, Browser, History, command bar, ViewCube, themes, grid, Design-view lighting. One shared tool-menu system (dock right, drag, remember, re-dock). |
| 2 | Sketcher | The prototype's sketch model, solver, snaps, tracking, dimensions and profile finding, ported to TypeScript. |
| 3 | Extrude + Fillet/Chamfer | Real solids with true curves; timeline rebuilds in the worker. One shared selection system (hover orange / selected blue, Browser + History picking). |
| 4 | Files | Autosave, project library, `.caddy.json` (opens v1), Save window with real Save As, STL / 3MF / STEP export. |
| — | **Checkpoint** | Core loop done: sketch → extrude → fillet → save, open, export. Owner reviews. |
| 5 | Revolve, Hole, Offset plane, Sketch on face | Face snaps that follow the body when it changes. |
| 6 | Sweep | Round and Mitered corners, section lines, one selectable face per section. |
| 7 | Shell, Pattern | Including Fit to edges and circular radius. |
| 8 | Render view | 20 materials and studio lighting. |
| 9 | Offline install + publish | Installable PWA, hosted on a static host (GitHub planned). |
| 10 | Placeholders | Mirror, Overhang check, Text, Thread — order chosen by the owner. |

Progress notes
- Step 0 done. Step 1 done; **Offset plane moved up from step 5 into step 1** so the tool-menu
  system and plane picking could be tested with a real tool.
- Steps 2, 3 and 4 done (2026-10-01). **Checkpoint 1 reached**: sketch → extrude → fillet → save,
  open, export. Screenshots in `docs/checkpoint-1/`.
- Owner feedback after checkpoint 1: STL export checked in a slicer, good. Added the Fillet/Chamfer
  size arrow and step-back Ctrl+Z. Step 5 done (Revolve, Hole, sketch on face).
- Step 6 done: Sweep with Round and Mitered corners, section lines, exact volumes
  (screenshots in `docs/checkpoint-3/`).
- Step 7 done: Shell (inside/outside/closed hollow) and Pattern (rectangular, fit to edges, circular, bodies).
- Step 8 done: Render view and 20 materials (screenshots in `docs/checkpoint-5/`).
- Steps 9 and 10 done: published on GitHub Pages; Mirror, Overhang check, Text and Thread built
  (screenshots in `docs/checkpoint-6/`).
- Measured: the geometry engine is a 23 MB download (7.3 MB compressed), loaded once in the
  background, then cached.

## Testing
- **Geometry**: every line in `ACCEPTANCE-TESTS.md` is an automated test comparing the kernel's exact
  volume to the formula. Exports are re-read and checked for volume and watertightness.
- **Sketch solver**: unit tests, including sketch-on-face snap positions.
- **UI**: Playwright with real WebGL and real clicks; pixel-color checks for orange hover and blue
  selection; tool menus checked at 1400 / 1100 / 900 px.
- **Old files**: one v1 file per feature type saved from the prototype; the rebuild must open each
  with the same volumes.

## Agreed decisions
1. **replicad on top of OpenCascade.js**, dropping to the raw kernel where needed.
2. **No UI framework**: plain TypeScript modules reusing the prototype's HTML and CSS.
3. **Face/edge tracking**: kernel history first, the prototype's geometric matching as fallback; if
   neither is sure, the feature shows a warning instead of guessing.
4. **Export quality setting** for STL/3MF (default Fine).
5. **Sweep Round corners** keep the prototype's rule (round the path first, then sweep).
6. **Loading screen** on first open while the kernel downloads; cached and offline afterwards.
7. Fix the known prototype limits along the way: arcs splitting lines for profiles, clean fillet
   corners, undo history saved with the project.

## Environment
- Primary browser: **Chrome** (real Save As via the File System Access API).
- Git is local for now; GitHub repo planned later (also the likely host).
