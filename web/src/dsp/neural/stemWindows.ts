/**
 * Preparation geometry for optional local stem separation, NOT a Demucs implementation.
 * The inference implementation must separately handle context/padding/overlap reconstruction.
 */
export interface StemWindow {
  startSeconds: number;
  durationSeconds: number;
  useFromSeconds: number;
  useUntilSeconds: number;
}
export function planStemWindows(
  regionStartSeconds: number, regionEndSeconds: number,
  windowSeconds = 20, overlapSeconds = 2
): readonly StemWindow[] {
  if (![regionStartSeconds, regionEndSeconds, windowSeconds, overlapSeconds].every(Number.isFinite) ||
      regionStartSeconds < 0 || regionEndSeconds <= regionStartSeconds ||
      windowSeconds < 15 || windowSeconds > 30 || overlapSeconds < 0 || overlapSeconds >= windowSeconds / 2 ||
      regionEndSeconds - regionStartSeconds > 600) {
    throw new RangeError("Stem work must use bounded 15–30-second preparation windows");
  }
  const result: StemWindow[] = [];
  for (let usedStart = regionStartSeconds; usedStart < regionEndSeconds;) {
    const usedEnd = Math.min(regionEndSeconds, usedStart + windowSeconds - 2 * overlapSeconds);
    const start = Math.max(regionStartSeconds, usedStart - overlapSeconds);
    const end = Math.min(regionEndSeconds, usedEnd + overlapSeconds);
    result.push({
      startSeconds:start, durationSeconds:end-start,
      useFromSeconds:usedStart, useUntilSeconds:usedEnd
    });
    usedStart = usedEnd;
  }
  return result;
}
