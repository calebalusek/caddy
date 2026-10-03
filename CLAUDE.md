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
  - **Step 3 done**: bodies on the real kernel. `src/kernel/model.ts` builds every body from the
    timeline (exact B-rep), `src/app/solids.ts` runs it in the worker, `src/view/bodies.ts` shows
    it. Extrude (regions, press-pull, auto Join/Cut/New body) and Fillet/Chamfer (live preview).
  - **Step 4 done**: files (`src/files/`): autosave + project library (IndexedDB), `.caddy.json`
    version 2 (opens version 1), Save window with real Save As, STL / 3MF / STEP export with a
    smoothness setting. Checkpoint 1 reviewed by the owner 2026-10-01: STL printed-path check in a
    slicer was good; asked for the fillet arrow and step-back Ctrl+Z (both done), then step 5.
  - **Step 5 done** (2026-10-01): Revolve (`src/tools/revolve.ts`), Hole with draggable markers
    (`src/tools/hole.ts`), sketch on a body face with snaps that follow the body
    (`src/sketch/facesnaps.ts`). Both tools preview live on the model through the kernel.
  - **Step 6 done** (2026-10-01): Sweep (`src/tools/sweep.ts`, path math in `src/model/path.ts`,
    build in `src/kernel/sweep.ts`). Each path section is its own exact piece (prism for lines,
    revolve for arcs), joined without merging away the section boundary lines (`keeps` discs in
    `unifyKeeping`); Mitered = trimmed at the bisector plane, Round = path corners replaced by true
    arcs sized by the prototype's rule (pivot about the corner when there is no room).
  - **Step 7 done** (2026-10-01): Shell (`src/tools/shell.ts`, `src/kernel/shell.ts`: thick solid with
    sharp corners, closed hollow via offset solid) and Pattern (`src/tools/pattern.ts`, copies in
    `src/model/pattern.ts`; the kernel keeps every feature's tool shape in `toolCache` and a pattern
    that moves the original suppresses it). Pattern copies that become new bodies use `bodyIds`
    slots the tool creates on commit.
  - **Step 8 done** (2026-10-01): Render view (`src/view/render.ts`: ACES tone mapping, studio
    environment, soft shadow, floor) and 20 materials with procedural textures
    (`src/view/materials.ts`); the look is saved per body in `.caddy.json`. Render lighting is tuned
    (`environmentIntensity` 0.32, exposure 1.0, sun 0.7π) because current three.js is brighter than
    the prototype's r128; Design view is untouched.
  - **Step 9 prepared** (2026-10-01): offline service worker written by the build (`vite.config.ts`),
    manifest + icon, About/licenses page (`public/licenses.html`, LGPL notice), GitHub Pages workflow
    (`.github/workflows/pages.yml`), offline test (`e2e/offline.spec.ts`). **Not published yet**: waiting
    for the owner's GitHub repository.
  - **Step 9 done**: published at https://calebalusek.github.io/caddy/ (GitHub Pages, repo
    calebalusek/caddy; pushes to main redeploy). The owner pushes (git needs their sign-in).
  - **Step 10 done** (2026-10-01): Mirror (`tools/mirror.ts`), Overhang check (`model/overhang.ts`,
    `tools/overhang.ts`, a view with no History entry: `noFeature`), Text (`tools/text.ts`; fonts
    bundled in `kernel/fonts.ts`; the sketch Text button opens it on the sketch's plane) and Thread
    (`tools/thread.ts`, `model/threads.ts`; real helical groove, ISO 60° profile, standard coarse sizes).
    Thread lesson: the engine sometimes cuts a helical groove wrongly without an error, so the kernel
    checks the removed volume against the groove's swept volume and retries slightly turned.
    Threads take ~3 s to build (they are rebuilt with every timeline change).
    **All planned tools are rebuilt.** Next: whatever the owner asks for; open items are the license choice
    and the real Windows Save As check.
  - **Advanced tools, batch 1 done** (2026-10-02, not yet published): a "Bodies" toolbar group with Combine
    (`tools/combine.ts`: Join/Cut/Intersect, keep tools; used bodies are `consumed` and leave the Browser),
    Move/Rotate/Scale (`tools/transform.ts`: Copy, Lay a face down onto the build plate), Split body
    (`tools/split.ts`, `kernel/bodyops.ts`: plane split, optional Pins/Rib/Dovetail keys with clearance) and
    Offset body (`tools/offsetbody.ts`: grow/shrink, sharp or round corners). Shared body picking in
    `tools/bodypick.ts`. Hole presets (`model/holepresets.ts`: M-screw clearance / counterbore / countersink,
    heat-set insert pockets, magnet pockets; fills the menu through the new `onChange` hook in `ToolDef`).
    Sketch tools in `sketch/extras.ts`: Slot, corner Fillet/Chamfer, Mirror, Project body edges (flat edges
    and circles/arcs facing the sketch plane). Ellipse/Spline are deferred (they need new curve types).
    Later ideas: Loft, Draft angle, wall-thickness check, Measure + weight, Section view, Coil, fit-to-bed
    layout, snap-fit/hinge generators, lattice infill.
  - **Wall thickness check + Measure done** (2026-10-03): `tools/thickness.ts` (`model/thickness.ts`: a ray goes
    inward from sample spots on every triangle, bounding-box tree; flags faces under the limit; a view with
    no History entry like Overhang) and `tools/measure.ts` (`model/measure.ts`: two points with snaps give
    distance and ΔX/Y/Z, an edge gives its length, a face its area, plus weight by material and infill %).
    Both are in the Print toolbar group (`WT`, `ME`).
  - Windows PowerShell 5.1 gotcha: `Get-Content`/`Set-Content` mangle UTF-8 (° × → Ø) and add a BOM. Edit
    source files with the Edit tool or node, never with PowerShell read/write.
- Tools not rebuilt yet say which step brings them back (`step` in `src/app/commands.ts`).

## How the rebuild is organised
- `src/model/` plain data + math (no three.js, no DOM) so it runs in Node tests and the worker.
- `src/app/` state, commands, regenerate (timeline rebuild), history (delete/undo/new).
- `src/tools/` one file per tool; each registers a `ToolDef` with `registerTool` and gets the menu,
  docking, value-starts-at-0, drag arrow, Enter/Esc for free.
- `src/view/` three.js scene. It keeps the prototype's r128 color pipeline on purpose
  (`ColorManagement` off, light intensities × π) so the approved Design-view look is identical.
- `src/styles/app.css` is the prototype's CSS; rebuild-only rules go at the bottom.
- Kernel lessons (learned by test, keep them): hole loops must run clockwise or the kernel adds
  them instead of cutting; a too-big fillet throws, so it is caught and reported; round faces have
  a "seam" edge that is dropped (not drawn, not pickable); kernel objects are freed by hand
  (`Scope` in kernel/scope.ts); face/edge ids change on every rebuild, so saved features point at edges
  geometrically (`src/kernel/match.ts`, same format as version 1 files).
- Tools that preview live on the real body must pick Join/Cut with `insideBase` (the bodies
  without the preview), or they see their own preview and flip to Cut.
- Editing a feature rolls the timeline back to just before it while its menu is open.
- Old files: `tests/fixtures/make-v1.mjs` drives the prototype to write real version 1 files into
  `tests/fixtures/v1/`. Add one per feature type as each tool is rebuilt.
- Publishing note: the OpenCascade build (`replicad-opencascadejs`) is LGPL-2.1; the published
  site needs its license notice. replicad itself is MIT.
- Deliberate differences from the prototype: hovering a plane is orange (rule 1; the prototype used
  blue), the toolbar button stays lit only while its tool is open, the Origin group opens by itself
  while a tool asks for a plane, the geometry engine loads in the background, a STEP export
  button and a "Smoothness of curved faces" choice (Draft / Standard / Fine) in the export window,
  sketch undo history (last 30 steps) is saved with the project, a selected whole sketch gets
  the bold blue band, while a tool asks for a plane a solid body under the cursor wins over the
  see-through planes around it, Revolve and Hole preview on the real body instead of a see-through shape.

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
10. **Ctrl+Z steps back one step; it never throws a whole feature away in one go.** Right after a
    tool (extrude, fillet, plane…) it reopens that tool's menu with its values still in it, ready
    to change; Ctrl+Z again there takes the feature out. Right after finishing a sketch it goes
    back into the sketch, where it undoes one drawing step at a time. Deletes come back. Only the
    last few steps are remembered, for the current session only (`src/app/undo.ts`).
11. **Tools with a size get a drag arrow** in the viewport with a live value label, like Extrude
    (Fillet/Chamfer: the arrow slides across the face to show how far the cut goes in).
12. **Previews look like Extrude's**: the original body stays drawn as it is, the material a tool
    removes shows translucent red, what it adds shows blue (`setDiffPreview`, kernel `buildDraft`).
    Drag arrows are smooth: 0.1 mm steps (Shift = whole mm, Alt = 0.01).
13. **Sketching never adds constraints by itself.** Snapping only places points exactly; the user adds
    constraints (the rectangle tool's own horizontal/vertical and typed dimensions are the exception).
    Origin planes are drawn small (30 mm); an empty sketch still opens with room to draw.
14. **Holes snap to a face's critical points** (corners, edge middles, the face middle, circle
    centers); Shift-click two of them to put the hole halfway between.
15. **Units: mm / in switch** (top right, remembered in this browser). The model, files, kernel and exports
    are always millimeters; the switch only changes what is shown and typed (`src/core/units.ts`:
    `fmtU`, `fmtLen`, `toUser`, `fromUser`) and the base grid (10 / 50 mm lines, or 0.5 / 2.5 in lines).
    Any new length field or message must go through those helpers, never a hard-coded " mm".
16. **iPad**: one codebase, an "iPad" mode (the Desktop/iPad switch; an iPad picks it itself,
    `core/device.ts`). Input lives in `view/pointer.ts`: 1 finger orbits (pans in a sketch), 2 fingers pan +
    pinch-zoom + twist, quick 2-finger tap = Undo, 3-finger tap = fit, touch-and-hold = right-click, double-tap =
    double-click; the Pencil is precise, draws by dragging in a sketch (down = first point, up = last), its side
    button pans. Picking areas scale with the pointer (`pickScale()`). iPad mode adds big targets, a number pad
    (`ui/keypad.ts`), drag-a-label-to-change-a-size (`ui/scrub.ts`), Undo/Esc/Enter buttons (`ui/touchbar.ts`) and a
    hideable Browser. Files leave through the share sheet (Save to Files) / folder / download (`files/deliver.ts`).
    Test touch with CDP (`Input.dispatchTouchEvent`, mouse events with `pointerType: 'pen'`), see `e2e/ipad.spec.ts`.
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
- (nothing else parked besides the slicer)
