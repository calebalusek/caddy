# CADDY — Acceptance tests

The prototype was verified against exact math after every change. The rebuild must pass these too
(with OCCT, curved results will be closer to exact than the prototype's faceted values).
"Faceted" values assume 72-segment circles in the prototype; with exact B-rep compare to the exact value.

## Booleans, extrude, revolve, hole
- Box minus box / pocket / union: volume exact.
- Washer revolve 360° (prototype faceted 4706.4, exact 4712.4); washer 90° ≈ 1178.1 with end caps.
- Cylinder touching the axis (revolve) exact.
- Ø6 through hole in an 8 mm plate removes π·9·8 = 226.19 (prototype faceted 225.91); Ø6 × 5 blind = 141.37 (faceted 141.19);
  counterbore Ø11×3 + Ø6 and countersink Ø12 90° + Ø6 match the formula volumes.
- Fillet/chamfer volumes within 0.3% of exact; corner blends must be clean (no notch) in the rebuild.

## Sweep
- Ø10 circle along a straight 50 mm line: π·25·50 = 3927.0 (prototype faceted 3922.0).
- 10×10 square along an L path (50 up + 50 across) **Mitered**: exactly 10 000.
- Quarter pipe bend R30, Ø10: π·25·(π/2·30) ≈ 3701 (faceted ≈ 3696).
- Closed circle path (torus R30 r5): 2π²·30·25 ≈ 14 804 (faceted 14 767).
- Hollow pipe Ø10/Ø6 around a sharp L corner, Mitered: ring area × centerline = exact; bore stays open.
- Triangle profile (0,0),(20,0),(8,14) with path up 40 / arc R30 over the top / sharp corner / straight:
  for path positions x = −10, 0, 10, 25 → closed solid, zero open edges, no folds, both corner styles.
- Round corners: square bar L corner — outer corner rounded, inner corner rounded (material at (5.4,44.6),
  none at (6.5,43.5) for the prototype's auto radius).
- Section boundary edges exist between straight/arc/bend sections on every side face.

## Shell
- Box 40×30×20, top open, 2 mm inside: 7152. Closed hollow: 9024. Outside 2 mm, top open: 8912.
- Cup Ø20×20, top open, 2 mm: exact ring volume (faceted 2662.41).
- Plate 60×40×10 with Ø12 through hole, top open, 1.5 mm: hole gets its own wall; cavity hollow.
- 25 mm walls on a 20 mm box → clear error, no broken body.

## Pattern
- 3×2 grid of Ø6 holes, 15 × 12 spacing: all six open, material between solid, volume exact.
- 6 holes on a Ø40 bolt circle (circular, 360°): each open at its 60° position; volume exact.
- 4 copies over 90° land at 0°, 30°, 60°, 90°.
- Circular with radius 15 from a hole at the plate center: six holes on the circle, center solid.
- Fit to edges 60×40 face, Ø4 holes, **Equal**: 3×2 → x centers 14/30/46 (clear gaps 12 each),
  y 12.667/27.333 (gaps 10.667 each); 6×3 → x gaps 5.143 each, y gaps 7 each.
- Custom edge gap 5 mm, 3×2: x centers 7/30/53, y 7/33. Too many → clear message.

## Sketch on a face
- Plate 60×40 with Ø8 hole at (20,20): snaps offered at corners (0,0)(60,0)(60,40)(0,40), midpoints
  (30,0)(60,20)(30,40)(0,20), hole center (20,20) and quarter points. A sketch above the part gets none.

## Files
- `.caddy.json` round-trips every feature type (incl. sweep/shell/pattern with their bodies) and
  opens prototype (v1) files.
- STL: valid binary, correct triangle count, volume matches the body; 3MF: valid package, unit
  millimeter, one named object per body, **every edge shared by exactly two triangles**, volumes match.
- Save window: name editable, +Version (v2→v3), +Date, empty name disables Save, Esc cancels, last
  name remembered; Save As opens the OS picker in the standalone app.

## UI behaviors (check with real clicks, real WebGL)
- Hover orange / selected bold blue for every selectable thing in every tool.
- Picking from Browser/History works in Pattern, Shell, Extrude/Revolve/Sweep (sketch), Hole (sketch).
- Tool menus never cut off at 1400/1100/900 px widths; docked flush right; drag + remember + re-dock.
- Finish sketch reachable at any window width (sketch bar).
- New/Open project leaves no selection or highlight from the previous file.
