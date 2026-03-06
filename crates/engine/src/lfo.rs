use crate::clock_divider::{PPQN, TICKS_PER_STEP};
use crate::math::{clamp, sinf};
use crate::rng::Rng;
use crate::types::{LfoConfig, LfoRuntime, LfoSyncMode, LfoWaveform};

/// Compute raw waveform value at a given phase (0.0-1.0) with width/skew.
/// Returns 0.0-1.0.
pub fn waveform_value(waveform: LfoWaveform, phase: f32, width: f32) -> f32 {
    match waveform {
        LfoWaveform::Sine => {
            let adjusted_phase = if (width - 0.5).abs() < f32::EPSILON {
                phase
            } else if phase < width {
                (phase / width) * 0.5
            } else {
                0.5 + ((phase - width) / (1.0 - width)) * 0.5
            };
            0.5 + 0.5 * sinf(adjusted_phase * 2.0 * core::f32::consts::PI)
        }
        LfoWaveform::Triangle => {
            let peak = width.clamp(0.001, 0.999);
            if phase < peak {
                phase / peak
            } else {
                1.0 - (phase - peak) / (1.0 - peak)
            }
        }
        LfoWaveform::Saw => {
            let rise = width.clamp(0.001, 0.999);
            if phase < rise {
                phase / rise
            } else {
                1.0 - (phase - rise) / (1.0 - rise)
            }
        }
        LfoWaveform::Square => {
            if phase < width {
                1.0
            } else {
                0.0
            }
        }
        LfoWaveform::SlewRandom | LfoWaveform::SampleAndHold => {
            // Handled by runtime state
            0.0
        }
    }
}

/// Compute LFO value at a given tick.
///
/// For synced mode: phase derived from master_tick and track clock divider.
/// For free mode: phase accumulates based on free_rate and time-per-tick.
///
/// Returns (output_value, updated_runtime).
pub fn compute_lfo_value(
    config: &LfoConfig,
    runtime: &LfoRuntime,
    master_tick: u64,
    track_clock_divider: u8,
    bpm: u16,
) -> (f32, LfoRuntime) {
    let mut new_runtime = runtime.clone();

    let phase = if config.sync_mode == LfoSyncMode::Free {
        // Free-running: accumulate phase based on Hz rate and tick duration
        let tick_duration = 60.0 / bpm as f32 / PPQN as f32;
        let phase_increment = config.free_rate * tick_duration;
        let p = (runtime.current_phase + phase_increment) % 1.0;
        new_runtime.current_phase = p;
        p
    } else {
        // Synced: phase derived deterministically from tick position
        let effective_tick =
            master_tick as f32 / (TICKS_PER_STEP as f32 * track_clock_divider as f32);
        let rate = (config.rate as f32).max(1.0);
        let p = ((effective_tick + config.phase * rate) % rate) / rate;
        // Wrap phase to [0, 1)
        let p = ((p % 1.0) + 1.0) % 1.0;
        new_runtime.current_phase = p;
        p
    };

    // Compute raw waveform value
    let raw = match config.waveform {
        LfoWaveform::SampleAndHold => {
            let trigger_point = config.width;
            let prev_phase = runtime.current_phase;
            let crossed =
                phase < prev_phase || (prev_phase < trigger_point && phase >= trigger_point);
            if crossed || (runtime.last_sh_value == 0.0 && runtime.current_phase == 0.0) {
                let mut rng = Rng::new((master_tick.wrapping_mul(7919) + 31) as u32);
                new_runtime.last_sh_value = rng.next_f32();
            }
            new_runtime.last_sh_value
        }
        LfoWaveform::SlewRandom => {
            let prev_phase = runtime.current_phase;
            let crossed = phase < prev_phase;
            if crossed
                || (runtime.slew_target == 0.0
                    && runtime.slew_current == 0.0
                    && master_tick == 0)
            {
                let mut rng = Rng::new((master_tick.wrapping_mul(7919) + 37) as u32);
                new_runtime.slew_target = rng.next_f32();
            }
            // Interpolate towards target
            let slew_rate = 1.0 - config.width * 0.95;
            new_runtime.slew_current =
                runtime.slew_current + (new_runtime.slew_target - runtime.slew_current) * slew_rate;
            new_runtime.slew_current
        }
        _ => waveform_value(config.waveform, phase, config.width),
    };

    // Apply depth and offset scaling
    let scaled = config.offset + (raw - 0.5) * config.depth;
    let value = clamp(scaled, 0.0, 1.0);

    (value, new_runtime)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_at_key_phases() {
        // Phase 0 = middle (0.5)
        let v = waveform_value(LfoWaveform::Sine, 0.0, 0.5);
        assert!((v - 0.5).abs() < 0.01, "sine(0) = {v}, expected 0.5");

        // Phase 0.25 = peak (1.0)
        let v = waveform_value(LfoWaveform::Sine, 0.25, 0.5);
        assert!((v - 1.0).abs() < 0.01, "sine(0.25) = {v}, expected 1.0");

        // Phase 0.5 = middle (0.5)
        let v = waveform_value(LfoWaveform::Sine, 0.5, 0.5);
        assert!((v - 0.5).abs() < 0.01, "sine(0.5) = {v}, expected 0.5");

        // Phase 0.75 = trough (0.0)
        let v = waveform_value(LfoWaveform::Sine, 0.75, 0.5);
        assert!((v - 0.0).abs() < 0.01, "sine(0.75) = {v}, expected 0.0");
    }

    #[test]
    fn triangle_symmetric() {
        let v = waveform_value(LfoWaveform::Triangle, 0.0, 0.5);
        assert!((v - 0.0).abs() < 0.01);

        let v = waveform_value(LfoWaveform::Triangle, 0.5, 0.5);
        assert!((v - 1.0).abs() < 0.01);

        let v = waveform_value(LfoWaveform::Triangle, 1.0, 0.5);
        assert!((v - 0.0).abs() < 0.01);
    }

    #[test]
    fn square_duty_cycle() {
        assert_eq!(waveform_value(LfoWaveform::Square, 0.3, 0.5), 1.0);
        assert_eq!(waveform_value(LfoWaveform::Square, 0.7, 0.5), 0.0);
        assert_eq!(waveform_value(LfoWaveform::Square, 0.3, 0.25), 0.0);
    }

    #[test]
    fn compute_lfo_synced_deterministic() {
        let config = LfoConfig::default();
        let runtime = LfoRuntime::default();

        let (v1, r1) = compute_lfo_value(&config, &runtime, 0, 1, 120);
        let (v2, _) = compute_lfo_value(&config, &runtime, 0, 1, 120);
        assert_eq!(v1, v2);

        // After advancing ticks, value should change
        let (v3, _) = compute_lfo_value(&config, &r1, 6, 1, 120);
        assert_ne!(v1, v3);
    }

    #[test]
    fn compute_lfo_free_mode() {
        let config = LfoConfig {
            sync_mode: LfoSyncMode::Free,
            free_rate: 1.0,
            ..LfoConfig::default()
        };
        let runtime = LfoRuntime::default();

        let (_, r1) = compute_lfo_value(&config, &runtime, 0, 1, 120);
        assert!(r1.current_phase > 0.0, "free mode should advance phase");
    }
}
