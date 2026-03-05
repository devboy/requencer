use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

const TRACK_GAP: u32 = 6;
const INFO_H: u32 = 22;
const LABEL_W: u32 = 36;
const GATE_FRAC: f32 = 0.22;
const PITCH_FRAC: f32 = 0.42;

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

    let avail_h = layout::CONTENT_H - layout::PAD - INFO_H - 3 * TRACK_GAP;
    let band_h = avail_h / 4;
    let gate_h = (band_h as f32 * GATE_FRAC) as u32;
    let pitch_h = (band_h as f32 * PITCH_FRAC) as u32;
    let vel_h = band_h - gate_h - pitch_h;
    let step_w = (layout::LCD_W - LABEL_W - 4) / 16;
    let grid_left = LABEL_W as i32;

    for track_idx in 0..4 {
        let band_y =
            layout::CONTENT_Y as i32 + (track_idx as i32 * (band_h as i32 + TRACK_GAP as i32));
        let track = &state.tracks[track_idx];
        let color = colors::TRACK[track_idx];
        let dim = colors::TRACK_DIM[track_idx];
        let is_selected = ui.selected_track == track_idx as u8;

        // Selected track tinted background
        if is_selected {
            draw::fill_rect(display, 0, band_y, layout::LCD_W, band_h, dim);
        }

        // Track label (centered vertically)
        let label = match track_idx {
            0 => "T1",
            1 => "T2",
            2 => "T3",
            _ => "T4",
        };
        draw::text(
            display,
            layout::PAD as i32,
            band_y + band_h as i32 / 2 - 5,
            label,
            if is_selected { color } else { colors::TEXT_DIM },
        );

        // Variation active indicator
        if state.variation_patterns[track_idx].enabled {
            draw::text(
                display,
                layout::PAD as i32 + 14,
                band_y + band_h as i32 / 2 - 5,
                "~",
                colors::PLAY_GREEN,
            );
        }

        // Gate row
        let gate_y = band_y;
        for i in 0..track.gate.length.min(16) as usize {
            let x = grid_left + (i as i32 * step_w as i32);
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
            draw::fill_rect(display, x + 1, gate_y, step_w - 2, gate_h - 1, c);
        }

        // Pitch row (note bars, bright track color)
        let pitch_y = gate_y + gate_h as i32;
        for i in 0..track.pitch.length.min(16) as usize {
            let x = grid_left + (i as i32 * step_w as i32);
            let note = track.pitch.steps[i].note;
            let bar_h = ((note as u32) * (pitch_h - 2)) / 127;
            let bar_y = pitch_y + (pitch_h as i32 - bar_h as i32 - 1);
            draw::fill_rect(display, x + 1, bar_y, step_w - 2, bar_h.max(1), color);

            // Playhead on pitch
            if track.pitch.current_step as usize == i {
                draw::fill_rect(
                    display,
                    x + 1,
                    pitch_y + pitch_h as i32 - 2,
                    step_w - 2,
                    2,
                    colors::PLAYHEAD,
                );
            }
        }

        // Velocity row (bar heights)
        let vel_y = pitch_y + pitch_h as i32;
        for i in 0..track.velocity.length.min(16) as usize {
            let x = grid_left + (i as i32 * step_w as i32);
            let vel = track.velocity.steps[i];
            let bar_h = ((vel as u32) * (vel_h - 2)) / 127;
            let bar_y = vel_y + (vel_h as i32 - bar_h as i32 - 1);
            draw::fill_rect(display, x + 1, bar_y, step_w - 2, bar_h.max(1), dim);

            // Playhead on velocity
            if track.velocity.current_step as usize == i {
                draw::fill_rect(
                    display,
                    x + 1,
                    vel_y + vel_h as i32 - 2,
                    step_w - 2,
                    2,
                    colors::PLAYHEAD,
                );
            }
        }

        // Separator line between tracks
        if track_idx < 3 {
            let sep_y = band_y + band_h as i32 + TRACK_GAP as i32 / 2;
            draw::fill_rect(display, 0, sep_y, layout::LCD_W, 1, colors::STEP_OFF);
        }
    }

    // Info footer: lengths and clock dividers
    render_footer(display, state);
}

fn render_footer<D: DrawTarget<Color = Rgb565>>(display: &mut D, state: &SequencerState) {
    let y = layout::LCD_H as i32 - INFO_H as i32;
    let track = &state.tracks[0];
    let gl = track.gate.length;
    let pl = track.pitch.length;
    let vl = track.velocity.length;

    let mut buf = [0u8; 16];
    if gl == pl && pl == vl {
        let s = draw::fmt_buf(&mut buf, format_args!("L{}", gl));
        draw::text(display, layout::PAD as i32, y + 6, s, colors::TEXT_DIM);
    } else {
        let s = draw::fmt_buf(&mut buf, format_args!("G:{} P:{} V:{}", gl, pl, vl));
        draw::text(display, layout::PAD as i32, y + 6, s, colors::TEXT_DIM);
    }

    if track.clock_divider > 1 {
        let mut div_buf = [0u8; 16];
        let ds = draw::fmt_buf(&mut div_buf, format_args!("/{}", track.clock_divider));
        draw::text_right(
            display,
            layout::LCD_W as i32 - layout::PAD as i32,
            y + 6,
            ds,
            colors::TEXT_DIM,
        );
    }
}
