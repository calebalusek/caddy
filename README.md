# CADDY

Parametric 3D CAD for designing parts for 3D printing. A web app: it runs in the browser, there are no
accounts, and projects stay on the user's device (shared as `.caddy.json` files).

- Run it while developing: `npm run dev` (http://localhost:5173)
- Tests: `npm test` (geometry, exact numbers) and `npm run test:ui` (real Chrome)
- Production build: `npm run build` (into `dist/`)

## Publishing (GitHub Pages)
Every push to `main` is tested, built and published by `.github/workflows/pages.yml`.
One-time setup in the GitHub repository: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The site then lives at `https://<user>.github.io/<repository>/`.

## Offline
The build writes `dist/sw.js`, a service worker that saves every file on the user's device on the first
visit. After that CADDY opens with no internet. A new version waits until CADDY is closed and reopened.

## Licenses
The geometry engine (OpenCascade, compiled to WebAssembly) is LGPL-2.1. `public/licenses.html` credits it and
links its source; it is reachable from **File → About and licenses**. Keep it in every published build.
