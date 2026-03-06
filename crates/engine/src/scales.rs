use heapless::Vec;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

/// A musical scale definition.
#[derive(Clone, Debug, PartialEq)]
pub struct Scale {
    pub name: &'static str,
    pub intervals: &'static [u8],
}

/// All available scales.
pub struct Scales;

impl Scales {
    pub const MAJOR: Scale = Scale {
        name: "Major",
        intervals: &[0, 2, 4, 5, 7, 9, 11],
    };
    pub const MINOR: Scale = Scale {
        name: "Minor",
        intervals: &[0, 2, 3, 5, 7, 8, 10],
    };
    pub const DORIAN: Scale = Scale {
        name: "Dorian",
        intervals: &[0, 2, 3, 5, 7, 9, 10],
    };
    pub const PHRYGIAN: Scale = Scale {
        name: "Phrygian",
        intervals: &[0, 1, 3, 5, 7, 8, 10],
    };
    pub const MIXOLYDIAN: Scale = Scale {
        name: "Mixolydian",
        intervals: &[0, 2, 4, 5, 7, 9, 10],
    };
    pub const MINOR_PENTATONIC: Scale = Scale {
        name: "Minor Pentatonic",
        intervals: &[0, 3, 5, 7, 10],
    };
    pub const MAJOR_PENTATONIC: Scale = Scale {
        name: "Major Pentatonic",
        intervals: &[0, 2, 4, 7, 9],
    };
    pub const BLUES: Scale = Scale {
        name: "Blues",
        intervals: &[0, 3, 5, 6, 7, 10],
    };
    pub const CHROMATIC: Scale = Scale {
        name: "Chromatic",
        intervals: &[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    };
    pub const WHOLE_TONE: Scale = Scale {
        name: "Whole Tone",
        intervals: &[0, 2, 4, 6, 8, 10],
    };

    /// All scales in definition order.
    pub const ALL: &'static [Scale] = &[
        Self::MAJOR,
        Self::MINOR,
        Self::DORIAN,
        Self::PHRYGIAN,
        Self::MIXOLYDIAN,
        Self::MINOR_PENTATONIC,
        Self::MAJOR_PENTATONIC,
        Self::BLUES,
        Self::CHROMATIC,
        Self::WHOLE_TONE,
    ];
}

impl Serialize for Scale {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let index = Scales::ALL
            .iter()
            .position(|s| s.intervals == self.intervals)
            .unwrap_or(0) as u8;
        serializer.serialize_u8(index)
    }
}

impl<'de> Deserialize<'de> for Scale {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let index = u8::deserialize(deserializer)? as usize;
        if index < Scales::ALL.len() {
            Ok(Scales::ALL[index].clone())
        } else {
            Ok(Scales::CHROMATIC.clone())
        }
    }
}

/// Return all MIDI notes in [low, high] that belong to the given scale at the given root.
pub fn get_scale_notes(root: u8, scale: &Scale, low: u8, high: u8) -> Vec<u8, 128> {
    let mut notes = Vec::new();
    for note in low..=high {
        let interval = ((note as i16 - root as i16).rem_euclid(12)) as u8;
        if scale.intervals.contains(&interval) {
            let _ = notes.push(note);
        }
    }
    notes
}

/// Snap a note to the nearest scale degree. Ties snap down.
pub fn snap_to_scale(note: u8, root: u8, scale: &Scale) -> u8 {
    let interval = ((note as i16 - root as i16).rem_euclid(12)) as u8;
    if scale.intervals.contains(&interval) {
        return note;
    }

    // Search outward from note for nearest scale degree
    for offset in 1..=6 {
        // Check below first (snap down on tie)
        if note >= offset {
            let below = note - offset;
            let below_interval = ((below as i16 - root as i16).rem_euclid(12)) as u8;
            if scale.intervals.contains(&below_interval) {
                return below;
            }
        }
        // Check above
        if note + offset <= 127 {
            let above = note + offset;
            let above_interval = ((above as i16 - root as i16).rem_euclid(12)) as u8;
            if scale.intervals.contains(&above_interval) {
                return above;
            }
        }
    }

    note
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn major_scale_notes_60_72() {
        let notes = get_scale_notes(60, &Scales::MAJOR, 60, 72);
        let expected: &[u8] = &[60, 62, 64, 65, 67, 69, 71, 72];
        assert_eq!(notes.as_slice(), expected);
    }

    #[test]
    fn minor_pentatonic_48_72() {
        let notes = get_scale_notes(48, &Scales::MINOR_PENTATONIC, 48, 72);
        let expected: &[u8] = &[48, 51, 53, 55, 58, 60, 63, 65, 67, 70, 72];
        assert_eq!(notes.as_slice(), expected);
    }

    #[test]
    fn snap_to_scale_already_in() {
        assert_eq!(snap_to_scale(60, 60, &Scales::MAJOR), 60);
        assert_eq!(snap_to_scale(62, 60, &Scales::MAJOR), 62);
    }

    #[test]
    fn snap_to_scale_snaps_down_on_tie() {
        // 61 (C#) is between 60 (C) and 62 (D) in C major — snap down to 60
        assert_eq!(snap_to_scale(61, 60, &Scales::MAJOR), 60);
    }

    #[test]
    fn snap_63_major_60() {
        // 63 (Eb) → nearest in C major: 62 (D) or 64 (E), both distance 1 → snap down to 62
        assert_eq!(snap_to_scale(63, 60, &Scales::MAJOR), 62);
    }

    #[test]
    fn scale_serde_round_trip() {
        use postcard::{from_bytes, to_allocvec};
        for (i, scale) in Scales::ALL.iter().enumerate() {
            let bytes = to_allocvec(scale).unwrap();
            let restored: Scale = from_bytes(&bytes).unwrap();
            assert_eq!(restored.name, Scales::ALL[i].name);
            assert_eq!(restored.intervals, Scales::ALL[i].intervals);
        }
    }

    #[test]
    fn chromatic_never_snaps() {
        for note in 0..=127 {
            assert_eq!(snap_to_scale(note, 60, &Scales::CHROMATIC), note);
        }
    }
}
