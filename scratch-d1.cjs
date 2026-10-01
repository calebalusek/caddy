const fs = require('fs');
function rep(f, pairs) { let t = fs.readFileSync(f, 'utf8'); for (const [a, b] of pairs) { if (!t.includes(a)) throw new Error(f + ' missing: ' + a.slice(0, 80)); t = t.replace(a, () => b); } fs.writeFileSync(f, t); }
rep('src/core/device.ts', [[`  width: Math.min(window.innerWidth, window.innerHeight) * 1 + 0 === 0 ? 0 : Math.max(window.innerWidth, window.innerHeight),`, `  width: Math.max(window.innerWidth, window.innerHeight),`]]);
rep('src/ui/chrome.ts', [
  [`// Placeholder: each mode gets its own settings. The tablet values are where iPad behavior plugs in
// once the desktop version is final.
const DEVICE_SETTINGS = {
  desktop: { label: 'Desktop', touchTargets: 32, gestures: false, pencilSketching: false, commandLine: true },
  tablet: { label: 'iPad', touchTargets: 44, gestures: true, pencilSketching: true, commandLine: 'on-demand' },
} as const;
type Device = keyof typeof DEVICE_SETTINGS;
`, `// Desktop: mouse, keyboard and the command line. iPad: bigger touch targets, an on-screen number pad, drag-to-adjust
// numbers, and a Browser panel that can be put away. Fingers and the Pencil work in both (see view/pointer.ts).
const DEVICE_SETTINGS = {
  desktop: { label: 'Desktop' },
  tablet: { label: 'iPad' },
} as const;
`],
  [`    const m: Device = mode in DEVICE_SETTINGS ? (mode as Device) : 'desktop';
    state.device = m;`, `    const m: Device = mode in DEVICE_SETTINGS ? (mode as Device) : 'desktop';
    state.device = m;
    emit('mode');`],
  [`    message(b.dataset.device === 'tablet'
      ? 'iPad mode is a placeholder for now. Touch gestures, larger controls and Apple Pencil sketching will be added once the desktop version is finished.'
      : 'Desktop mode: mouse, keyboard and command line.');
  });
  apply(storage.get('caddy-device') || 'desktop');`, `    message(b.dataset.device === 'tablet'
      ? 'iPad mode: bigger controls and an on-screen number pad. One finger turns the view, two fingers pan and zoom, the Pencil draws.'
      : 'Desktop mode: mouse, keyboard and command line.');
  });
  // an iPad opens in iPad mode by itself; a choice made with the switch is remembered
  apply(storage.get('caddy-device') || detectDevice(currentHints()));
  // iPad mode can put the Browser panel away to give the model the whole screen
  const bt = document.getElementById('browserToggle');
  const setBrowser = (open: boolean): void => { document.body.classList.toggle('no-browser', !open); bt?.setAttribute('aria-pressed', String(open)); storage.set('caddy-browser', open ? 'open' : 'closed'); };
  bt?.addEventListener('click', () => setBrowser(document.body.classList.contains('no-browser')));
  setBrowser(storage.get('caddy-browser') !== 'closed');`],
  [`import { getUnit, setUnitValue, type Unit } from '../core/units';`, `import { currentHints, detectDevice, type Device } from '../core/device';\nimport { getUnit, setUnitValue, type Unit } from '../core/units';`],
]);
rep('index.html', [
  [`<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="CADDY">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<link rel="apple-touch-icon" href="apple-touch-icon.png">`],
  [`<span class="spacer"></span>
  <span class="devnote" id="devNote">iPad mode: placeholder</span>`, `<span class="spacer"></span>
  <button class="iconbtn browsertoggle" id="browserToggle" aria-pressed="true" aria-label="Show or hide the Browser panel" title="Show or hide the Browser panel"><svg viewBox="0 0 24 24" class="i" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M9 5v14"/></svg></button>`],
]);
rep('public/manifest.webmanifest', [[`  "icons": [{ "src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" }]`, `  "orientation": "any",
  "icons": [
    { "src": "icon.svg", "sizes": "any", "type": "image/svg+xml", "purpose": "any" },
    { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
    { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" }
  ]`]]);
fs.appendFileSync('src/styles/app.css', `
/* ---- iPad mode: fingers and the Pencil. Bigger targets, no accidental selecting or zooming, room for the system bars. ---- */
.browsertoggle{display:none}
:root[data-device="tablet"] .browsertoggle{display:grid}
:root[data-device="tablet"] .devnote{display:none}
body.no-browser .workspace{grid-template-columns:minmax(0,1fr)}
body.no-browser .browser{display:none}
:root[data-device="tablet"] body{padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;overscroll-behavior:none}
:root[data-device="tablet"] :not(input):not(textarea){-webkit-user-select:none;user-select:none}
:root[data-device="tablet"] input,:root[data-device="tablet"] textarea{font-size:16px}
:root[data-device="tablet"] .tbtn{min-width:70px;min-height:58px;padding:8px 8px 5px}
:root[data-device="tablet"] .tbtn svg.i{width:27px;height:27px}
:root[data-device="tablet"] .btn{min-height:44px;padding:9px 20px;font-size:15px}
:root[data-device="tablet"] .iconbtn{min-width:44px;min-height:44px}
:root[data-device="tablet"] .rowbtn{min-height:42px;padding:8px 8px;font-size:15px}
:root[data-device="tablet"] .browser summary{padding:11px 8px;font-size:15px}
:root[data-device="tablet"] .tl-item{width:48px;height:42px}
:root[data-device="tablet"] .tl-item svg.i{width:21px;height:21px}
:root[data-device="tablet"] .seg-row span{padding:12px 8px;font-size:15px}
:root[data-device="tablet"] .dialog .len-input,:root[data-device="tablet"] .dialog .txt-input{min-height:46px}
:root[data-device="tablet"] .dialog{width:min(340px,calc(100vw - 16px))}
:root[data-device="tablet"] .devswitch button,:root[data-device="tablet"] .unitswitch button{min-height:38px}
:root[data-device="tablet"] .dimlbl{padding:4px 10px;font-size:15px}
:root[data-device="tablet"] .viewcube{transform:scale(1.15);transform-origin:top right}
:root[data-device="tablet"] .vhint{display:none}
`);
