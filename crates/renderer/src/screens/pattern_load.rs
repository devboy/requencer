use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the pattern load screen: layer selection + pattern preview.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    _state: &SequencerState,
    ui: &UiState,
) {
    let track_idx = ui.selected_track as usize;
    let color = colors::TRACK[track_idx];

    // Header
    draw::fill_rect(
        display,
        0,
        layout::CONTENT_Y as i32,
        layout::LCD_W,
        layout::EDIT_HEADER_H,
        colors::STATUS_BAR,
    );
    draw::text(
        display,
        layout::PAD as i32,
        layout::CONTENT_Y as i32 + 9,
        "LOAD",
        color,
    );

    let list_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let row_h = layout::ROW_H as i32;

    // Layer checkboxes
    draw::fill_rect(display, 0, list_y + row_h / 2, layout::LCD_W, 1, colors::TEXT_DIM);
    draw::text_center(display, layout::LCD_W as i32 / 2, list_y + 7, "-- LAYERS --", colors::TEXT_DIM);

    let layers = [
        "GATE", "PITCH", "VEL", "MOD", "XPOSE", "DRIFT", "VAR",
    ];

    for (i, label) in layers.iter().enumerate() {
        let y = list_y + (i as i32 + 1) * row_h;
        let is_sel = ui.selected_step as usize == i;
        if is_sel {
            draw::fill_rect(display, 0, y, layout::LCD_W, layout::ROW_H, colors::SELECTED_ROW);
        }
        // All layers default checked — display as [x]
        draw::text(display, layout::PAD as i32, y + 7, "[x]", color);
        draw::text(display, layout::PAD as i32 + 24, y + 7, label, colors::TEXT);
    }

    // Load action at bottom
    let action_y = list_y + (layers.len() as i32 + 1) * row_h;
    let action_sel = ui.selected_step as usize == layers.len();
    if action_sel {
        draw::fill_rect(display, 0, action_y, layout::LCD_W, layout::ROW_H, colors::SELECTED_ROW);
    }
    draw::text_center(display, layout::LCD_W as i32 / 2, action_y + 7, "[ LOAD ]", color);

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
