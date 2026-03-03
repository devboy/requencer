/** MIDI-standard pulses per quarter note */
export const PPQN = 24

/** Sub-ticks per 16th-note step (24 PPQN / 4 sixteenths per quarter) */
export const TICKS_PER_STEP = PPQN / 4 // = 6

/**
 * Determines if a subtrack should advance on this master tick.
 * Combined divider = TICKS_PER_STEP × trackDivider × subtrackDivider.
 */
export function shouldTick(masterTick: number, trackDivider: number, subtrackDivider: number): boolean {
  const combined = TICKS_PER_STEP * trackDivider * subtrackDivider
  return masterTick % combined === 0
}

/**
 * Computes which step index a subtrack is on at a given master tick.
 * Accounts for TICKS_PER_STEP, hierarchical clock division, and wraps at subtrack length.
 */
export function getEffectiveStep(
  masterTick: number,
  trackDivider: number,
  subtrackDivider: number,
  subtrackLength: number,
): number {
  const combined = TICKS_PER_STEP * trackDivider * subtrackDivider
  return Math.floor(masterTick / combined) % subtrackLength
}
