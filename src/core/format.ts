/** Values shown to the user: at most two decimals, no trailing zeros. */
export const fmt = (v: number): string => String(Math.round(v * 100) / 100);
