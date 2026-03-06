use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the pattern save/load screen.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
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
    let mut hdr_buf = [0u8; 16];
    let hdr_str = draw::fmt_buf(&mut hdr_buf, format_args!("PATTERN T{}", track_idx + 1));
    draw::text(
        display,
        layout::PAD as i32,
        layout::CONTENT_Y as i32 + 9,
        hdr_str,
        color,
    );

    let list_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let row_h = layout::ROW_H as i32;

    // Save action row
    let save_sel = ui.pattern_param == 0;
    if save_sel {
        draw::fill_rect(display, 0, list_y, layout::LCD_W, layout::ROW_H, colors::SELECTED_ROW);
    }
    let mut save_buf = [0u8; 16];
    let save_str = draw::fmt_buf(&mut save_buf, format_args!("[ SAVE T{} ]", track_idx + 1));
    draw::text_center(display, layout::LCD_W as i32 / 2, list_y + 7, save_str, color);

    // Section header (split line around text)
    let sec_y = list_y + row_h;
    let center_x = layout::LCD_W as i32 / 2;
    let text_label = "PATTERNS";
    let text_w = text_label.len() as i32 * layout::CHAR_W as i32;
    let gap = 6i32;
    draw::fill_rect(display, layout::PAD as i32, sec_y + row_h / 2,
        (center_x - text_w / 2 - gap - layout::PAD as i32) as u32, 1, colors::TEXT_DIM);
    let right_start = center_x + text_w / 2 + gap;
    draw::fill_rect(display, right_start, sec_y + row_h / 2,
        (layout::LCD_W as i32 - layout::PAD as i32 - right_start) as u32, 1, colors::TEXT_DIM);
    draw::text_center(
        display,
        center_x,
        sec_y + 7,
        text_label,
        colors::TEXT_DIM,
    );

    // Pattern list
    let max_visible = ((layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H)
        / layout::ROW_H) as usize
        - 2; // minus save row and section header
    let total = state.saved_patterns.len();

    for (i, pat) in state.saved_patterns.iter().enumerate() {
        if i >= max_visible {
            break;
        }
        let y = list_y + (i as i32 + 2) * row_h;
        let is_sel = ui.pattern_param as usize == i + 1;
        if is_sel {
            draw::fill_rect(display, 0, y, layout::LCD_W, layout::ROW_H, colors::SELECTED_ROW);
        }

        // Pattern number (left)
        let mut num_buf = [0u8; 16];
        let num_str = draw::format_u16(i as u16 + 1, &mut num_buf);
        draw::text(display, layout::PAD as i32, y + 7, num_str, colors::TEXT_DIM);

        // Pattern name (center-left)
        draw::text(display, layout::PAD as i32 + 24, y + 7, pat.name.as_str(), colors::TEXT);
    }

    if state.saved_patterns.is_empty() {
        draw::text_center(
            display,
            layout::LCD_W as i32 / 2,
            list_y + 2 * row_h + 7,
            "No saved patterns",
            colors::TEXT_DIM,
        );
    }

    // Scroll indicator
    let bar_h = layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H;
    draw::scroll_bar(display, list_y, bar_h, 0, total + 2, max_visible + 2, color);

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
