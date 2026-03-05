use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Character grid for name entry (encoder-based character picker).
const CHAR_BOX_W: u32 = 28;
const CHAR_BOX_H: u32 = 28;
const CHAR_GAP: u32 = 4;
const MAX_NAME_LEN: usize = 8;

/// Render the name entry screen with character grid.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    _state: &SequencerState,
    ui: &UiState,
) {
    let color = colors::TRACK[ui.selected_track as usize];

    // Header (context-aware title handled by lib.rs status bar)
    draw::fill_rect(
        display,
        0,
        layout::CONTENT_Y as i32,
        layout::LCD_W,
        layout::EDIT_HEADER_H,
        colors::STATUS_BAR,
    );

    // Character grid: show each char position as a box
    let name_len = (ui.name_len as usize).min(MAX_NAME_LEN);
    let total_w = MAX_NAME_LEN as u32 * (CHAR_BOX_W + CHAR_GAP) - CHAR_GAP;
    let grid_x = (layout::LCD_W as i32 - total_w as i32) / 2;
    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32 + 30;

    for i in 0..MAX_NAME_LEN {
        let x = grid_x + i as i32 * (CHAR_BOX_W + CHAR_GAP) as i32;
        let is_cursor = ui.name_cursor as usize == i;

        // Box background
        let bg = if is_cursor {
            colors::SELECTED_ROW
        } else {
            colors::LCD_BG
        };
        draw::fill_rect(display, x, grid_y, CHAR_BOX_W, CHAR_BOX_H, bg);

        // Character
        let ch = ui.name_chars[i];
        if ch > 0 {
            let ch_buf = [ch, 0];
            let ch_str = core::str::from_utf8(&ch_buf[..1]).unwrap_or(" ");
            draw::text_center(
                display,
                x + CHAR_BOX_W as i32 / 2,
                grid_y + 9,
                ch_str,
                colors::TEXT,
            );
        }

        // Cursor underline
        if is_cursor {
            draw::fill_rect(
                display,
                x + 2,
                grid_y + CHAR_BOX_H as i32 - 3,
                CHAR_BOX_W - 4,
                2,
                color,
            );
        }
    }

    // Name preview below grid
    let preview_y = grid_y + CHAR_BOX_H as i32 + 16;
    let mut name_buf = [0u8; 16];
    let mut pos = 0;
    for i in 0..name_len {
        let ch = ui.name_chars[i];
        if ch > 0 && pos < name_buf.len() {
            name_buf[pos] = ch;
            pos += 1;
        }
    }
    if pos > 0 {
        let name_str = core::str::from_utf8(&name_buf[..pos]).unwrap_or("");
        draw::text_center(
            display,
            layout::LCD_W as i32 / 2,
            preview_y,
            name_str,
            colors::TEXT_DIM,
        );
    } else {
        draw::text_center(
            display,
            layout::LCD_W as i32 / 2,
            preview_y,
            "(empty)",
            colors::TEXT_DIM,
        );
    }

    // Instructions
    draw::text_center(
        display,
        layout::LCD_W as i32 / 2,
        preview_y + 24,
        "Turn encoder to edit, PUSH to confirm",
        colors::TEXT_DIM,
    );

    // Flash message overlay (shown inline for name entry)
    if let Some(msg) = ui.flash_message {
        draw::text_center(
            display,
            layout::LCD_W as i32 / 2,
            preview_y + 48,
            msg,
            color,
        );
    }

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
