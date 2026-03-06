use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the pattern load screen: layer selection + destination track.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let dest_idx = ui.pattern_load_target as usize;
    let dest_color = colors::TRACK[dest_idx];
    let flags = &ui.pattern_layer_flags;

    // Header
    draw::fill_rect(
        display,
        0,
        layout::CONTENT_Y as i32,
        layout::LCD_W,
        layout::EDIT_HEADER_H,
        colors::STATUS_BAR,
    );

    // Pattern name (left)
    let pat_idx = ui.pattern_index as usize;
    let pat_name = if pat_idx < state.saved_patterns.len() {
        state.saved_patterns[pat_idx].name.as_str()
    } else {
        "?"
    };
    let mut hdr_buf = [0u8; 16];
    let hdr = draw::fmt_buf(&mut hdr_buf, format_args!("LOAD: {}", pat_name));
    draw::text(
        display,
        layout::PAD as i32,
        layout::CONTENT_Y as i32 + 4,
        hdr,
        colors::TEXT,
    );

    // Destination track (right)
    let mut dest_buf = [0u8; 16];
    let dest_str = draw::fmt_buf(&mut dest_buf, format_args!("-> T{}", dest_idx + 1));
    draw::text_right(
        display,
        layout::LCD_W as i32 - layout::PAD as i32,
        layout::CONTENT_Y as i32 + 9,
        dest_str,
        dest_color,
    );

    let list_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let row_h = layout::ROW_H as i32;

    // Layer checkboxes with actual flags
    let layers: [(&str, bool); 7] = [
        ("GATE", flags.gate),
        ("PITCH", flags.pitch),
        ("VEL", flags.velocity),
        ("MOD", flags.modulation),
        ("XPOSE", flags.transpose),
        ("DRIFT", flags.drift),
        ("VAR", flags.variation),
    ];

    for (i, (label, enabled)) in layers.iter().enumerate() {
        let y = list_y + i as i32 * row_h;
        let check = if *enabled { "[x]" } else { "[ ]" };
        let text_color = if *enabled { colors::TEXT } else { colors::TEXT_DIM };
        let check_color = if *enabled { dest_color } else { colors::TEXT_DIM };

        draw::text(display, layout::PAD as i32, y + 7, check, check_color);
        draw::text(display, layout::PAD as i32 + 28, y + 7, label, text_color);
    }

    // Hint at bottom
    let hint_y = list_y + layers.len() as i32 * row_h + 8;
    draw::text_center(
        display,
        layout::LCD_W as i32 / 2,
        hint_y + 7,
        "PUSH:LOAD  ENC B:DEST",
        colors::TEXT_DIM,
    );

    // Footer
    let footer_y = layout::LCD_H as i32 - layout::EDIT_FOOTER_H as i32;
    draw::fill_rect(
        display,
        0,
        footer_y,
        layout::LCD_W,
        layout::EDIT_FOOTER_H,
        colors::STATUS_BAR,
    );
}
