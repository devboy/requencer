use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the mute edit screen: 4 rows x 16 columns showing all mute patterns.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
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
        "MUTE",
        colors::TRACK[ui.selected_track as usize],
    );

    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let avail_h = layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H;
    let row_h = avail_h / 4;
    let step_w = (layout::LCD_W - 28) / 16;

    for track_idx in 0..4usize {
        let mute = &state.mute_patterns[track_idx];
        let color = colors::TRACK[track_idx];
        let dim = colors::TRACK_DIM[track_idx];
        let is_selected_track = ui.selected_track as usize == track_idx;
        let y = grid_y + track_idx as i32 * row_h as i32;

        // Selected track row highlight
        if is_selected_track {
            draw::fill_rect(display, 0, y, layout::LCD_W, row_h, dim);
        }

        // Track label
        let label = match track_idx {
            0 => "T1",
            1 => "T2",
            2 => "T3",
            _ => "T4",
        };
        draw::text(
            display,
            2,
            y + (row_h as i32 / 2) - 5,
            label,
            if is_selected_track { color } else { colors::TEXT_DIM },
        );

        // Mute steps
        for i in 0..mute.length.min(16) as usize {
            let x = 24 + i as i32 * step_w as i32;
            let is_playhead = mute.current_step as usize == i;
            let muted = i < mute.steps.len() && mute.steps[i];
            let cell_h = row_h - 4;
            let cy = y + 2;

            let c = if muted {
                colors::STEP_MUTED
            } else if is_selected_track {
                color
            } else {
                dim
            };
            draw::fill_rect(display, x + 1, cy, step_w - 2, cell_h, c);

            // Playhead outline stroke
            if is_playhead {
                draw::stroke_rect(display, x, cy - 1, step_w, cell_h + 2, colors::PLAYHEAD);
            }
        }

        // Separator
        if track_idx < 3 {
            let sep_y = y + row_h as i32 - 1;
            draw::fill_rect(display, 0, sep_y, layout::LCD_W, 1, colors::STEP_OFF);
        }
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
