# CADDY — project memory for Claude Code

Read this file at the start of every session. It carries the standing rules and context from the
original design conversations in claude.ai. Details live in `docs/` and the working prototype in
`reference/`.

## What CADDY is
A browser-based, parametric 3D CAD app in the spirit of Fusion 360 / SolidWorks, aimed at designing
parts for **3D printing**. Built for the owner and other people to use.
- **Web app only** (no App Store). Desktop first; an iPad version comes later.
- **No accounts, no cloud sync.** Projects live on the user's device (IndexedDB autosave) and are
  shared as files (`.caddy.json`) by email / AirDrop / Files app.
- Name **CADDY**, favicon 🧊, font **Barlow**.

## Where things stand
- `reference/caddy-prototype.html` is a complete, working single-file prototype (three.js r128 +
  a custom mesh/BSP geometry engine written from scratch). Open it in a browser to see exactly how
  every tool should look and behave. `reference/caddy-prototype-source.js` is the same code, readable.
- The prototype is the **behavioral blueprint**. The job now is to rebuild CADDY properly on a real
  geometry kernel while matching (and improving on) everything the prototype does.

- The rebuild follows `docs/PLAN.md` (approved 2026-09-30). Update this list as steps finish.
  - **Step 0 done**: Vite + TypeScript, replicad/OpenCascade in a Web Worker (`src/kernel/`), tests.
  - **Step 1 done**: app shell (`src/ui/`, `src/view/`), shared tool-menu system
    (`src/tools/dialog.ts`, `src/ui/panel.ts`), plane picking, Offset plane as the first tool.
  - **Step 2 done**: sketcher (`src/sketch/`): solver, tools, snaps, tracking, dimensions,
    constraints, offset/move/trim, ported from the prototype. Profiles are now exact
    (`src/sketch/profiles.ts`): lines, arcs and circles split each other and keep true arc edges.
- Tools not rebuilt yet say which step brings them back (`step` in `src/app/commands.ts`).

## How the rebuild is organised
- `src/model/` plain data + math (no three.js, no DOM) so it runs in Node tests and the worker.
- `src/app/` state, commands, regenerate (timeline rebuild), history (delete/undo/new).
- `src/tools/` one file per tool; each registers a `ToolDef` with `registerTool` and gets the menu,
  docking, value-starts-at-0, drag arrow, Enter/Esc for free.
- `src/view/` three.js scene. It keeps the prototype's r128 color pipeline on purpose
  (`ColorManagement` off, light intensities × π) so the approved Design-view look is identical.
- `src/styles/app.css` is the prototype's CSS; rebuild-only rules go at the bottom.
- Deliberate differences from the prototype: hovering a plane is orange (rule 1; the prototype used
  blue), the toolbar button stays lit only while its tool is open, the Origin group opens by itself
  while a tool asks for a plane, the geometry engine loads in the background.

## Commands
- `npm run dev` — run the app at http://localhost:5173
- `npm test` — geometry tests (real kernel in Node, exact numbers)
- `npm run test:ui` — Playwright in installed Chrome with real WebGL
- `npm run build` — typecheck + production build into `dist/`
- Node and Git were installed with winget; a fresh shell may need
  `C:\Program Files\nodejs` and `C:\Program Files\Git\cmd` on PATH.
- Commit after each working step. Git is local for now; a GitHub repo is planned.

## Target architecture (agreed)
- **TypeScript + Vite**, static site (host on GitHub Pages / Netlify / Cloudflare Pages), installable
  PWA that works offline after first load.
- **Geometry kernel: OpenCascade.js** (OCCT compiled to WebAssembly). Consider **replicad** as a
  friendlier wrapper. Run the kernel in a **Web Worker** so the UI never freezes.
- **Rendering: three.js** (modern version). Tessellate B-rep faces for display; keep face/edge identity.
- Port the prototype's **sketch constraint solver** (Levenberg–Marquardt, DOF analysis, redundancy
  rejection) and **snap/tracking** logic; they are kernel-independent.
- Keep the **feature timeline** model: every feature stores parameters; the model regenerates from
  the timeline; edits are parametric.
- File format: `.caddy.json` (stores features, sketches, counters, view; no mesh). Bump to version 2
  if needed but keep the ability to open version 1 files from the prototype.
- Exports: **plain STL and 3MF files** (no zip wrapper outside claude.ai), real **Save As** via the
  File System Access API where available; add **STEP** export (OCCT supports it).

## The owner's standing rules (apply to every current AND future tool)
1. **Hover = orange, selected = bold blue. Everywhere.** Anything that can be selected glows
   orange on hover; once selected it shows in bold blue (thick screen-space band for edges and
   lines, darker blue fill for faces, big blue dots for points).
2. **Pick from the browser and History too.** If a tool lets you select something, the user can
   also click it in the **Browser** panel (bodies, sketches) or the **History/timeline** bar
   (features). Clicking it again removes it. When no tool is open, those panels behave normally.
3. **Values start at 0** each time a tool opens (distances, radius, offsets, diameters).
   Counts start at a sensible minimum (2), angles at 360° where that is the natural default.
4. **Tool menus dock flush against the right edge** of the viewport (square corners on the docked
   side), below the ViewCube. The user can **drag a menu by its title bar** anywhere; the position
   is **remembered for every tool** across sessions; double-click the title bar to re-dock.
   Menus must never be cut off on smaller windows.
5. **Outside sketch editing, a sketch is one object**: hovering or clicking any part of it selects
   the whole sketch (no single lines/regions). Double-click to edit it. Individual curves/points
   are only pickable inside tools that need them (sweep path, revolve axis, hole points).
6. **Edge lines are crisp and accurate**: draw every real crease and every boundary between
   different faces/sections (e.g. where a sweep changes from straight to curved). Each section is
   its own selectable face.
7. **Never leave ghosts**: creating/opening a file clears every selection, highlight and preview.
8. **Look professional**: modern, theme-matched UI; orange scroll thumb in tool menus; slim
   theme-matched scrollbars elsewhere; clear, short status messages; no dead buttons without an
   explanation.
9. **Safety with printers**: no G-code / slicer features yet (parked). If ever built, use proven
   engines, conservative per-printer profiles and a mandatory preview.

## How the owner likes to work
- Describes changes in plain English, often with **screenshots**. Treat a screenshot as the bug
  report: find the real cause, explain it in one or two plain sentences, fix it, verify, report.
- Wants **fast iteration** and honest explanations (what was wrong, what changed, what was tested).
  No jargon dumps; short sections, plain language.
- For big changes, **lay out the plan first** (what changes, what stays, trade-offs) and confirm.
- **Test everything** you change. The prototype work verified geometry against exact math
  (volumes, positions) and UI with real clicks — keep that standard (see `docs/ACCEPTANCE-TESTS.md`).
  Run the app with real WebGL (e.g. Playwright) to check how things look, not just that they run.
- The owner is an engineer comfortable with AutoCAD/Civil 3D-style command lines and Fusion 360.

## Key files
- `docs/SPEC.md` — every tool, dialog field, UI element, color, shortcut and file format.
- `docs/HISTORY.md` — decisions and requests from the design conversations, in order.
- `docs/ACCEPTANCE-TESTS.md` — numeric checks the rebuild must pass.
- `reference/` — the working prototype (source of truth for behavior).

## Parked ideas (do not start without the owner)
- Built-in **slicer / G-code** and sending jobs to printers.
- **iPad version** (planned after desktop is solid): same flows, touch-sized targets, Apple Pencil
  sketching, and saving through the **Files app** (the save window should lead into Files).
