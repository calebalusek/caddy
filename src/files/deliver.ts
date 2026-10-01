// Getting a finished file off the app, three ways:
//   folder   — the system Save As window (Chrome, Edge): the user picks the folder.
//   share    — the share sheet: on an iPad this is "Save to Files", AirDrop, Mail, Messages, or straight into another app
//              such as a slicer. (Chrome on Windows and Android has one too.)
//   download — a normal download into the downloads folder (works everywhere).
import { storage } from '../core/dom';
import { state } from '../app/state';

export type Dest = 'folder' | 'share' | 'download';
export const DEST_KEY = 'caddy-save-dest';

export const hasFolderPicker = (): boolean => typeof (window as any).showSaveFilePicker === 'function';

/** Can the browser hand a file of this kind to the share sheet? (Some browsers only allow certain file types.) */
export function canShare(mime = 'application/octet-stream'): boolean {
  try {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
    return nav.canShare({ files: [new File(['x'], 'test.bin', { type: mime })] });
  } catch { return false; }
}

/** The ways this device can deliver a file, best first for how it is used. */
export function availableDests(): Dest[] {
  const out: Dest[] = [];
  if (hasFolderPicker()) out.push('folder');
  if (canShare() || canShare('application/json')) out.push('share');
  out.push('download');
  return out;
}

/** An iPad shares (Save to Files); a desktop with a Save As window uses it; anything else downloads. */
export function defaultDest(): Dest {
  const have = availableDests(), saved = storage.get(DEST_KEY) as Dest | null;
  if (saved && have.includes(saved)) return saved;
  if (state.device === 'tablet' && have.includes('share')) return 'share';
  return have.includes('folder') ? 'folder' : have.includes('share') && state.device === 'tablet' ? 'share' : 'download';
}

/** A plain download. */
export function downloadFile(filename: string, data: BlobPart, mime: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([data], { type: mime })), a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return true;
  } catch { return false; }
}

export type Delivered = 'shared' | 'downloaded' | 'canceled' | 'failed';

/**
 * Show "your file is ready" with a Share button. The share sheet may only be opened straight from a tap, and
 * building a STEP or STL file takes a moment, so the file is made first and shared with a second tap.
 */
export function offerShare(filename: string, data: BlobPart, mime: string): Promise<Delivered> {
  return new Promise((resolve) => {
    const size = data instanceof Uint8Array ? data.byteLength : typeof data === 'string' ? data.length : 0;
    const wrap = document.createElement('div');
    wrap.className = 'savemodal';
    const kb = size > 1048576 ? (size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(size / 1024)) + ' KB';
    wrap.innerHTML = `<div class="sm-card" role="dialog" aria-modal="true" aria-labelledby="shTitle">
      <div class="sm-head"><h2 id="shTitle">Your file is ready</h2></div>
      <div class="sm-ready"><b>${filename.replace(/[<>&"]/g, '')}</b><span>${kb}</span></div>
      <div class="sm-info">Share opens the share sheet. On an iPad choose <b>Save to Files</b>, AirDrop, Mail, or open it straight in another app.</div>
      <div class="sm-foot"><button class="btn" data-sh="close">Close</button><button class="btn" data-sh="download">Download</button><button class="btn primary" data-sh="share" id="shShare">Share…</button></div>
    </div>`;
    document.body.appendChild(wrap);
    const done = (r: Delivered): void => { wrap.remove(); resolve(r); };
    wrap.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sh]');
      if (!b) { if (e.target === wrap) done('canceled'); return; }
      if (b.dataset.sh === 'close') done('canceled');
      else if (b.dataset.sh === 'download') done(downloadFile(filename, data, mime) ? 'downloaded' : 'failed');
      else {
        const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
        // some browsers accept only a few file types: try the real type, then a general one
        for (const type of [mime, 'application/octet-stream']) {
          const file = new File([data], filename, { type });
          if (!nav.canShare || !nav.canShare({ files: [file] })) continue;
          try { await navigator.share({ files: [file], title: filename }); done('shared'); return; }
          catch (err) {
            if (err && (err as Error).name === 'AbortError') return; // closed the sheet: stay here so it can be tried again
            break;
          }
        }
        done(downloadFile(filename, data, mime) ? 'downloaded' : 'failed'); // sharing did not work: a download still gets the file out
      }
    });
    wrap.querySelector<HTMLElement>('#shShare')!.focus();
  });
}
