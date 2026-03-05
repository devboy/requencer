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
        layout::CONTENT_Y as i32 + 4,
        "GATE",
        color,
    );

    // Selected step info line (GL%, R:x, page)
    let sel = ui.selected_step as usize;
    if sel < track.gate.steps.len() {
        let step = &track.gate.steps[sel];
        let mut info_buf = [0u8; 16];
        let gl_pct = (step.length * 100.0) as u16;
        let info = draw::fmt_buf(&mut info_buf, format_args!("GL:{}% R:{}", gl_pct, step.ratchet));
        draw::text_right(
            display,
            layout::LCD_W as i32 - layout::PAD as i32,
            layout::CONTENT_Y as i32 + 4,
            info,
            colors::TEXT_DIM,
        );
    }

    // Length + divider + page
    {
        let mut buf = [0u8; 16];
        let total_pages = (track.gate.length as u16).div_ceil(16);
        let s = if track.gate.clock_divider > 1 {
            draw::fmt_buf(
                &mut buf,
                format_args!(
                    "L{} /{} P{}/{}",
                    track.gate.length,
                    track.gate.clock_divider,
                    ui.current_page + 1,
                    total_pages
                ),
            )
        } else {
            draw::fmt_buf(
                &mut buf,
                format_args!("L{} P{}/{}", track.gate.length, ui.current_page + 1, total_pages),
            )
        };
        draw::text_right(
            display,
            layout::LCD_W as i32 - layout::PAD as i32,
            layout::CONTENT_Y as i32 + 14,
            s,
            colors::TEXT_DIM,
        );
    }

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

                // Ratchet tick marks (horizontal dividing lines across the bar)
                if step.ratchet > 1 {
                    for r in 1..step.ratchet.min(4) {
                        let tick_y = fill_y + (fill_h as i32 * r as i32) / step.ratchet as i32;
                        draw::fill_rect(display, x + 2, tick_y, cell_w - 4, 1, colors::LCD_BG);
                    }
                }
            } else if step.tie {
                // Tie: horizontal bar
                draw::fill_rect(display, x, y + cell_h as i32 / 2 - 2, cell_w, 4, dim);
            }

            // Playhead indicator
            if is_playhead {
                draw::playhead_bar(display, x, y, cell_w, cell_h);
            }

            // Selection outline
            if is_selected {
                draw::stroke_rect(display, x, y, cell_w, cell_h, colors::TEXT_BRIGHT);
            }
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
