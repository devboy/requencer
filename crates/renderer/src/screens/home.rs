use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the home screen: 4-track overview with gate/pitch/velocity rows.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    draw::fill_rect(
        display,
        0,
        layout::CONTENT_Y as i32,
        layout::LCD_W,
        layout::CONTENT_H,
        colors::LCD_BG,
    );

    for track_idx in 0..4 {
        let band_y = layout::CONTENT_Y as i32 + (track_idx as i32 * layout::HOME_BAND_H as i32);
        let track = &state.tracks[track_idx];
        let color = colors::TRACK[track_idx];
        let dim = colors::TRACK_DIM[track_idx];
        let is_selected = ui.selected_track == track_idx as u8;

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
            band_y + 2,
            label,
            if is_selected { color } else { colors::TEXT_DIM },
        );

        // Gate row
        let gate_y = band_y + 2;
        let step_w = (layout::LCD_W - 24) / 16;
        for i in 0..track.gate.length.min(16) as usize {
            let x = 20 + (i as i32 * step_w as i32);
            let step = &track.gate.steps[i];
            let is_playhead = track.gate.current_step as usize == i;

            let c = if is_playhead {
                colors::PLAYHEAD
            } else if step.on {
                color
            } else if step.tie {
                dim
            } else {
                colors::STEP_OFF
            };
            draw::fill_rect(display, x + 1, gate_y, step_w - 2, layout::HOME_GATE_H - 2, c);
        }

        // Pitch row (note numbers as small bars)
        let pitch_y = gate_y + layout::HOME_GATE_H as i32;
        for i in 0..track.pitch.length.min(16) as usize {
            let x = 20 + (i as i32 * step_w as i32);
            let note = track.pitch.steps[i].note;
            // Map 0-127 to bar height 0-HOME_PITCH_H
            let bar_h = ((note as u32) * (layout::HOME_PITCH_H - 2)) / 127;
            let bar_y = pitch_y + (layout::HOME_PITCH_H as i32 - bar_h as i32 - 1);
            draw::fill_rect(display, x + 1, bar_y, step_w - 2, bar_h.max(1), dim);
        }

        // Velocity row (bar heights)
        let vel_y = pitch_y + layout::HOME_PITCH_H as i32;
        for i in 0..track.velocity.length.min(16) as usize {
            let x = 20 + (i as i32 * step_w as i32);
            let vel = track.velocity.steps[i];
            let bar_h = ((vel as u32) * (layout::HOME_VEL_H - 2)) / 127;
            let bar_y = vel_y + (layout::HOME_VEL_H as i32 - bar_h as i32 - 1);
            draw::fill_rect(display, x + 1, bar_y, step_w - 2, bar_h.max(1), dim);
        }

        // Separator line between tracks
        if track_idx < 3 {
            let sep_y = band_y + layout::HOME_BAND_H as i32 - 1;
            draw::fill_rect(display, 0, sep_y, layout::LCD_W, 1, colors::STEP_OFF);
        }
    }
}
