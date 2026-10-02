const FOG_HOLD_MS = 12_000;
const FOG_FADE_MS = 8_000;

/** Spread quickly, remain wipeable, then evaporate gradually. */
export function getBreathBloomOpacity(elapsedMs: number, spreadDurationMs: number): number {
  if (elapsedMs < 0) return 0;
  const fadeStartedAt = spreadDurationMs + FOG_HOLD_MS;
  if (elapsedMs <= fadeStartedAt) {
    return Math.min(1, elapsedMs / (spreadDurationMs * 0.2));
  }
  return Math.max(0, 1 - (elapsedMs - fadeStartedAt) / FOG_FADE_MS);
}
