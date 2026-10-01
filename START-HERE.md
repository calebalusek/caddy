# Moving CADDY to Claude Code — start here

## 1. Put the files in place
1. Unzip `caddy-handoff.zip` somewhere easy, e.g. `Documents/caddy`.
2. You should see:
   - `CLAUDE.md` — project memory (Claude Code reads it automatically every session)
   - `KICKOFF-PROMPT.md` — the first message to send
   - `docs/` — SPEC, HISTORY, ACCEPTANCE-TESTS
   - `reference/` — the working prototype (`caddy-prototype.html`) and its source
3. Double-click `reference/caddy-prototype.html` any time to use the current prototype offline.

## 2. Open the folder in Claude Code
- **Desktop app**: open Claude, switch to the **Code** tab, and choose the `caddy` folder as the
  project/working folder.
- **Or terminal**: `cd` into the folder and run `claude`.

## 3. Send the kickoff message
Open `KICKOFF-PROMPT.md`, copy everything in it, paste it as your first message.
Claude Code will read the docs, propose a plan, and wait for your OK before building.

## 4. Working day to day
- Talk to it the same way as before: plain English + screenshots (drag images into the chat).
- It runs the app locally; it will tell you the address to open (e.g. `http://localhost:5173`).
  Refresh the page to see changes.
- It will ask before running commands at first; you can allow common ones so it asks less.
- Ask it to **commit** after each working change (git) so anything can be rolled back.
- New standing rules ("from now on, …")? Ask it to add them to `CLAUDE.md`.

## 5. Putting it online (later)
When you're ready, ask Claude Code to publish it to GitHub Pages / Netlify / Cloudflare Pages.
You get your own link; no claude.ai limits (plain STL/3MF files, real Save As window).
