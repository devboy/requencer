use heapless::Vec;

use crate::math::floorf;
use crate::rng::Rng;
use crate::scales::Scale;
use crate::MAX_STEPS;

/// Extract chord intervals from a scale (root, 3rd, 5th, 7th).
/// For scales with 7+ notes, picks tertial stacking (indices 0, 2, 4, 6).
/// For 5-6 note scales, takes first 4 intervals.
/// For <=4 note scales, uses all intervals.
pub fn get_chord_notes(scale: &Scale) -> Vec<u8, 12> {
    let intervals = scale.intervals;
    let mut result = Vec::new();

    if intervals.len() <= 4 {
        for &i in intervals {
            let _ = result.push(i);
        }
    } else if intervals.len() < 7 {
        for &i in intervals.iter().take(4) {
            let _ = result.push(i);
        }
    } else {
        // 7+ notes: tertial stacking (every other: indices 0, 2, 4, 6)
        let mut count = 0;
        let mut idx = 0;
        while idx < intervals.len() && count < 4 {
            let _ = result.push(intervals[idx]);
            count += 1;
            idx += 2;
        }
    }

    result
}

/// Build the full set of MIDI notes for chord tones across octave range.
fn build_note_set(root: u8, chord_intervals: &[u8], octave_range: u8) -> Vec<u8, 48> {
    let mut notes = Vec::new();
    for oct in 0..octave_range {
        for &interval in chord_intervals {
            let note = root as i16 + interval as i16 + oct as i16 * 12;
            if (0..=127).contains(&note) {
                let _ = notes.push(note as u8);
            }
        }
    }
    notes
}

/// Direction for arp pattern generation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ArpDirection {
    Up,
    Down,
    Triangle,
    Random,
}

/// Generate a pitch pattern by walking chord tones in a direction.
pub fn generate_arp_pattern(
    root: u8,
    scale: &Scale,
    direction: ArpDirection,
    octave_range: u8,
    length: usize,
    seed: u32,
) -> Vec<u8, MAX_STEPS> {
    let chord_intervals = get_chord_notes(scale);
    let note_set = build_note_set(root, &chord_intervals, octave_range);
    let mut pattern = Vec::new();

    if note_set.is_empty() {
        let clamped = root.min(127);
        for _ in 0..length {
            let _ = pattern.push(clamped);
        }
        return pattern;
    }

    let n = note_set.len();

    match direction {
        ArpDirection::Up => {
            for i in 0..length {
                let _ = pattern.push(note_set[i % n]);
            }
        }
        ArpDirection::Down => {
            for i in 0..length {
                let _ = pattern.push(note_set[n - 1 - (i % n)]);
            }
        }
        ArpDirection::Triangle => {
            // Build ping-pong cycle
            let mut cycle: Vec<u8, 48> = Vec::new();
            for &note in note_set.iter() {
                let _ = cycle.push(note);
            }
            if n > 2 {
                for i in (1..n - 1).rev() {
                    let _ = cycle.push(note_set[i]);
                }
            }
            let cycle_len = cycle.len();
            for i in 0..length {
                let _ = pattern.push(cycle[i % cycle_len]);
            }
        }
        ArpDirection::Random => {
            let mut rng = Rng::new(seed);
            let mut idx = floorf(rng.next_f32() * n as f32) as usize;
            if idx >= n {
                idx = n - 1;
            }
            for _ in 0..length {
                let _ = pattern.push(note_set[idx]);
                let dir: i32 = if rng.next_f32() < 0.5 { 1 } else { -1 };
                let new_idx = idx as i32 + dir;
                idx = new_idx.max(0).min(n as i32 - 1) as usize;
            }
        }
    }

    pattern
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scales::Scales;

    #[test]
    fn chord_notes_major() {
        let chord = get_chord_notes(&Scales::MAJOR);
        // Major: intervals [0,2,4,5,7,9,11] -> tertial: indices 0,2,4,6 -> [0,4,7,11]
        assert_eq!(chord.as_slice(), &[0, 4, 7, 11]);
    }

    #[test]
    fn chord_notes_minor_pentatonic() {
        let chord = get_chord_notes(&Scales::MINOR_PENTATONIC);
        // Minor pent: intervals [0,3,5,7,10] -> 5 notes, take first 4 -> [0,3,5,7]
        assert_eq!(chord.as_slice(), &[0, 3, 5, 7]);
    }

    #[test]
    fn chord_notes_small_scale() {
        // A scale with <=4 notes returns all
        let scale = Scale {
            name: "test",
            intervals: &[0, 5, 7],
        };
        let chord = get_chord_notes(&scale);
        assert_eq!(chord.as_slice(), &[0, 5, 7]);
    }

    #[test]
    fn arp_up_pattern() {
        let pattern = generate_arp_pattern(60, &Scales::MAJOR, ArpDirection::Up, 1, 8, 42);
        // Chord notes at root 60: 60, 64, 67, 71 (C E G B)
        // Up wraps: 60,64,67,71,60,64,67,71
        assert_eq!(
            pattern.as_slice(),
            &[60, 64, 67, 71, 60, 64, 67, 71]
        );
    }

    #[test]
    fn arp_down_pattern() {
        let pattern = generate_arp_pattern(60, &Scales::MAJOR, ArpDirection::Down, 1, 4, 42);
        // Down: reversed note set [71,67,64,60]
        assert_eq!(pattern.as_slice(), &[71, 67, 64, 60]);
    }

    #[test]
    fn arp_triangle_pattern() {
        let pattern = generate_arp_pattern(60, &Scales::MAJOR, ArpDirection::Triangle, 1, 8, 42);
        // Note set: [60,64,67,71], cycle: [60,64,67,71,67,64], len=6
        // 8 steps: 60,64,67,71,67,64,60,64
        assert_eq!(
            pattern.as_slice(),
            &[60, 64, 67, 71, 67, 64, 60, 64]
        );
    }

    #[test]
    fn arp_random_deterministic() {
        let p1 = generate_arp_pattern(60, &Scales::MAJOR, ArpDirection::Random, 1, 8, 42);
        let p2 = generate_arp_pattern(60, &Scales::MAJOR, ArpDirection::Random, 1, 8, 42);
        assert_eq!(p1, p2);
    }

    #[test]
    fn arp_multi_octave() {
        let pattern = generate_arp_pattern(60, &Scales::MAJOR, ArpDirection::Up, 2, 8, 42);
        // 2 octaves: [60,64,67,71,72,76,79,83]
        assert_eq!(
            pattern.as_slice(),
            &[60, 64, 67, 71, 72, 76, 79, 83]
        );
    }
}
