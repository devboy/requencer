use embedded_graphics::pixelcolor::Rgb565;

/// Convert 24-bit RGB hex to Rgb565.
const fn rgb(r: u8, g: u8, b: u8) -> Rgb565 {
    Rgb565::new(r >> 3, g >> 2, b >> 3)
}

// ── Background ───────────────────────────────────────────────────────
pub const BG: Rgb565 = rgb(0x1a, 0x1a, 0x2e);
pub const LCD_BG: Rgb565 = rgb(0x0a, 0x0a, 0x14);
pub const STATUS_BAR: Rgb565 = rgb(0x12, 0x12, 0x2a);
pub const GRID_BG: Rgb565 = rgb(0x1a, 0x1a, 0x2e);

// ── Track colors ─────────────────────────────────────────────────────
pub const TRACK: [Rgb565; 4] = [
    rgb(0xe9, 0x45, 0x60), // red
    rgb(0xf5, 0xa6, 0x23), // orange
    rgb(0x50, 0xc8, 0x78), // green
    rgb(0x4f, 0xc3, 0xf7), // cyan
];

pub const TRACK_DIM: [Rgb565; 4] = [
    rgb(0x5a, 0x1a, 0x28),
    rgb(0x5a, 0x3f, 0x10),
    rgb(0x1e, 0x4a, 0x2e),
    rgb(0x1c, 0x4a, 0x5a),
];

// ── Step states ──────────────────────────────────────────────────────
pub const STEP_OFF: Rgb565 = rgb(0x2a, 0x2a, 0x4a);
pub const STEP_MUTED: Rgb565 = rgb(0x3a, 0x1a, 0x28);
pub const PLAYHEAD: Rgb565 = rgb(0xff, 0xff, 0xff);

// ── Text ─────────────────────────────────────────────────────────────
pub const TEXT: Rgb565 = rgb(0xe0, 0xe0, 0xe0);
pub const TEXT_DIM: Rgb565 = rgb(0x6a, 0x6a, 0x8a);
pub const TEXT_BRIGHT: Rgb565 = rgb(0xff, 0xff, 0xff);

// ── UI elements ──────────────────────────────────────────────────────
pub const ACCENT: Rgb565 = rgb(0xe9, 0x45, 0x60);
pub const BUTTON_BG: Rgb565 = rgb(0x2a, 0x2a, 0x4a);
pub const SELECTED_ROW: Rgb565 = rgb(0x20, 0x20, 0x3a);
pub const DROPDOWN_BG: Rgb565 = rgb(0x0c, 0x0c, 0x20);
pub const DROPDOWN_SEL: Rgb565 = rgb(0x28, 0x20, 0x3a);
pub const DROPDOWN_BORDER: Rgb565 = rgb(0x3a, 0x3a, 0x5a);

// ── Transport ────────────────────────────────────────────────────────
pub const PLAY_GREEN: Rgb565 = rgb(0x44, 0xff, 0x66);
pub const STOP_DIM: Rgb565 = rgb(0x6a, 0x6a, 0x8a);

// ── Note name lookup ─────────────────────────────────────────────────
const NOTE_NAMES: [&str; 12] = [
    "C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B",
];

/// Get note name string for MIDI note number.
/// Returns (name, octave) e.g. ("C", 4) for MIDI 60.
pub fn midi_note_name(midi: u8) -> (&'static str, i8) {
    let name = NOTE_NAMES[(midi % 12) as usize];
    let octave = (midi as i8 / 12) - 1;
    (name, octave)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn midi_note_name_c4() {
        let (name, oct) = midi_note_name(60);
        assert_eq!(name, "C");
        assert_eq!(oct, 4);
    }

    #[test]
    fn midi_note_name_a4() {
        let (name, oct) = midi_note_name(69);
        assert_eq!(name, "A");
        assert_eq!(oct, 4);
    }

    #[test]
    fn midi_note_name_c_minus_1() {
        let (name, oct) = midi_note_name(0);
        assert_eq!(name, "C");
        assert_eq!(oct, -1);
    }

    #[test]
    fn midi_note_name_g_sharp() {
        let (name, oct) = midi_note_name(80);
        assert_eq!(name, "G#");
        assert_eq!(oct, 5);
    }

    #[test]
    fn track_colors_are_distinct() {
        for i in 0..4 {
            for j in (i + 1)..4 {
                assert_ne!(TRACK[i], TRACK[j]);
            }
        }
    }
}
