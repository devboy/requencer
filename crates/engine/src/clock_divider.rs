/// MIDI Pulses Per Quarter Note.
pub const PPQN: u32 = 24;

/// Ticks per sixteenth-note step (PPQN / 4).
pub const TICKS_PER_STEP: u32 = 6;

/// Returns true if the given master tick is a step boundary
/// for the combined track and subtrack clock dividers.
pub fn should_tick(master_tick: u64, track_divider: u8, subtrack_divider: u8) -> bool {
    let combined = TICKS_PER_STEP as u64 * track_divider as u64 * subtrack_divider as u64;
    master_tick.is_multiple_of(combined)
}

/// Compute the effective step index at a given master tick,
/// accounting for hierarchical clock division and wrapping at subtrack length.
pub fn get_effective_step(
    master_tick: u64,
    track_divider: u8,
    subtrack_divider: u8,
    subtrack_length: usize,
) -> usize {
    let combined = TICKS_PER_STEP as u64 * track_divider as u64 * subtrack_divider as u64;
    ((master_tick / combined) % (subtrack_length as u64)) as usize
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_tick_at_step_boundaries() {
        // With dividers = 1, step boundary every 6 ticks
        assert!(should_tick(0, 1, 1));
        assert!(!should_tick(1, 1, 1));
        assert!(!should_tick(5, 1, 1));
        assert!(should_tick(6, 1, 1));
        assert!(should_tick(12, 1, 1));
    }

    #[test]
    fn should_tick_with_track_divider() {
        // Track divider 2: step boundary every 12 ticks
        assert!(should_tick(0, 2, 1));
        assert!(!should_tick(6, 2, 1));
        assert!(should_tick(12, 2, 1));
    }

    #[test]
    fn should_tick_with_subtrack_divider() {
        // Subtrack divider 2: step boundary every 12 ticks
        assert!(should_tick(0, 1, 2));
        assert!(!should_tick(6, 1, 2));
        assert!(should_tick(12, 1, 2));
    }

    #[test]
    fn should_tick_with_combined_dividers() {
        // Track=2, Subtrack=3: step boundary every 36 ticks
        assert!(should_tick(0, 2, 3));
        assert!(!should_tick(6, 2, 3));
        assert!(!should_tick(12, 2, 3));
        assert!(should_tick(36, 2, 3));
    }

    #[test]
    fn effective_step_basic() {
        // Steps 0-15, dividers = 1, length = 16
        for i in 0..16 {
            assert_eq!(get_effective_step(i * 6, 1, 1, 16), i as usize);
        }
    }

    #[test]
    fn effective_step_wraps() {
        // Step 16 wraps to 0 with length=16
        assert_eq!(get_effective_step(16 * 6, 1, 1, 16), 0);
        assert_eq!(get_effective_step(17 * 6, 1, 1, 16), 1);
    }

    #[test]
    fn effective_step_short_length() {
        // Length = 3, should cycle 0, 1, 2, 0, 1, 2, ...
        assert_eq!(get_effective_step(0, 1, 1, 3), 0);
        assert_eq!(get_effective_step(6, 1, 1, 3), 1);
        assert_eq!(get_effective_step(12, 1, 1, 3), 2);
        assert_eq!(get_effective_step(18, 1, 1, 3), 0);
    }

    #[test]
    fn effective_step_with_dividers() {
        // Track divider 2: each step takes 12 ticks
        assert_eq!(get_effective_step(0, 2, 1, 16), 0);
        assert_eq!(get_effective_step(12, 2, 1, 16), 1);
        assert_eq!(get_effective_step(24, 2, 1, 16), 2);
    }
}
