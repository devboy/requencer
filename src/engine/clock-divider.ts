/**
 * Determines if a subtrack should advance on this master tick.
 * Combined divider = trackDivider × subtrackDivider.
 */
export function shouldTick(masterTick: number, trackDivider: number, subtrackDivider: number): boolean {
  const combined = trackDivider * subtrackDivider
  return masterTick % combined === 0
}

/**
 * Computes which step index a subtrack is on at a given master tick.
 * Accounts for hierarchical clock division and wraps at subtrack length.
 */
export function getEffectiveStep(
  masterTick: number,
  trackDivider: number,
  subtrackDivider: number,
  subtrackLength: number,
): number {
  const combined = trackDivider * subtrackDivider
  return Math.floor(masterTick / combined) % subtrackLength
}
