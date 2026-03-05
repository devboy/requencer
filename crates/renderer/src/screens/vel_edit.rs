use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the velocity edit screen: 2x8 grid showing velocity bar graphs.
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
        "VEL",
        color,
    );

    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;

    for row in 0..2u32 {
        for col in 0..8u32 {
            let step_idx = page_offset + (row * 8 + col) as usize;
            if step_idx >= track.velocity.steps.len() {
                continue;
            }
            let vel = track.velocity.steps[step_idx];
            let x = layout::PAD as i32 + col as i32 * cell_w as i32;
            let y = grid_y + row as i32 * cell_h as i32;
            let is_playhead = track.velocity.current_step as usize == step_idx;
            let is_selected = ui.selected_step as usize == step_idx;
            let gate_on = step_idx < track.gate.steps.len()
                && (track.gate.steps[step_idx].on || track.gate.steps[step_idx].tie);

            let bg = if is_playhead {
                colors::SELECTED_ROW
            } else {
                colors::LCD_BG
            };
            draw::fill_rect(display, x + 1, y + 1, cell_w - 2, cell_h - 2, bg);

            // Velocity bar
            let bar_color = if gate_on { color } else { dim };
            let bar_h = ((vel as u32) * (cell_h - 16)) / 127;
            let bar_y = y + (cell_h as i32 - bar_h as i32 - 4);
            draw::fill_rect(display, x + 2, bar_y, cell_w - 4, bar_h.max(1), bar_color);

            // Velocity number
            let mut buf = [0u8; 16];
            let vel_str = draw::format_u16(vel as u16, &mut buf);
            draw::text_center(
                display,
                x + cell_w as i32 / 2,
                y + 2,
                vel_str,
                if gate_on { colors::TEXT } else { colors::TEXT_DIM },
            );

            if is_selected {
                draw::stroke_rect(display, x, y, cell_w, cell_h, colors::TEXT_BRIGHT);
            }
        }
    }

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
