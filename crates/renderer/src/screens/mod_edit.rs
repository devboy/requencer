use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::{LfoSyncMode, LfoWaveform, SequencerState};

use crate::{colors, draw, layout, types::UiState};

/// Render the mod/LFO edit screen.
/// When `ui.mod_lfo_view == false`: 2x8 mod step grid.
/// When `ui.mod_lfo_view == true`: LFO waveform preview + parameter list.
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

    if ui.mod_lfo_view {
        draw::text(
            display,
            layout::PAD as i32,
            layout::CONTENT_Y as i32 + 4,
            "LFO",
            color,
        );
        // Waveform name in header
        let lfo = &state.lfo_configs[track_idx];
        draw::text_right(
            display,
            layout::LCD_W as i32 - layout::PAD as i32,
            layout::CONTENT_Y as i32 + 4,
            waveform_name(lfo.waveform),
            colors::TEXT_DIM,
        );
        // Rate/depth info line
        let mut info_buf = [0u8; 16];
        let info = if lfo.sync_mode == LfoSyncMode::Track {
            draw::fmt_buf(&mut info_buf, format_args!("/{} D{}%", lfo.rate, (lfo.depth * 100.0) as u16))
        } else {
            draw::fmt_buf(&mut info_buf, format_args!("D{}%", (lfo.depth * 100.0) as u16))
        };
        draw::text_right(
            display,
            layout::LCD_W as i32 - layout::PAD as i32,
            layout::CONTENT_Y as i32 + 14,
            info,
            colors::TEXT_DIM,
        );
        render_lfo(display, state, ui);
    } else {
        draw::text(
            display,
            layout::PAD as i32,
            layout::CONTENT_Y as i32 + 4,
            "MOD",
            color,
        );
        // Selected step info
        let track = &state.tracks[track_idx];
        let sel = ui.selected_step as usize;
        if sel < track.modulation.steps.len() {
            let step = &track.modulation.steps[sel];
            let mut info_buf = [0u8; 16];
            let pct = (step.value * 100.0) as u16;
            let slew_pct = (step.slew * 100.0) as u16;
            let info = if step.slew > 0.0 {
                draw::fmt_buf(&mut info_buf, format_args!("{}% slew {}%", pct, slew_pct))
            } else {
                draw::fmt_buf(&mut info_buf, format_args!("{}%", pct))
            };
            draw::text_right(
                display,
                layout::LCD_W as i32 - layout::PAD as i32,
                layout::CONTENT_Y as i32 + 4,
                info,
                colors::TEXT_DIM,
            );
        }
        // Length + page info
        let track = &state.tracks[track_idx];
        let mut pg_buf = [0u8; 16];
        let total_pages = (track.modulation.length as u16).div_ceil(16);
        let pg = draw::fmt_buf(
            &mut pg_buf,
            format_args!("L{} P{}/{}", track.modulation.length, ui.current_page + 1, total_pages),
        );
        draw::text_right(
            display,
            layout::LCD_W as i32 - layout::PAD as i32,
            layout::CONTENT_Y as i32 + 14,
            pg,
            colors::TEXT_DIM,
        );

        render_mod_grid(display, state, ui);
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

fn render_mod_grid<D: DrawTarget<Color = Rgb565>>(
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
    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;

    for row in 0..2u32 {
        for col in 0..8u32 {
            let step_idx = page_offset + (row * 8 + col) as usize;
            if step_idx >= track.modulation.steps.len() {
                // Placeholder for unused steps
                let x = layout::PAD as i32 + col as i32 * cell_w as i32;
                let y = grid_y + row as i32 * cell_h as i32;
                draw::fill_rect(display, x + 1, y + 1, cell_w - 2, cell_h - 2, colors::LCD_BG);
                draw::fill_rect(display, x + 2, y + cell_h as i32 - 4, cell_w - 4, 2, colors::STEP_OFF);
                continue;
            }
            let step = &track.modulation.steps[step_idx];
            let x = layout::PAD as i32 + col as i32 * cell_w as i32;
            let y = grid_y + row as i32 * cell_h as i32;
            let is_playhead = track.modulation.current_step as usize == step_idx;
            let is_selected = ui.selected_step as usize == step_idx;
            let gate_on = step_idx < track.gate.steps.len()
                && (track.gate.steps[step_idx].on || track.gate.steps[step_idx].tie);

            let bg = if is_playhead {
                colors::SELECTED_ROW
            } else {
                colors::LCD_BG
            };
            draw::fill_rect(display, x + 1, y + 1, cell_w - 2, cell_h - 2, bg);

            // Value bar
            let bar_color = if gate_on { color } else { dim };
            let bar_h = ((step.value * (cell_h - 16) as f32) as u32).max(1);
            let bar_y = y + (cell_h as i32 - bar_h as i32 - 4);
            draw::fill_rect(display, x + 2, bar_y, cell_w - 4, bar_h, bar_color);

            // Slew indicator
            if step.slew > 0.0 {
                draw::fill_rect(display, x + 2, y + cell_h as i32 - 3, cell_w - 4, 2, colors::ACCENT);
            }

            // Value text
            let pct = (step.value * 100.0) as u16;
            let mut buf = [0u8; 16];
            let val_str = draw::format_u16(pct, &mut buf);
            draw::text_center(
                display,
                x + cell_w as i32 / 2,
                y + 2,
                val_str,
                if gate_on { colors::TEXT } else { colors::TEXT_DIM },
            );

            // Playhead indicator
            if is_playhead {
                draw::playhead_bar(display, x, y, cell_w, cell_h);
            }

            if is_selected {
                draw::stroke_rect(display, x, y, cell_w, cell_h, colors::TEXT_BRIGHT);
            }
        }
    }
}

fn render_lfo<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let track_idx = ui.selected_track as usize;
    let lfo = &state.lfo_configs[track_idx];
    let lfo_rt = &state.lfo_runtimes[track_idx];
    let color = colors::TRACK[track_idx];
    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;

    // Waveform preview area with border
    let wave_h: u32 = 100;
    let wave_x = layout::PAD as i32;
    let wave_w = layout::LCD_W - layout::PAD * 2;
    draw::fill_rect(display, wave_x, grid_y, wave_w, wave_h, colors::LCD_BG);
    draw::stroke_rect(display, wave_x, grid_y, wave_w, wave_h, colors::TEXT_DIM);

    // Draw waveform curve
    let mid_y = grid_y + wave_h as i32 / 2;
    let amp = (wave_h as i32 - 8) / 2;

    // Center/offset line
    let offset_y = mid_y - (lfo.offset * amp as f32) as i32;
    // Dashed center line (alternate 3px on, 3px off)
    for px in (0..wave_w).step_by(6) {
        draw::fill_rect(display, wave_x + px as i32, offset_y, 3.min(wave_w - px), 1, colors::TEXT_DIM);
    }

    // Smooth waveform — draw connected line segments
    let mut prev_sy: Option<i32> = None;
    for px in 0..wave_w {
        let phase = px as f32 / wave_w as f32;
        let val = waveform_sample(lfo.waveform, phase, lfo.width);
        let scaled = (val * lfo.depth * amp as f32) as i32;
        let sy = mid_y - scaled - (lfo.offset * amp as f32) as i32;

        if let Some(prev) = prev_sy {
            // Draw vertical connector for smooth line
            let (y0, y1) = if prev < sy { (prev, sy) } else { (sy, prev) };
            let h = (y1 - y0 + 1).max(1) as u32;
            draw::fill_rect(display, wave_x + px as i32, y0, 1, h, color);
        } else {
            draw::fill_rect(display, wave_x + px as i32, sy, 1, 2, color);
        }
        prev_sy = Some(sy);
    }

    // Phase cursor (vertical line + dot at current value)
    let cursor_x = wave_x + (lfo_rt.current_phase * wave_w as f32) as i32;
    if cursor_x >= wave_x && cursor_x < wave_x + wave_w as i32 {
        // Vertical line
        draw::fill_rect(display, cursor_x, grid_y + 1, 1, wave_h - 2, colors::TEXT_DIM);
        // Value dot
        let cursor_val = waveform_sample(lfo.waveform, lfo_rt.current_phase, lfo.width);
        let cursor_sy = mid_y - (cursor_val * lfo.depth * amp as f32) as i32 - (lfo.offset * amp as f32) as i32;
        draw::fill_rect(display, cursor_x - 2, cursor_sy - 2, 5, 5, colors::PLAYHEAD);
    }

    // Parameter rows below waveform (2 columns)
    let params_y = grid_y + wave_h as i32 + 4;
    let row_h = layout::ROW_H;
    let col_w = (layout::LCD_W - layout::PAD * 2) / 2;

    let labels: [&str; 7] = ["WAVE", "SYNC", "RATE", "DEPTH", "OFFS", "WIDTH", "PHASE"];

    let mut buf_rate = [0u8; 16];
    let mut buf_depth = [0u8; 16];
    let mut buf_offs = [0u8; 16];
    let mut buf_width = [0u8; 16];
    let mut buf_phase = [0u8; 16];

    let rate_str = if lfo.sync_mode == LfoSyncMode::Track {
        draw::fmt_buf(&mut buf_rate, format_args!("/{}", lfo.rate))
    } else {
        draw::fmt_buf(&mut buf_rate, format_args!("{}Hz", draw::format_f32_1(lfo.free_rate, &mut [0u8; 16])))
    };
    let depth_str = draw::fmt_buf(&mut buf_depth, format_args!("{}%", (lfo.depth * 100.0) as u16));
    let offs_str = draw::fmt_buf(&mut buf_offs, format_args!("{}%", (lfo.offset * 100.0) as i16));
    let width_str = draw::fmt_buf(&mut buf_width, format_args!("{}%", (lfo.width * 100.0) as u16));
    let phase_str = draw::fmt_buf(&mut buf_phase, format_args!("{}%", (lfo.phase * 100.0) as u16));

    let sync_str = if lfo.sync_mode == LfoSyncMode::Track { "TRACK" } else { "FREE" };

    let values: [&str; 7] = [
        waveform_name(lfo.waveform),
        sync_str,
        rate_str,
        depth_str,
        offs_str,
        width_str,
        phase_str,
    ];

    for (i, label) in labels.iter().enumerate() {
        let col = i % 2;
        let row = i / 2;
        let x = layout::PAD as i32 + col as i32 * col_w as i32;
        let y = params_y + row as i32 * row_h as i32;
        let is_sel = ui.mod_lfo_param as usize == i;

        if is_sel {
            draw::fill_rect(display, x, y, col_w, row_h, colors::SELECTED_ROW);
        }

        draw::text(display, x + 4, y + 7, label, colors::TEXT_DIM);
        draw::text_right(display, x + col_w as i32 - 4, y + 7, values[i], color);
    }
}

fn waveform_name(w: LfoWaveform) -> &'static str {
    match w {
        LfoWaveform::Sine => "SINE",
        LfoWaveform::Triangle => "TRI",
        LfoWaveform::Saw => "SAW",
        LfoWaveform::Square => "SQR",
        LfoWaveform::SlewRandom => "SLEW",
        LfoWaveform::SampleAndHold => "S+H",
    }
}

fn waveform_sample(w: LfoWaveform, phase: f32, width: f32) -> f32 {
    match w {
        LfoWaveform::Sine => {
            #[cfg(any(feature = "std", test))]
            {
                (phase * core::f32::consts::TAU).sin()
            }
            #[cfg(not(any(feature = "std", test)))]
            {
                libm::sinf(phase * core::f32::consts::TAU)
            }
        }
        LfoWaveform::Triangle => {
            if phase < width {
                if width > 0.0 {
                    (phase / width) * 2.0 - 1.0
                } else {
                    -1.0
                }
            } else if width < 1.0 {
                1.0 - ((phase - width) / (1.0 - width)) * 2.0
            } else {
                1.0
            }
        }
        LfoWaveform::Saw => phase * 2.0 - 1.0,
        LfoWaveform::Square => {
            if phase < width {
                1.0
            } else {
                -1.0
            }
        }
        LfoWaveform::SampleAndHold => {
            // Stepped segments
            let seg = (phase * 8.0) as u32;
            let vals = [0.5, -0.3, 0.8, -0.6, 0.2, -0.9, 0.7, -0.1];
            vals[(seg & 7) as usize]
        }
        LfoWaveform::SlewRandom => {
            // Slew-interpolated between segments
            let seg_f = phase * 8.0;
            let seg = seg_f as u32;
            let frac = seg_f - seg as f32;
            let vals = [0.5f32, -0.3, 0.8, -0.6, 0.2, -0.9, 0.7, -0.1];
            let a = vals[(seg & 7) as usize];
            let b = vals[((seg + 1) & 7) as usize];
            a + (b - a) * frac
        }
    }
}
