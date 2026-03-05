use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the gate edit screen: 2x8 step grid showing gate on/off, length, ratchet, tie.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let track_idx = ui.selected_track as usize;
    let track = &state.tracks[track_idx];
    let color = colors::TRACK[track_idx];
    let dim = colors::TRACK_DIM[track_idx];
    let page_offset = ui.current_page as usize * 16;
    let (cell_w, cell_h) = layout::edit_step_size();

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
        "GATE",
        color,
    );

    // Length / divider info
    let mut buf = [0u8; 16];
    let len_str = draw::format_u16(track.gate.length as u16, &mut buf);
    draw::text_right(
        display,
        layout::LCD_W as i32 - layout::PAD as i32,
        layout::CONTENT_Y as i32 + 9,
        len_str,
        colors::TEXT_DIM,
    );

    // Step grid: 2 rows x 8 cols
    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;

    for row in 0..2u32 {
        for col in 0..8u32 {
            let step_idx = page_offset + (row * 8 + col) as usize;
            if step_idx >= track.gate.steps.len() {
                continue;
            }
            let step = &track.gate.steps[step_idx];
            let x = layout::PAD as i32 + col as i32 * cell_w as i32;
            let y = grid_y + row as i32 * cell_h as i32;
            let is_playhead = track.gate.current_step as usize == step_idx;
            let is_selected = ui.selected_step as usize == step_idx;

            // Cell background
            let bg = if is_playhead {
                colors::SELECTED_ROW
            } else {
                colors::LCD_BG
            };
            draw::fill_rect(display, x + 1, y + 1, cell_w - 2, cell_h - 2, bg);

            // Gate state visualization
            if step.on {
                // Filled portion represents gate length
                let fill_h = ((step.length * (cell_h - 4) as f32) as u32).max(2);
                let fill_y = y + (cell_h as i32 - fill_h as i32 - 2);
                draw::fill_rect(display, x + 2, fill_y, cell_w - 4, fill_h, color);

                // Ratchet indicator (dots at top)
                if step.ratchet > 1 {
                    for r in 0..step.ratchet.min(4) {
                        let dot_x = x + 3 + r as i32 * 4;
                        draw::fill_rect(display, dot_x, y + 2, 2, 2, colors::TEXT_BRIGHT);
                    }
                }
            } else if step.tie {
                // Tie: horizontal bridge
                draw::fill_rect(
                    display,
                    x,
                    y + cell_h as i32 / 2 - 2,
                    cell_w,
                    4,
                    dim,
                );
            }

            // Selection outline
            if is_selected {
                draw::stroke_rect(display, x, y, cell_w, cell_h, colors::TEXT_BRIGHT);
            }
        }
    }

    // Footer: page info
    let footer_y = layout::LCD_H as i32 - layout::EDIT_FOOTER_H as i32;
    draw::fill_rect(
        display,
        0,
        footer_y,
        layout::LCD_W,
        layout::EDIT_FOOTER_H,
        colors::STATUS_BAR,
    );
    let mut page_buf = [0u8; 16];
    let page_str = draw::format_u16(ui.current_page as u16 + 1, &mut page_buf);
    draw::text_center(
        display,
        layout::LCD_W as i32 / 2,
        footer_y + 6,
        page_str,
        colors::TEXT_DIM,
    );
}
