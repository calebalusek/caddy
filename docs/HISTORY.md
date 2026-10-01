# CADDY — Decisions & History

How CADDY got to where it is, so the rebuild keeps every decision. Three parts:
A) the owner's early messages, word for word; B) what was built between those messages and the
current session; C) every request from the latest session and what was done.

---------------------------------------------------------------------------------------------------
## A. Early design conversation — the owner's messages (verbatim, UTC timestamps)

**2026-09-25 14:31**
> how possible is it for you to create a 3D modeling web app that functions a lot like Fusion360 and solidworks?
>
> dont create it now, but lets just brainstorm and talk about it

**2026-09-25 14:34**
> i love 3d modeling and printing and wanted to create a tool that myself and hopefully many others can use to bring their ideas to life. so i would want it to have as many design features as possible and to export as a high quality STL file for printing.

**2026-09-25 14:40**
> i would want this app to be attractive to the advanced modelers, yet beginner friendly if needed.
> i would say fusion360 is a good example of being advanced yet clean and easy to understand

**2026-09-25 14:44**
> i am inspired by civil3d commands
>
> how i can type mlea and a list of commands that the app suggest with mleader at the top and i would just press enter and a multi-leader would pop up
>
> i like this function, so i wouldnt have to search for the icon on the taskbar and i would just type something like rev for revolve or ex for extrude or plane to crate a new plane to draw/create a new object off of

**2026-09-25 14:48**
> i like what you said, only 1 change
>
> im thinking we combine both ideas. where you say ex and then the dialog box pops up yet it automatically is ready for me to type in a distance, so i wouldnt have to click on an empty box to type in my dimension.
>
> also wanted to bring up the ability to grab and arrow and drag, very similar to what fusion 360 does

**2026-09-25 14:51**
> i like your idea on the extrude to make the app look professional and nice while keeping the speed of things optimized
>
> how would i go about making this app run on my web browser?

**2026-09-25 14:54**
> yes sure you can render me a mockup here in claude

**2026-09-25 15:23**
> i think it look really good
>
> would love to call the application CADDY
>
> i think the task bar looks good, would want there to be a little more color involved. 
>
> please allow the ability to right click in the browser and be able to do a small list of functions like edit a sketch or rename or so on.
>
> please create a project origin. and when you create an offset plane, show a view like at the origin to select an axis to build an offset plane off of.
>
> also please move forward with creating the sketch button and the interface within working on a sketch. 
>
> you wouldnt need to show the sketch toolbar on the top until you are actively in a sketch working on one.

**2026-09-25 15:56**
> looks fantastic
>
> one additional thing i would want to add. up on the top right you have the light and dark mode, which is awesome! i would also like to add a separate mode switch. I want this web app to also work seamlessly on an ipad as well! so if you could also create separate settings/functions for ipad mode that would be awesome! 
>
> you dont have to create those functions now but you can just make a placeholder and button for the mean time and we can add ipad functionality when we get the computer version finalized and everything looking and working right

**2026-09-25 15:57**
> love it all fantastic thoughts

**2026-09-25 15:58**
> lets do the first 2 bullet points first
>
> * sketch dimensions/constraints

**2026-09-25 16:21**
> before we do that lets fine tune what we have fist

**2026-09-25 16:21**
> Q: What should we fine-tune first? (Select all that apply)
> A: Dimensions & constraints: placement, readability, editing

**2026-09-25 16:34**
> how do i edit the dimension after its drawn

**2026-09-25 16:36**
> how do i add an angular dimension

**2026-09-25 16:41**
> ok sweet, this works great! only thing to change is that double clicking on the dimension doent let me edit it. i would have to click once then press enter. please let double click work.
>
> i drew in a triangle in the sketch view and dimensioned it and it looked great!  only thing is that it doent let me delete the vert constraint it automatically added, and  it wont let me add the perpendicular constraint to it

**2026-09-25 16:59**
> ok sweet its working great! only thing to add to the functionality is if you have a tool selected/was just used, pressing the escape button will take me off the tool and to the normal hand/regular tool
>
> next lets add the shift click function to highlight multiple objects and then to be able to use the function when creating an offset 
>
> then when creating a polygon, prompt for how many sides then allow the user to click and set the center point
>
> please add the function "move" which will allow the user to move any closed shape as a full object or, if not a shape, a singular (or multiple selected objects together) object to a different location on its plane. you would select a base point (node) then click again at the destination.
>
> * similar to the move function on civil 3d

**2026-09-25 18:52**
> looks good
> only thing to change that is different than civil 3d move function is that when you select your base point to move, i want that base point to be on the item/items selected. either a l ine midpoint, a node, or somewhere on the object
>
> also similar to civil 3d please add little symbols with the curser that snaps on at line midpoints curve points or anything of significance that could be useful in design. add a home button that puts the orgin in an isometric view similar to fusion 360
>
> also lets dive into view functionality. i would like it if there were a 3d block on the top right (similar to autodesk apps) where you can easily click/tap on a face to bring the view perpendicular to that face. also when in a sketch, to add a button that will automatically snap the view back to fitting the entire sketch/not body, just the current sketch on the screen and perpendicular to the correct plane.

**2026-09-25 19:02**
> absolutely perfect
>
> dont need the top bar to say 2 degrees of freedom
>
> change the look at button to only pop up if the user changes the view to not be perpendicular to the active plane of the sketch. also change the look at text to say "sketch view" and make it blue

**2026-09-25 19:10**
> alright lets dive into how the user will save their projects and how the app will reopen saved work

**2026-09-25 19:13**
> i agree with your proposal of autosave, project library, and .caddy files

**2026-09-25 19:24**
> i dont think i want this to be a cloud sync thing
> i think that if a user wants to have the file on a different device they can just email the json to themselves and run it that way.
>
> like if they want to run the file on their ipad they just save it to their files app then you can pull in the file that way. that can be set up later

**2026-09-25 19:25**
> i would like to keep the app as a webapp and not an app that is in the app store on ipad

**2026-09-25 19:28**
> i like that for the ipad mode
> is there a way for you to code both versions to overwrite the file open? i i wouldn't have to save a new version every time. is that possible on the ipad

**2026-09-25 19:30**
> ok sounds good

**2026-09-25 19:32**
> we will do export last
>
> lets do more sketch tools as well as fillet and chamfer

**2026-09-25 19:51**
> when doing fillet on a circle thats extruded, it looks like the circle created is a bunch of flat edges and the fillet only selects those lines. please update and fix to where the entire edge is selected

**2026-09-25 20:02**
> what are the 3d libraries you are using

**2026-09-25 20:10**
> thats wild
>
> after completing the fillet the edges are a little blurry
>
> also i have an idea
> lets make the original design of the body to be a matte surface where all edges are clear and both sides of a fillet are clear. then you can switch from design view  to the actual item view where you can make select the items material of a material gallery that you choose where edges are shown/yet the rendered model will look more realistic and shiny if the material is shiny, or looks like wood if the material is wood, or anything

**2026-09-25 20:24**
> the lighting could be better/ more reflection in render view. have no lighting in the design view
>
> one thing to add is the ability to NOT have any tool selected and to highlight either an edge/face and THEN click on a tool and already have the face/edge selected for the process
>
> also the ability to draw a sketch on top of the face of a body selected (just like fusion 360)

**2026-09-25 20:36**
> when doing the fillet it shows the edge of the face on top which is perfect but i also want the edge shown on the side wall face as well. also for that face to be selected as well. all faces of a 3d object rather it be a flat face or a rounded face should be able to be selected. that's including a chamfer as well. the chamfer itself would be a "face" and i could select it, highlight it and then delete it if i would like.
>
> lets switch the colors when we select objects as well. when you hover over an edge it should be highlighted orange and when you select it, its blue.
>
> When you hover over a face it can be blue and when you select it, it can be a slightly darker shade of blue.

**2026-09-25 20:43**
> better, one thing to fix is that every time you do a similar function you have it coded in that it remembers a value for repeated functions. please have it start at 0 every time.
>
> also the filet function is running a little slow. any way to optimize that?

**2026-09-25 21:15**
> 1) on projects page, when you click on the 3 dots you cant click on anything on the drop down to delete the drawing
>
> 2)you cant extrude from a face. please allow the user to extrude from a face as well. the user can either select a face in extrude menu or select face first then click extrude
>
> 3) i want the history to be remembered in a way that if you make a change to a sketch from before and later on in the history you extrude from that sketch, the new shape in the sketch would be extruded to the same value after updating the old sketch

**2026-09-25 21:29**
> let sketches be clicked on and highlighted in the browser and when doing so, also highlights them in the viewport through bodies
>
> when editing a sketch and a body is present/in the way i cant select anything in the sketch. please fix
>
> pleas begin working on the revolve and hole functions.

**2026-09-25 21:40**
> when sketching it would be a very helpful tool if you add an auto guide line that allows you to have the option to draw a circle for example at the intersect of 2 line midpoints (middle of a rectangle as an example)
>
> you would have a tool like circle selected and then bring your mouse to the midpoint of 1 line and then to a midpoint of a line perpendicular to the first line and then your mouse can follow a line to the middle to get the "mid point" 
> similar what civil 3d does


---------------------------------------------------------------------------------------------------
## B. Built in the sessions of Sep 25–29 (summary)

Architecture decisions
- Single-file HTML prototype now; real project later on TypeScript + Vite + OpenCascade.js/replicad.
- Custom BSP boolean engine with coplanar merging; bounding-box culling (~1 s for complex parts).
- Levenberg–Marquardt sketch solver (like desktop CAD sketchers).
- Surface identity tags (e.g. `e1:top`, `F:f1:0`) survive booleans for face/edge picking and fillet delete.
- Values start at 0 each time (extrude, fillet, chamfer, plane offset, hole diameter).
- No cloud sync; devices share `.caddy.json` files. iPad mode placeholder, after desktop.

Features completed
- Sketch tools: line, rectangle, circle, arc, polygon (sides prompt, corners/flats), offset, move, trim.
- Constraints: H/V, perpendicular, parallel, equal, coincident (incl. point-on-curve), fix, tangent,
  midpoint, angle, point-to-line distance, alignment.
- Dimensions: length, Ø, R, horizontal/vertical, angle, across-flats; edit via double-click/Enter/F2,
  Tab cycling, arrow nudges, math expressions, draggable labels, show/hide; live preview while typing;
  reference dimensions for over-constraint.
- Snaps incl. intersections; Object Snap Tracking with alignment constraints.
- Profiles with arcs, holes, nesting.
- Extrude (one side/symmetric/offset, Join/Cut/New body auto, profile memory, press-pull from faces);
  Revolve (sketch line/origin axis/body edge, partial angles, symmetric); Hole (simple/counterbore/
  countersink, through/depth, faces or sketch points, multiple per feature); Fillet/Chamfer on straight
  and round edges (face click takes all edges, delete a fillet face to remove that edge, re-match).
- Offset planes; ViewCube; Design view and Render view (20 materials, studio lighting, shadows).
- "Sketch view" button; ghost bodies while sketching; browser highlight of sketches.
- Select-first workflow with hover/selection colors, Shift multi-select, right-click viewport menu.
- Command bar with fuzzy, usage-ranked autocomplete; colored toolbar groups; browser tree; timeline.
- Project library with thumbnails, autosave to IndexedDB, Save/Open `.caddy.json`, drag-and-drop.
- Verified: boolean volumes exact; fillet/chamfer within 0.3%; revolve and hole types exact;
  alignment constraints hold on resize; profile memory survives edits; save/load round-trips.

---------------------------------------------------------------------------------------------------
## C. Latest session (Sep 29 – Oct 1): requests and outcomes, in order

1. **"I wouldn't think Text would be needed in the sketch toolbar"** → removed; after learning it is
   for embossed/engraved labels: **"you can add it back"** → kept as a placeholder (needs fonts).
2. **Sweep tool**: profile swept along a path drawn in another sketch; "figure out the correct form".
   → Built with Profile/Path selection boxes, Perpendicular/Parallel, Join/Cut/New body, parametric.
3. **"Sketch view button is apparently gone"** → real bug: browser single-click re-rendered the tree
   so double-click never fired. Fixed; Sketch view only shows while editing and off-square.
4. **"Highlight orange when hovering anything selectable"**; **interference of two faces where the
   path goes straight → curve, show the slanted one**; **black edge lines shown and accurate**.
   → Orange hover for path/axis/hole picks; found inverted end caps + inconsistent hole winding in
   sweep AND revolve (fixed); sharp corners split into runs with exact miter joints.
5. **"When items are selected in a sketch, bold them"** → thick blue band + big dots, constant
   screen width.
6. **Same bolding outside the sketch for selected edges; "you shouldn't be able to select a line or
   individual object within a sketch when not in sketch edit mode"** → camera-facing bold band for
   edges; outside sketch editing a sketch is selected as a whole; double-click edits it.
7. **Moving the path outside/inside the triangle gave a lip and gaps; "make it so the body does its
   best to stay connected"** → tight bends (profile reaching the arc's center) built as exact
   revolves split at the axis; verified closed solids for all path positions.
8. **"Still a lip after the curve"** (miter extending the arc tangent) → new **Sharp corners: Round /
   Mitered** option; Round is default.
9. **"Edges/lines you choose to highlight; overlap on the inside of the triangle on round"** →
   pivot uses only the outer part of the profile; smooth same-feature seams not drawn (later revised).
10. **"Still that weird interface curve→straight on round; the inside should be rounded as well"** →
    Round now replaces each sharp path corner with a smooth bend sized to the profile, so inside and
    outside are both rounded; no seams.
11. **(Mitered) "missing break lines from straight up to a curve; I want these sections selectable"**
    → section boundary lines restored everywhere; each sweep/fillet section is its own selectable face.
12. **"UI cuts off this interface when not full screen"; "update the scroll bar to match themes, more
    modern"** → top bar compacts; page never wider than window; slim theme-matched scrollbars.
13. **"Menu way too far from the edge" → "right side touching the right side of the window"; "allow
    the user to move the menu and remember where they placed it for any tool"** → docked right,
    draggable by title bar, remembered, double-click to re-dock.
14. **"Enhance the graphics of the model… crisp lines… copy this grey for light mode; another easily
    seen shade for dark mode; realistic, not cartoonish"** (Fusion screenshot) → lit satin body with
    camera headlight, Fusion warm grey (#66625A) light / steel grey (#A3A9B0) dark, near-black edges.
15. **Dark mode looked harsh (black and white faces)** → rebalanced: even ambient + softer headlight,
    no reflections in Design view. **"Looks perfect."**
16. **"Let's work on shell and pattern"** → Shell (faces to remove, thickness, inside/outside) and
    Pattern (rectangular/circular, features/bodies), parametric; exact-volume tests.
17. **"Can't click Finish sketch when not full screen"** → pinned; then **"get rid of the button on the
    top right, only have it on the top bar with Dimensions and Constraints"** → done.
18. **Pattern requests**: orange scroll bar in tool menus; **circular radius** typed or set by
    selecting a full circle (sketch/edge/face) whose center becomes the pattern center; **rectangular
    "pick 2 edges (length and height) + rows/columns, equal or custom edge distances, app does the
    rest"** → Fit to edges layout; originals relocate into the layout.
19. **New file showed the previous file's blue selection** → resets clear all selection/highlights.
20. **"Pattern doesn't work at all; hole isn't what I wanted"** → hole markers redesigned (ring +
    crosshair, blue; orange hover) and **draggable on the face**; new general rule: **anything
    selectable can be picked from the Browser or History** (e.g. pick Hole1 in History for Pattern).
    Pattern's zero-spacing default was the real reason nothing appeared → now flagged.
21. **"Spacing between each hole should match the spacing from the outermost hole and the edge"** →
    Equal = equal clear gaps using the object's real width; Custom edge gaps measured to the outside.
22. **Couldn't select a sketch circle on a face for the circular pattern; "let anything and
    everything highlight orange when selectable and bold blue when selected" (present and future
    tools); sketching on a face: body shouldn't go transparent, face should be the sketch view, snap
    to face edge midpoints and other critical points** → all done.
23. Asked about a built-in slicer / G-code → **parked**: "don't want to break anyone's 3D printers".
24. **STL/3MF export, saving JSON to the device, full audit** → binary STL and 3MF verified with
    independent tools (exact volume, watertight); claude.ai forced a .zip wrapper (not needed in the
    real app); placeholder message fixed; save/load verified for sweep/shell/pattern.
25. **Centered save menu (desktop only) to choose destination and rename (versions etc.); iPad should
    do the same via the Files app** → Save window with name, +Version, +Date, format switch, summary;
    real Save As in the standalone app; iPad noted.
26. Next steps discussed: print a real part; finish Mirror + Overhang check; move to the real engine
    (OpenCascade.js, runs fully in the browser via WebAssembly) using **Claude Code**; then iPad.
    The owner installed the Claude desktop app and asked for this handoff.
