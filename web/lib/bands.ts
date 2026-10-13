// Finds horizontal bands of a pack that are mostly dark (e.g. a coloured banner
// with the product name printed in white). Tesseract reads the whole frame as
// dark-on-light text and skips these, so we OCR them separately.

export type Band = { top: number; bottom: number };

/** `darkShare[y]` is the fraction (0-1) of dark pixels in row y. */
export function findDarkBands(darkShare: ArrayLike<number>, opts: { threshold?: number; minHeight?: number; max?: number } = {}): Band[] {
  const threshold = opts.threshold ?? 0.5;
  const minHeight = opts.minHeight ?? Math.max(16, Math.round(darkShare.length * 0.03));
  const max = opts.max ?? 3;
  const bands: Band[] = [];
  let start = -1;
  for (let y = 0; y <= darkShare.length; y++) {
    const dark = y < darkShare.length && darkShare[y] >= threshold;
    if (dark && start < 0) start = y;
    if (!dark && start >= 0) {
      if (y - start >= minHeight) bands.push({ top: start, bottom: y });
      start = -1;
    }
  }
  // A band covering nearly the whole frame is just a dark photo, not a banner.
  return bands
    .filter((b) => b.bottom - b.top < darkShare.length * 0.8)
    .sort((a, b) => b.bottom - b.top - (a.bottom - a.top))
    .slice(0, max);
}
