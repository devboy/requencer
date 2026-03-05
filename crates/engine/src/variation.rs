use crate::math::{clamp, floorf, roundf};
use crate::scales::{snap_to_scale, Scales};
use crate::types::{
    GateStep, ModStep, OverridePattern, PitchStep, Subtrack, SubtrackKey, SubtrackOverride,
    Transform, TransformType, VariationPattern,
};

// ── Transform categorization ──────────────────────────────────────

impl TransformType {
    pub fn is_gate_value(&self) -> bool {
        matches!(
            self,
            Self::Thin
                | Self::Fill
                | Self::SkipEven
                | Self::SkipOdd
                | Self::InvertGates
                | Self::Densify
                | Self::Drop
                | Self::Ratchet
        )
    }

    pub fn is_pitch_value(&self) -> bool {
        matches!(
            self,
            Self::Transpose | Self::Invert | Self::OctaveShift | Self::Fold | Self::Quantize
        )
    }

    pub fn is_velocity_value(&self) -> bool {
        matches!(
            self,
            Self::Accent | Self::FadeIn | Self::FadeOut | Self::Humanize
        )
    }
}

// ── Deterministic hash ────────────────────────────────────────────

/// Deterministic hash for transforms. Returns [0, 1).
fn deterministic_hash(step_index: usize, bar_position: u8) -> f32 {
    let mut h = (step_index as i32)
        .wrapping_mul(0x9E3779B1_u32 as i32)
        .wrapping_add((bar_position as i32).wrapping_mul(0x14498D05_u32 as i32));
    h = (((h as u32 >> 16) ^ h as u32) as i32).wrapping_mul(0x45d9f3b);
    h = (((h as u32 >> 16) ^ h as u32) as i32).wrapping_mul(0x45d9f3b);
    h = ((h as u32 >> 16) ^ h as u32) as i32;
    (h as u32) as f32 / 4294967296.0
}

// ── Playhead transforms ───────────────────────────────────────────

/// Apply a single playhead transform to a step index.
pub fn transform_step_index(idx: usize, length: usize, transform: &Transform) -> usize {
    if length == 0 {
        return 0;
    }
    match transform.transform_type {
        TransformType::Reverse => length - 1 - idx,
        TransformType::PingPong => {
            let half = length / 2;
            if idx < half {
                idx
            } else {
                length - 1 - idx
            }
        }
        TransformType::Rotate => {
            ((idx as i32 + transform.param) as usize) % length
        }
        TransformType::DoubleTime => (idx * 2) % length,
        TransformType::Stutter => {
            let n = (transform.param as usize).min(length).max(1);
            idx % n
        }
        TransformType::HalfTime => idx / 2,
        TransformType::Skip => {
            let p = (transform.param as usize).max(1);
            (idx * p) % length
        }
        TransformType::DrunkWalk => {
            let chaos = transform.param as f32;
            let mut pos: i32 = 0;
            for i in 0..idx {
                let h = deterministic_hash(i, 0);
                if h < chaos {
                    let dir = if deterministic_hash(i, 1) > 0.5 {
                        -1i32
                    } else {
                        0
                    };
                    pos = ((pos + dir) % length as i32 + length as i32) % length as i32;
                } else {
                    pos = (pos + 1) % length as i32;
                }
            }
            pos as usize
        }
        TransformType::Scramble => {
            let half = length.div_ceil(2);
            if idx < half {
                idx * 2
            } else {
                (idx - half) * 2 + 1
            }
        }
        _ => idx,
    }
}

// ── Gate value transforms ─────────────────────────────────────────

fn resolve_gate_on(
    on: bool,
    transform: &Transform,
    step_index: usize,
    bar_position: u8,
) -> bool {
    match transform.transform_type {
        TransformType::Thin => {
            on && deterministic_hash(step_index, bar_position) >= transform.param as f32
        }
        TransformType::Fill => true,
        TransformType::SkipEven => on && !step_index.is_multiple_of(2),
        TransformType::SkipOdd => on && step_index % 2 != 1,
        TransformType::InvertGates => !on,
        TransformType::Densify => {
            on || deterministic_hash(step_index, bar_position) < transform.param as f32
        }
        TransformType::Drop => {
            let p = (transform.param as usize).max(1);
            on && !(step_index + 1).is_multiple_of(p)
        }
        _ => on,
    }
}

/// Apply a gate value transform to a GateStep.
pub fn transform_gate_value(
    step: &GateStep,
    transform: &Transform,
    step_index: usize,
    bar_position: u8,
) -> GateStep {
    if transform.transform_type == TransformType::Ratchet {
        return if step.on {
            GateStep {
                ratchet: transform.param as u8,
                ..step.clone()
            }
        } else {
            step.clone()
        };
    }
    let on = resolve_gate_on(step.on, transform, step_index, bar_position);
    if on == step.on {
        step.clone()
    } else {
        GateStep { on, ..step.clone() }
    }
}

// ── Pitch value transforms ────────────────────────────────────────

/// Quantize scale table.
const QUANTIZE_SCALES_COUNT: usize = 8;

fn get_quantize_scale(index: usize) -> &'static crate::scales::Scale {
    match index {
        0 => &Scales::CHROMATIC,
        1 => &Scales::MAJOR,
        2 => &Scales::MINOR,
        3 => &Scales::MINOR_PENTATONIC,
        4 => &Scales::MAJOR_PENTATONIC,
        5 => &Scales::BLUES,
        6 => &Scales::DORIAN,
        7 => &Scales::WHOLE_TONE,
        _ => &Scales::CHROMATIC,
    }
}

/// Apply a pitch value transform to a PitchStep.
pub fn transform_pitch_value(step: &PitchStep, transform: &Transform) -> PitchStep {
    match transform.transform_type {
        TransformType::Transpose => PitchStep {
            note: (step.note as i32 + transform.param).clamp(0, 127) as u8,
            ..step.clone()
        },
        TransformType::OctaveShift => PitchStep {
            note: (step.note as i32 + transform.param * 12).clamp(0, 127) as u8,
            ..step.clone()
        },
        TransformType::Invert => {
            let center = transform.param;
            let inverted = center + (center - step.note as i32);
            PitchStep {
                note: inverted.clamp(0, 127) as u8,
                ..step.clone()
            }
        }
        TransformType::Fold => {
            let half_range = transform.param / 2;
            let lo = (60 - half_range).max(0);
            let hi = (60 + half_range).min(127);
            let range = hi - lo;
            if range <= 0 {
                return step.clone();
            }
            let mut n = step.note as i32 - lo;
            let period = range * 2;
            n = ((n % period) + period) % period;
            if n > range {
                n = period - n;
            }
            PitchStep {
                note: roundf((lo + n) as f32).clamp(0.0, 127.0) as u8,
                ..step.clone()
            }
        }
        TransformType::Quantize => {
            let idx = floorf(transform.param as f32) as usize;
            let idx = idx.min(QUANTIZE_SCALES_COUNT - 1);
            let scale = get_quantize_scale(idx);
            PitchStep {
                note: snap_to_scale(step.note, 0, scale),
                ..step.clone()
            }
        }
        _ => step.clone(),
    }
}

// ── Velocity value transforms ─────────────────────────────────────

/// Apply a velocity value transform.
pub fn transform_velocity_value(
    step: u8,
    transform: &Transform,
    step_index: usize,
    bar_position: u8,
    length: usize,
) -> u8 {
    match transform.transform_type {
        TransformType::Accent => {
            let p = (transform.param as usize).max(1);
            if step_index.is_multiple_of(p) {
                127
            } else {
                step
            }
        }
        TransformType::FadeIn => {
            let t = if length > 1 {
                step_index as f32 / (length - 1) as f32
            } else {
                1.0
            };
            clamp(roundf(step as f32 * t), 0.0, 127.0) as u8
        }
        TransformType::FadeOut => {
            let t = if length > 1 {
                (length - 1 - step_index) as f32 / (length - 1) as f32
            } else {
                1.0
            };
            clamp(roundf(step as f32 * t), 0.0, 127.0) as u8
        }
        TransformType::Humanize => {
            let hash = deterministic_hash(step_index, bar_position);
            let deviation = (hash - 0.5) * 2.0 * transform.param as f32 * 30.0;
            clamp(roundf(step as f32 + deviation), 1.0, 127.0) as u8
        }
        _ => step,
    }
}

// ── Transform composition ─────────────────────────────────────────

fn apply_playhead_transforms(
    current_step: usize,
    length: usize,
    transforms: &[Transform],
) -> usize {
    let mut idx = current_step;
    for t in transforms {
        if t.transform_type.is_playhead() {
            idx = transform_step_index(idx, length, t);
        }
    }
    idx
}

/// Get effective gate step after applying all transforms.
pub fn get_effective_gate_step(
    subtrack: &Subtrack<GateStep>,
    transforms: &[Transform],
    bar_position: u8,
) -> GateStep {
    let idx = apply_playhead_transforms(subtrack.current_step as usize, subtrack.length as usize, transforms);
    let idx = idx.min(subtrack.steps.len().saturating_sub(1));
    let mut step = subtrack.steps[idx].clone();

    for t in transforms {
        if t.transform_type.is_gate_value() {
            step = transform_gate_value(&step, t, idx, bar_position);
        }
    }

    step
}

/// Get effective pitch step after applying all transforms.
pub fn get_effective_pitch_step(
    subtrack: &Subtrack<PitchStep>,
    transforms: &[Transform],
) -> PitchStep {
    let idx = apply_playhead_transforms(subtrack.current_step as usize, subtrack.length as usize, transforms);
    let idx = idx.min(subtrack.steps.len().saturating_sub(1));
    let mut step = subtrack.steps[idx].clone();

    for t in transforms {
        if t.transform_type.is_pitch_value() {
            step = transform_pitch_value(&step, t);
        }
    }

    step
}

/// Get effective velocity step after applying all transforms.
pub fn get_effective_velocity_step(
    subtrack: &Subtrack<u8>,
    transforms: &[Transform],
    bar_position: u8,
) -> u8 {
    let idx = apply_playhead_transforms(subtrack.current_step as usize, subtrack.length as usize, transforms);
    let idx = idx.min(subtrack.steps.len().saturating_sub(1));
    let mut step = subtrack.steps[idx];

    for t in transforms {
        if t.transform_type.is_velocity_value() {
            step = transform_velocity_value(step, t, idx, bar_position, subtrack.length as usize);
        }
    }

    step
}

/// Get effective mod step after applying playhead transforms.
pub fn get_effective_mod_step(
    subtrack: &Subtrack<ModStep>,
    transforms: &[Transform],
) -> ModStep {
    let idx = apply_playhead_transforms(subtrack.current_step as usize, subtrack.length as usize, transforms);
    let idx = idx.min(subtrack.steps.len().saturating_sub(1));
    subtrack.steps[idx].clone()
}

// ── Per-subtrack transform resolution ─────────────────────────────

/// Resolve which transforms apply to a specific subtrack.
pub fn get_transforms_for_subtrack(
    pattern: &VariationPattern,
    subtrack_key: SubtrackKey,
) -> &[Transform] {
    let override_val = match subtrack_key {
        SubtrackKey::Gate => &pattern.gate_override,
        SubtrackKey::Pitch => &pattern.pitch_override,
        SubtrackKey::Velocity => &pattern.velocity_override,
        SubtrackKey::Mod => &pattern.mod_override,
    };

    match override_val {
        Some(SubtrackOverride::Bypass) => &[],
        Some(SubtrackOverride::Pattern(override_pattern)) => {
            let bar = (override_pattern.current_bar as usize) % override_pattern.slots.len();
            if let Some(slot) = override_pattern.slots.get(bar) {
                slot.transforms.as_slice()
            } else {
                &[]
            }
        }
        None => {
            // Inherit from track-level
            let bar = (pattern.current_bar as usize) % pattern.slots.len();
            if let Some(slot) = pattern.slots.get(bar) {
                slot.transforms.as_slice()
            } else {
                &[]
            }
        }
    }
}

// ── Bar counter advancement ───────────────────────────────────────

/// Advance the track-level variation bar counter.
pub fn advance_variation_bar(pattern: &mut VariationPattern) {
    if !pattern.enabled {
        return;
    }
    pattern.current_bar = (pattern.current_bar + 1) % pattern.length;
}

/// Advance a subtrack override's bar counter.
pub fn advance_override_bar(override_pattern: &mut OverridePattern) {
    override_pattern.current_bar =
        (override_pattern.current_bar + 1) % override_pattern.length;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::VariationSlot;
    use heapless::Vec;

    fn make_transform(t: TransformType, param: i32) -> Transform {
        Transform {
            transform_type: t,
            param,
        }
    }

    // ── Playhead transform tests ──────────────────────────────────

    #[test]
    fn reverse_8_steps() {
        let t = make_transform(TransformType::Reverse, 0);
        assert_eq!(transform_step_index(0, 8, &t), 7);
        assert_eq!(transform_step_index(7, 8, &t), 0);
        assert_eq!(transform_step_index(3, 8, &t), 4);
    }

    #[test]
    fn ping_pong() {
        let t = make_transform(TransformType::PingPong, 0);
        // 8 steps: 0→0, 1→1, 2→2, 3→3, 4→3, 5→2, 6→1, 7→0
        assert_eq!(transform_step_index(0, 8, &t), 0);
        assert_eq!(transform_step_index(3, 8, &t), 3);
        assert_eq!(transform_step_index(4, 8, &t), 3);
        assert_eq!(transform_step_index(7, 8, &t), 0);
    }

    #[test]
    fn rotate_by_2() {
        let t = make_transform(TransformType::Rotate, 2);
        assert_eq!(transform_step_index(0, 8, &t), 2);
        assert_eq!(transform_step_index(6, 8, &t), 0);
    }

    #[test]
    fn double_time() {
        let t = make_transform(TransformType::DoubleTime, 0);
        assert_eq!(transform_step_index(0, 8, &t), 0);
        assert_eq!(transform_step_index(1, 8, &t), 2);
        assert_eq!(transform_step_index(4, 8, &t), 0);
    }

    #[test]
    fn stutter_4() {
        let t = make_transform(TransformType::Stutter, 4);
        assert_eq!(transform_step_index(0, 8, &t), 0);
        assert_eq!(transform_step_index(4, 8, &t), 0);
        assert_eq!(transform_step_index(5, 8, &t), 1);
    }

    #[test]
    fn half_time() {
        let t = make_transform(TransformType::HalfTime, 0);
        assert_eq!(transform_step_index(0, 8, &t), 0);
        assert_eq!(transform_step_index(1, 8, &t), 0);
        assert_eq!(transform_step_index(2, 8, &t), 1);
        assert_eq!(transform_step_index(3, 8, &t), 1);
    }

    #[test]
    fn scramble_interleave() {
        let t = make_transform(TransformType::Scramble, 0);
        // [A,B,C,D,E,F,G,H] → reads [A,C,E,G,B,D,F,H]
        assert_eq!(transform_step_index(0, 8, &t), 0);
        assert_eq!(transform_step_index(1, 8, &t), 2);
        assert_eq!(transform_step_index(2, 8, &t), 4);
        assert_eq!(transform_step_index(3, 8, &t), 6);
        assert_eq!(transform_step_index(4, 8, &t), 1);
    }

    // ── Gate value transform tests ────────────────────────────────

    #[test]
    fn fill_always_on() {
        let step = GateStep {
            on: false,
            ..GateStep::default()
        };
        let t = make_transform(TransformType::Fill, 0);
        let result = transform_gate_value(&step, &t, 0, 0);
        assert!(result.on);
    }

    #[test]
    fn invert_gates() {
        let step_on = GateStep {
            on: true,
            ..GateStep::default()
        };
        let step_off = GateStep {
            on: false,
            ..GateStep::default()
        };
        let t = make_transform(TransformType::InvertGates, 0);
        assert!(!transform_gate_value(&step_on, &t, 0, 0).on);
        assert!(transform_gate_value(&step_off, &t, 0, 0).on);
    }

    #[test]
    fn skip_even() {
        let step = GateStep {
            on: true,
            ..GateStep::default()
        };
        let t = make_transform(TransformType::SkipEven, 0);
        assert!(!transform_gate_value(&step, &t, 0, 0).on); // even index, muted
        assert!(transform_gate_value(&step, &t, 1, 0).on); // odd index, kept
    }

    // ── Pitch value transform tests ───────────────────────────────

    #[test]
    fn transpose_up() {
        let step = PitchStep {
            note: 60,
            slide: 0.0,
        };
        let t = make_transform(TransformType::Transpose, 5);
        let result = transform_pitch_value(&step, &t);
        assert_eq!(result.note, 65);
    }

    #[test]
    fn transpose_clamps() {
        let step = PitchStep {
            note: 125,
            slide: 0.0,
        };
        let t = make_transform(TransformType::Transpose, 10);
        let result = transform_pitch_value(&step, &t);
        assert_eq!(result.note, 127);
    }

    #[test]
    fn octave_shift_up() {
        let step = PitchStep {
            note: 60,
            slide: 0.0,
        };
        let t = make_transform(TransformType::OctaveShift, 1);
        assert_eq!(transform_pitch_value(&step, &t).note, 72);
    }

    #[test]
    fn invert_pitch() {
        let step = PitchStep {
            note: 64,
            slide: 0.0,
        };
        let t = make_transform(TransformType::Invert, 60); // center = 60
        // inverted = 60 + (60 - 64) = 56
        assert_eq!(transform_pitch_value(&step, &t).note, 56);
    }

    // ── Velocity value transform tests ────────────────────────────

    #[test]
    fn accent_every_4th() {
        let t = make_transform(TransformType::Accent, 4);
        assert_eq!(transform_velocity_value(80, &t, 0, 0, 16), 127);
        assert_eq!(transform_velocity_value(80, &t, 1, 0, 16), 80);
        assert_eq!(transform_velocity_value(80, &t, 4, 0, 16), 127);
    }

    #[test]
    fn fade_in() {
        let t = make_transform(TransformType::FadeIn, 0);
        // Step 0/7: velocity * 0 = 0
        assert_eq!(transform_velocity_value(100, &t, 0, 0, 8), 0);
        // Step 7/7: velocity * 1 = 100
        assert_eq!(transform_velocity_value(100, &t, 7, 0, 8), 100);
    }

    #[test]
    fn fade_out() {
        let t = make_transform(TransformType::FadeOut, 0);
        assert_eq!(transform_velocity_value(100, &t, 0, 0, 8), 100);
        assert_eq!(transform_velocity_value(100, &t, 7, 0, 8), 0);
    }

    // ── Composition tests ─────────────────────────────────────────

    #[test]
    fn effective_gate_step_with_reverse_and_fill() {
        let mut steps: Vec<GateStep, 16> = Vec::new();
        for i in 0..8u8 {
            let _ = steps.push(GateStep {
                on: i < 4, // first 4 on, last 4 off
                ..GateStep::default()
            });
        }
        let subtrack = Subtrack {
            steps,
            length: 8,
            clock_divider: 1,
            current_step: 0, // reading step 0
        };

        // Reverse: step 0 → reads step 7 (which is off)
        let transforms = [make_transform(TransformType::Reverse, 0)];
        let result = get_effective_gate_step(&subtrack, &transforms, 0);
        assert!(!result.on);

        // Reverse + Fill: step 0 → reads step 7, then Fill forces on
        let transforms = [
            make_transform(TransformType::Reverse, 0),
            make_transform(TransformType::Fill, 0),
        ];
        let result = get_effective_gate_step(&subtrack, &transforms, 0);
        assert!(result.on);
    }

    // ── Get transforms for subtrack ───────────────────────────────

    #[test]
    fn inherit_track_level_transforms() {
        let mut slots: Vec<VariationSlot, 16> = Vec::new();
        let mut transforms: Vec<Transform, 8> = Vec::new();
        let _ = transforms.push(make_transform(TransformType::Reverse, 0));
        let _ = slots.push(VariationSlot { transforms });

        let pattern = VariationPattern {
            enabled: true,
            length: 1,
            loop_mode: true,
            slots,
            current_bar: 0,
            gate_override: None,
            pitch_override: None,
            velocity_override: None,
            mod_override: None,
        };

        let transforms = get_transforms_for_subtrack(&pattern, SubtrackKey::Gate);
        assert_eq!(transforms.len(), 1);
        assert_eq!(transforms[0].transform_type, TransformType::Reverse);
    }

    #[test]
    fn bypass_returns_empty() {
        let mut slots: Vec<VariationSlot, 16> = Vec::new();
        let mut transforms: Vec<Transform, 8> = Vec::new();
        let _ = transforms.push(make_transform(TransformType::Reverse, 0));
        let _ = slots.push(VariationSlot { transforms });

        let pattern = VariationPattern {
            enabled: true,
            length: 1,
            loop_mode: true,
            slots,
            current_bar: 0,
            gate_override: Some(SubtrackOverride::Bypass),
            pitch_override: None,
            velocity_override: None,
            mod_override: None,
        };

        let transforms = get_transforms_for_subtrack(&pattern, SubtrackKey::Gate);
        assert!(transforms.is_empty());
    }

    // ── Bar advancement ───────────────────────────────────────────

    #[test]
    fn advance_bar_wraps() {
        let mut pattern = VariationPattern::default();
        pattern.enabled = true;
        pattern.length = 4;
        pattern.current_bar = 3;

        advance_variation_bar(&mut pattern);
        assert_eq!(pattern.current_bar, 0);
    }

    #[test]
    fn advance_disabled_noop() {
        let mut pattern = VariationPattern::default();
        pattern.enabled = false;
        pattern.current_bar = 2;

        advance_variation_bar(&mut pattern);
        assert_eq!(pattern.current_bar, 2);
    }
}
