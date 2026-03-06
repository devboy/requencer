use crate::clock_divider::PPQN;
use crate::math::roundf;

/// Number of intervals to average for BPM recovery (= max stored).
const MAX_INTERVALS: usize = 24; // 1 quarter note at 24 PPQN

/// State for recovering BPM from external MIDI clock ticks.
#[derive(Clone, Debug, PartialEq)]
pub struct ClockRecoveryState {
    /// Recent inter-tick intervals in seconds.
    intervals: [f32; MAX_INTERVALS],
    /// Number of valid intervals stored.
    count: u8,
    /// Write position (circular buffer).
    write_pos: u8,
    /// Timestamp (seconds) of last received clock tick, negative if none yet.
    last_tick_time: f32,
    /// Recovered BPM (0 if not enough data yet).
    pub bpm: u16,
}

impl ClockRecoveryState {
    pub fn new() -> Self {
        Self {
            intervals: [0.0; MAX_INTERVALS],
            count: 0,
            write_pos: 0,
            last_tick_time: -1.0,
            bpm: 0,
        }
    }

    /// Process an incoming MIDI clock tick. Updates recovered BPM.
    pub fn process_tick(&mut self, time_seconds: f32) {
        if self.last_tick_time < 0.0 {
            // First tick — just record time
            self.last_tick_time = time_seconds;
            return;
        }

        let interval = time_seconds - self.last_tick_time;
        self.last_tick_time = time_seconds;

        // Reject obviously invalid intervals (< 1ms or > 2s)
        if !(0.001..=2.0).contains(&interval) {
            return;
        }

        // Add to circular buffer
        let pos = self.write_pos as usize;
        self.intervals[pos] = interval;
        self.write_pos = (self.write_pos + 1) % MAX_INTERVALS as u8;
        if (self.count as usize) < MAX_INTERVALS {
            self.count += 1;
        }

        // Need at least 4 intervals for a reasonable estimate
        if self.count >= 4 {
            let n = self.count as usize;
            let mut sum = 0.0_f32;
            for i in 0..n {
                sum += self.intervals[i];
            }
            let avg = sum / n as f32;
            // BPM = 60 / (avgTickInterval * PPQN)
            let raw_bpm = roundf(60.0 / (avg * PPQN as f32)) as u16;
            self.bpm = raw_bpm.clamp(20, 300);
        }
    }

    /// Reset clock recovery state.
    pub fn reset(&mut self) {
        *self = Self::new();
    }
}

impl Default for ClockRecoveryState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initial_state() {
        let state = ClockRecoveryState::new();
        assert_eq!(state.bpm, 0);
    }

    #[test]
    fn first_tick_no_bpm() {
        let mut state = ClockRecoveryState::new();
        state.process_tick(0.0);
        assert_eq!(state.bpm, 0);
    }

    #[test]
    fn recover_120_bpm() {
        let mut state = ClockRecoveryState::new();
        // 120 BPM = 2 beats/sec, 24 PPQN = 48 ticks/sec
        // interval = 1/48 = 0.020833s
        let interval = 1.0 / 48.0;
        for i in 0..10 {
            state.process_tick(i as f32 * interval);
        }
        assert_eq!(state.bpm, 120);
    }

    #[test]
    fn recover_135_bpm() {
        let mut state = ClockRecoveryState::new();
        // 135 BPM = 2.25 beats/sec, 24 PPQN = 54 ticks/sec
        let interval = 60.0 / (135.0 * 24.0);
        for i in 0..10 {
            state.process_tick(i as f32 * interval);
        }
        assert_eq!(state.bpm, 135);
    }

    #[test]
    fn rejects_invalid_intervals() {
        let mut state = ClockRecoveryState::new();
        state.process_tick(0.0);
        // Too small
        state.process_tick(0.0001);
        assert_eq!(state.bpm, 0);
    }

    #[test]
    fn reset_clears_state() {
        let mut state = ClockRecoveryState::new();
        let interval = 1.0 / 48.0;
        for i in 0..10 {
            state.process_tick(i as f32 * interval);
        }
        assert!(state.bpm > 0);
        state.reset();
        assert_eq!(state.bpm, 0);
    }

    #[test]
    fn clamps_bpm_range() {
        let mut state = ClockRecoveryState::new();
        // Very fast clock → would exceed 300 BPM
        let interval = 60.0 / (400.0 * 24.0);
        for i in 0..10 {
            state.process_tick(i as f32 * interval);
        }
        assert!(state.bpm <= 300);
    }
}
