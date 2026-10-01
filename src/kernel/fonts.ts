// The fonts text can be set in. They are small files bundled with the app (no downloads from other sites).
import { loadFont } from 'replicad';

export const FONTS = ['Barlow', 'Barlow Bold'] as const;
export type FontName = (typeof FONTS)[number];

/** Register the fonts with the kernel. `get` returns a font file (TTF, OTF or WOFF) by name. */
export async function installFonts(get: (name: FontName) => Promise<ArrayBuffer>): Promise<void> {
  for (const name of FONTS) await loadFont(await get(name), name);
}
