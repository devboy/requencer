use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the name entry screen (for naming patterns/presets).
/// Simplified on-screen keyboard: shows current name with cursor.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    _state: &SequencerState,
    ui: &UiState,
) {
    let color = colors::TRACK[ui.selected_track as usize];

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
        "NAME",
        color,
    );

    let center_y = layout::CONTENT_Y as i32 + (layout::CONTENT_H as i32 / 2) - 20;

    // Name display area
    draw::fill_rect(
        display,
        layout::PAD as i32,
        center_y,
        layout::LCD_W - layout::PAD * 2,
        40,
        colors::LCD_BG,
    );
    draw::stroke_rect(
        display,
        layout::PAD as i32,
        center_y,
        layout::LCD_W - layout::PAD * 2,
        40,
        colors::TEXT_DIM,
    );

    // Flash message or placeholder
    if let Some(msg) = ui.flash_message {
        draw::text_center(
            display,
            layout::LCD_W as i32 / 2,
            center_y + 15,
            msg,
            color,
        );
    } else {
        draw::text_center(
            display,
            layout::LCD_W as i32 / 2,
            center_y + 15,
            "Turn encoder to edit",
            colors::TEXT_DIM,
        );
    }

    // Instructions
    draw::text_center(
        display,
        layout::LCD_W as i32 / 2,
        center_y + 50,
        "PUSH to confirm",
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
