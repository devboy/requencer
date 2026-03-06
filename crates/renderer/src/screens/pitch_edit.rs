use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the pitch edit screen: 2x8 grid showing MIDI note values.
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
        "PITCH",
        color,
    );

    // Selected step info: note name + MIDI number + slide
    let sel = ui.selected_step as usize;
    if sel < track.pitch.steps.len() {
        let step = &track.pitch.steps[sel];
        let (name, oct) = colors::midi_note_name(step.note);
        let mut info_buf = [0u8; 16];
        let info = if step.slide > 0.0 {
            let slide_ms = (step.slide * 1000.0) as u16;
            draw::fmt_buf(
                &mut info_buf,
                format_args!("{}{} ({}) S:{}ms", name, oct, step.note, slide_ms),
            )
        } else {
            draw::fmt_buf(&mut info_buf, format_args!("{}{} ({})", name, oct, step.note))
        };
        draw::text_right(
            display,
            layout::LCD_W as i32 - layout::PAD as i32,
            layout::CONTENT_Y as i32 + 9,
            info,
            colors::TEXT_DIM,
        );
    }

    // Step grid
    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;

    for row in 0..2u32 {
        for col in 0..8u32 {
            let step_idx = page_offset + (row * 8 + col) as usize;
            if step_idx >= track.pitch.steps.len() {
                continue;
            }
            let step = &track.pitch.steps[step_idx];
            let x = layout::PAD as i32 + col as i32 * cell_w as i32;
            let y = grid_y + row as i32 * cell_h as i32;
            let is_playhead = track.pitch.current_step as usize == step_idx;
            let is_selected = ui.selected_step as usize == step_idx;
            let gate_on = step_idx < track.gate.steps.len()
                && (track.gate.steps[step_idx].on || track.gate.steps[step_idx].tie);

            // Cell background (trackDim tint like TS)
            let bg = if is_playhead {
                colors::SELECTED_ROW
            } else {
                dim
            };
            draw::fill_rect(display, x + 1, y + 1, cell_w - 2, cell_h - 2, bg);

            // Note bar (height proportional to MIDI note)
            let bar_color = if is_selected {
                colors::TEXT_BRIGHT
            } else if gate_on {
                color
            } else {
                dim
            };
            let bar_h = ((step.note as u32) * (cell_h - 16)) / 127;
            let bar_y = y + (cell_h as i32 - bar_h as i32 - 4);
            draw::fill_rect(display, x + 2, bar_y, cell_w - 4, bar_h.max(1), bar_color);

            // Note name text
            let (name, octave) = colors::midi_note_name(step.note);
            let mut buf = [0u8; 16];
            let note_str = draw::fmt_buf(&mut buf, format_args!("{}{}", name, octave));
            draw::text_center(
                display,
                x + cell_w as i32 / 2,
                y + 2,
                note_str,
                if gate_on { colors::TEXT } else { colors::TEXT_DIM },
            );

            // Slide indicator
            if step.slide > 0.0 {
                draw::fill_rect(display, x + 2, y + cell_h as i32 - 3, cell_w - 4, 2, colors::ACCENT);
            }

            // Playhead indicator
            if is_playhead {
                draw::playhead_bar(display, x, y, cell_w, cell_h);
            }

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
