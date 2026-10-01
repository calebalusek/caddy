# CADDY — Functional Specification (from the working prototype)

The prototype in `reference/caddy-prototype.html` is the source of truth. When this document and the
prototype disagree, open the prototype and match it (then fix this document).

---------------------------------------------------------------------------------------------------
## 1. Screen layout

- **Top bar**: CADDY logo · **File** menu · project name (click to rename) · save status ("✓ Saved")
  · Desktop/iPad switch (iPad is a placeholder) · units chip "mm" · light/dark theme button.
  Compacts on narrow windows (hide the iPad note, then icon-only switch, then chip/status).
- **Toolbar** with colored groups and a label under each group:
  Create (amber) · Modify (teal) · Construct (gold) · Look (violet) · Print (violet) ·
  Sketch tools (blue) while sketching. Each button: icon, name, and its command alias (e.g. EX).
  If buttons do not fit, the toolbar scrolls sideways.
- **Browser** panel (left): Origin (planes/axes, eye toggle), Sketches, Construction (offset planes),
  Bodies. Rows have visibility eyes, right-click menus, F2 rename. Single-click a sketch highlights it
  (bold), double-click edits it.
- **Viewport** (center): grid, origin axes (X red, Y green, Z blue), **ViewCube** top-right
  (112×112, click faces/edges/corners, drag to orbit, Home button), Design/Render switch top-center,
  Home and Fit buttons bottom-left, hint text bottom-right.
- **History / timeline** (bottom): one icon per feature in order; double-click to edit; right-click
  menu; failed features shown with a warning state.
- **Command bar** (very bottom): AutoCAD-style. Type an alias or a name; fuzzy, usage-ranked
  suggestions; Enter or Space repeats the last command. Status messages appear just above it.
- **Tool menus (dialogs)** dock flush to the right edge, below the ViewCube; draggable by the title
  bar; remembered position for all tools; double-click title to re-dock; scrollable with an orange
  thumb; move up beside the ViewCube if the window is short.
- **Sketch bar** (top-center of viewport while sketching): "Sketch view" (only when the view is not
  square to the sketch), Dimensions toggle, Constraints toggle, **Finish sketch** (green). There is
  NO finish button in the toolbar.

## 2. Visual style

### Theme tokens (light / dark)
| token | light | dark |
|---|---|---|
| panel / panel-2 / field / line | #F6F7F8 / #E0E4E8 / #FFFFFF / #C9CFD5 | #262B31 / #323941 / #1A1E22 / #3B434C |
| text / text-2 | #1C2126 / #525C66 | #E6E9EC / #9BA5AF |
| accent / accent-fill (orange) | #A95F07 / #F0A23B | #F0A23B / #F0A23B |
| select / focus (blue) | #2B66D1 | #5B9BFF |
| viewport bg / grid minor / grid major | #D8DDE2 / #C6CCD2 / #AAB2BA | #343A41 / #3D444C / #4F5861 |
| sketch lines | #2B66D1 | #6FA8FF |
| **body** | **#66625A** (warm satin grey, matches Fusion's default look) | **#A3A9B0** (cool steel grey) |
| **edge lines** | **#141414** | **#0A0C0F** |
| cut preview | #D4453B | #FF6B5E |
| group colors sketch/create/modify/construct/print/finish | #2F6FDB #D9801E #13937F #C08E12 #7B5BD6 #1E9E54 | #6FA8FF #F0A23B #3CC7AE #E6BF45 #A58BFF #3DD07A |

### Body look (Design view) — "Fusion shaded with visible edges"
- Lit satin material (roughness ~0.68, metalness 0), **no environment reflection** in Design view.
- Lights: ambient ~0.42, hemisphere ~0.30 (white sky / warm grey ground), a **headlight that follows
  the camera** from slightly above-left (~0.5), small fixed fill (~0.12). Goal: no face goes black,
  no face blows out to white. Approximate face tones — dark mode #5F6367 (away) … #DAE2EC (facing
  light); light mode #3C3935 … #898379.
- Crisp, opaque near-black edge lines on every real edge; smooth shading on curved faces.
- With a real kernel, render true silhouettes/curves smoothly (more segments than the prototype).

### Render view
ACES tone mapping, studio environment (softboxes/strips), soft shadows, ground plane, 20 materials:
PLA, PETG, Silk, ABS, TPU, Resin, Clear resin, Carbon fiber, Aluminum, Steel, Chrome, Brass, Copper,
Iron, Oak, Walnut, Wood PLA, Concrete, Rubber, Ceramic — with tint colors; saved with the project.

### Interaction colors (standing rule)
- **Hover = orange** (accent-fill): faces (translucent orange), edges, sketch lines, regions,
  whole sketches, features/bodies inside tools, circles, hole markers.
- **Selected = bold blue**: faces darker blue fill; edges/lines/paths/axes/fit-edges/picked circles
  as a ~5 px **camera-facing ribbon** (constant screen width at any zoom); points as large dots.

## 3. Navigation & selection
- Orbit (left-drag), pan (right-drag), zoom (wheel). ViewCube; view commands TOP/FR/RI/LE/BA/BO/HOME/ZE.
- Select first, then tool: hover highlights, click selects, Shift+click adds. Selection feeds the next
  tool (Fillet/Chamfer edges, Sketch on a face, Offset plane, Materials, Shell faces, Extrude face).
- Right-click viewport menu: Extrude face, Sketch on face, Fillet/Chamfer edges, Material, Home/Fit;
  on a sketch: Edit sketch / Extrude / Revolve / Sweep.
- Outside sketch editing, a click on any part of a sketch selects the **whole sketch**; double-click
  in the viewport or browser edits it.

## 4. Sketching
- Start: SK, pick an origin plane, offset plane or flat body face. View squares to the sketch
  ("Look at"). **Sketch on a body face**: bodies stay solid (not ghosted); other sketches ghost
  bodies at ~22% opacity. Sketch lines draw on top.
- **Face snapping**: when sketching on a face, snap to that face's corners, **edge midpoints**,
  round-edge **centers** and quarter points (non-associative points in the prototype; associative
  references would be better in the rebuild).
- Tools: Line (L), Rectangle (REC), Circle (C), Arc (A), Polygon (POL: asks sides; corners/flats
  toggle; built on a construction circle with equal-side constraints), Offset (OF), Move (M),
  Trim (TR), Text (TE — placeholder; to be built for emboss/engrave with real font outlines).
- Constraints: Horizontal/Vertical (HV), Perpendicular (PE), Parallel (PA), Equal (EQ),
  Coincident (CO, also point-on-curve), Fix (FIX), Tangent (TA), Midpoint (MP), angle, point-to-line
  distance, alignment (from tracking). Badges (H V ⊥ ∥ = lock T M C ↕ ↔) can be shown/hidden,
  hover highlights the geometry they govern, right-click deletes.
- Dimensions (D): length, diameter Ø, radius R, horizontal/vertical distance, angle °, across-flats.
  Double-click / Enter / F2 to edit; math expressions kept; Tab/Shift+Tab cycles; arrow keys nudge
  ±1/±10; live preview while typing; drag labels; over-constraining offers reference dimensions.
- Solver: Levenberg–Marquardt with numeric Jacobian, DOF analysis, redundancy rejection.
  Blue = free geometry, dark/white = fully constrained.
- Snaps: endpoint, center, origin, midpoint, quadrant, intersections (line/line, line/circle,
  circle/circle), nearest. **Object snap tracking**: hover a snap ~380 ms to acquire it (green +),
  dotted guide lines follow, two guides give an intersection snap, alignment constraints added.
- In-sketch hover is orange; selected sketch items get the bold blue band / big dots.
- Profiles: planar face-finding with arcs, holes and nesting. Finish with the sketch-bar button or FS.

## 5. Solid features (all parametric, all in the timeline)

### Extrude (EX)
Fields: Profile · Distance · Direction (One side, Symmetric) · Operation (Join, Cut, New body —
picked automatically, user can override) · Start offset from sketch. Drag arrow in viewport.
Press-pull from a flat body face. Profile memory: re-finds its region after sketch edits.

### Revolve (REV)
Fields: Profile · Axis (sketch line, origin axis, body edge; construction line auto-used) · Angle ·
Direction (One side, Symmetric) · Operation. Partial angles get end caps.

### Sweep (SW)
Fields: Profile (sketch region or flat face) · Path (click a sketch curve → whole connected chain of
lines/arcs; or a circle; or pick a sketch in the browser) · Orientation (Perpendicular, Parallel) ·
**Sharp corners (Round, Mitered)** · Operation.
- Two selection boxes (Profile / Path); the highlighted box receives the next click; orange hover
  preview of the chain; picked path drawn bold blue.
- Rules learned the hard way: caps and hole loops must be consistently oriented; split the path at
  sharp corners; **Mitered** = runs trimmed exactly at the bisector plane plus extension pieces;
  **Round** = replace each sharp path corner with a smooth bend sized to the profile
  (bend radius ≈ 2 × the profile's depth on the inside of the bend) so inside AND outside are
  rounded; if a profile reaches an arc's center (tight bend) build that bend as an exact revolve
  split at the axis. The body must always stay connected (no gaps, folds, lips or slivers).
- Draw a line wherever the sweep changes section (straight → curve → bend); each section is its own
  selectable face.

### Hole (HO)
Fields: Placement (click flat faces or sketch points; pick a sketch in the browser to put holes on
its circle centers) · Diameter · Extent (Through all, Distance) · Depth · Type (Simple, Counterbore,
Countersink 90°) · Counterbore Ø/depth · Countersink Ø. Multiple holes per feature.
- Markers: a ring the size of the hole + center crosshair + soft fill, **blue**; hover **orange**
  with grab cursor. **Drag a marker to slide the hole anywhere on its face** (stays on that face);
  click without dragging removes it. Sketch-point holes follow their sketch.

### Fillet (F) / Chamfer (CHA)
Fields: Edges · Radius / Distance. Straight and round edges; click a face to take all its edges;
deleting a fillet face removes just that edge; re-matches edges after upstream edits.
With OCCT: fix corner blends where fillets meet (prototype leaves a small notch).

### Shell (SH)
Fields: Faces to remove (click to toggle; none = closed hollow; pick a body in the browser) ·
Thickness · Direction (Inside, Outside). Holes get their own walls. Too-thick walls give a clear
error. Use OCCT's thick-solid/offset in the rebuild.

### Pattern (PTR rectangular / PTC circular; one dialog)
- Type (Rectangular, Circular) · Objects (Features, Bodies) · Copy (click a face of the feature,
  or the feature in **History**, or a body in the browser; click again to remove).
- Rectangular → Layout:
  - **Spacing**: Direction (X, Y, Z, Edge) · Count · Spacing · Second direction (None, X, Y, Z, Edge)
    · Count · Spacing. Spacing 0 is flagged ("puts every copy on top of the original").
  - **Fit to edges**: click a straight edge along the face's **length**, then one along its
    **height** (bold blue). Columns · Rows · Distances: **Equal** = every clear gap identical
    (edge→object, object→object, object→edge; uses the object's actual width, e.g. hole diameter);
    **Custom** = edge gap to the *outside* of the outermost objects, the rest spaced evenly.
    The original moves into the grid (no stray original).
- Circular → Axis (X, Y, Z, **Pick**) · **Radius** (0 keeps objects in place; >0 places them on a
  circle around the axis, original moves onto it) · Count · Total angle (360 = evenly around;
  less = spread end to end). **Clicking any sketch circle** (even with X/Y/Z selected) sets center,
  axis and radius and switches Axis to Pick; with Pick, round edges and round faces also work.
- Feature patterns re-run the feature's tool (cut/join/new body); body patterns make new bodies.
  Deleting a patterned feature removes its pattern.

### Offset plane (PL)
From origin planes, offset planes or flat faces.

### Placeholders still to build
Thread (TH), Mirror (MI), Overhang check (OV — shade faces needing support at the printer's angle),
Text (TE). Until built they show "<name> isn't built yet. It's on the list."

## 6. Files & projects
- **Autosave** to IndexedDB (~700 ms debounce) with a home-view thumbnail; "✓ Saved".
- **Project library** opens on load when projects exist: cards with thumbnail, edit time, feature
  count; ⋯ menu (Rename, Duplicate, Delete with confirm).
- **New project / Open file (Ctrl+O, drag-and-drop) / Save to file (Ctrl+S)**. Creating or opening a
  file clears every selection, highlight and preview from the previous one.
- **Save window** (desktop): centered modal for project saves and exports. File name box (pre-filled,
  editable; remembers the last name per kind), extension shown separately, **+ Version** (v2, v3 …),
  **+ Date** (YYYY-MM-DD), format switch STL/3MF for exports, summary line (bodies · triangles · mm),
  destination note, Cancel/Save, Enter/Esc. In the real app: Save opens the OS **Save As** window
  (File System Access API) so the user picks the folder. iPad: same window, saving into the Files app.
- **Exports**: STL (binary, mm) and 3MF (mm, one named object per body, shared vertices). Export the
  selected bodies, or all visible bodies. Must be watertight (every edge shared by exactly two
  triangles). Add STEP with OCCT. (Inside claude.ai the prototype had to wrap these in a .zip — not
  needed in the real app.)
- `.caddy.json` (version 1): `{format:'caddy', version:1, name, features[], sketches inside features,
  counters, view, materials}` — no mesh; the model rebuilds on open. Keep opening v1 files.

## 7. Keyboard
Ctrl+S save window · Ctrl+O open · Ctrl+Z undo (U) · Esc cancels tool/selection · Enter/Space repeat
last command · Delete removes selected sketch items/constraints · F2 rename / edit dimension ·
Tab / Shift+Tab cycle dimensions · arrows nudge dimension values · Shift+click multi-select.

## 8. Full command list (alias, group, status)
- Create sketch — `SK` (create) 
- Extrude — `EX` (create) 
- Revolve — `REV` (create) 
- Sweep — `SW` (create) 
- Hole — `HO` (create) 
- Thread — `TH` (create) — **placeholder**
- Fillet — `F` (modify) 
- Chamfer — `CHA` (modify) 
- Shell — `SH` (modify) 
- Rectangular pattern — `PTR` (modify) 
- Circular pattern — `PTC` (modify) 
- Mirror — `MI` (modify) — **placeholder**
- Offset plane — `PL` (construct) 
- Overhang check — `OV` (print) — **placeholder**
- Export STL — `STL` (print) 
- Export 3MF — `3MF` (print) 
- Line — `L` (sketch) 
- Rectangle — `REC` (sketch) 
- Circle — `C` (sketch) 
- Text — `TE` (sketch) — **placeholder**
- Arc — `A` (sketch) 
- Polygon — `POL` (sketch) 
- Trim — `TR` (modify) 
- Offset — `OF` (modify) 
- Move — `M` (modify) 
- Dimension — `D` (construct) 
- Coincident — `CO` (construct) 
- Tangent — `TA` (construct) 
- Midpoint — `MP` (construct) 
- Horizontal/Vertical — `HV` (construct) 
- Perpendicular — `PE` (construct) 
- Parallel — `PA` (construct) 
- Equal — `EQ` (construct) 
- Fix — `FIX` (construct) 
- Finish sketch — `FS` (finish) 
- Look at sketch — `LA` (view) 
- Home view — `HOME` (view) 
- Bottom view — `BO` (view) 
- Back view — `BA` (view) 
- Left view — `LE` (view) 
- Top view — `TOP` (view) 
- Front view — `FR` (view) 
- Right view — `RI` (view) 
- Zoom to fit — `ZE` (view) 
- Appearance — `AP` (print) 
- Render view — `RV` (view) 
- Design view — `DV` (view) 
- Toggle grid — `GR` (view) 
- Toggle origin planes — `ORI` (view) 
- Undo — `U` (view) 
- Save to file — `SAVE` (file) 
- Open file — `OPEN` (file) 
- Projects — `PROJ` (file) 
- New project — `NEW` (file) 
- Rename project — `RENP` (file) 

## 9. Known prototype limitations (fix in the rebuild)
- Mesh/BSP kernel: fillet corner blends notch; precision limited by faceting; slow on complex parts.
- Arcs don't split lines for profile finding (no notch regions from arcs).
- Face-edge snaps are not associative (points don't follow the body if it changes).
- Undo history is not saved between sessions.
- No STEP import/export.
