use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::{LfoWaveform, SequencerState};

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
            layout::CONTENT_Y as i32 + 9,
            "LFO",
            color,
        );
        render_lfo(display, state, ui);
    } else {
        draw::text(
            display,
            layout::PAD as i32,
            layout::CONTENT_Y as i32 + 9,
            "MOD",
            color,
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
                draw::fill_rect(
                    display,
                    x + 2,
                    y + cell_h as i32 - 3,
                    cell_w - 4,
                    2,
                    colors::ACCENT,
                );
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
    let color = colors::TRACK[track_idx];
    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;

    // Waveform preview area
    let wave_h: u32 = 100;
    draw::fill_rect(display, layout::PAD as i32, grid_y, layout::LCD_W - layout::PAD * 2, wave_h, colors::LCD_BG);

    // Draw waveform curve (simplified: 60 sample points)
    let wave_w = layout::LCD_W - layout::PAD * 2;
    let mid_y = grid_y + wave_h as i32 / 2;
    let amp = (wave_h as i32 - 8) / 2;

    for px in 0..wave_w {
        let phase = px as f32 / wave_w as f32;
        let val = waveform_sample(lfo.waveform, phase, lfo.width);
        let scaled = (val * lfo.depth * amp as f32) as i32;
        let sy = mid_y - scaled;
        let sx = layout::PAD as i32 + px as i32;
        draw::fill_rect(display, sx, sy, 1, 2, color);
    }

    // Center line
    draw::fill_rect(display, layout::PAD as i32, mid_y, wave_w, 1, colors::TEXT_DIM);

    // Parameter rows below waveform
    let params_y = grid_y + wave_h as i32 + 4;
    let row_h = layout::ROW_H;
    let col_w = (layout::LCD_W - layout::PAD * 2) / 2;

    let params: [(&str, &str); 7] = [
        ("WAVE", waveform_name(lfo.waveform)),
        ("SYNC", if lfo.sync_mode == requencer_engine::types::LfoSyncMode::Track { "TRACK" } else { "FREE" }),
        ("RATE", ""),
        ("DEPTH", ""),
        ("OFFS", ""),
        ("WIDTH", ""),
        ("PHASE", ""),
    ];

    let mut buf_rate = [0u8; 16];
    let mut buf_depth = [0u8; 16];
    let mut buf_offs = [0u8; 16];
    let mut buf_width = [0u8; 16];
    let mut buf_phase = [0u8; 16];

    let rate_str = draw::format_u16(lfo.rate as u16, &mut buf_rate);
    let depth_str = draw::format_f32_1(lfo.depth * 100.0, &mut buf_depth);
    let offs_str = draw::format_f32_1(lfo.offset * 100.0, &mut buf_offs);
    let width_str = draw::format_f32_1(lfo.width * 100.0, &mut buf_width);
    let phase_str = draw::format_f32_1(lfo.phase * 100.0, &mut buf_phase);

    let values: [&str; 7] = [
        params[0].1,
        params[1].1,
        rate_str,
        depth_str,
        offs_str,
        width_str,
        phase_str,
    ];

    for (i, (label, _)) in params.iter().enumerate() {
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
        LfoWaveform::Sine => "SIN",
        LfoWaveform::Triangle => "TRI",
        LfoWaveform::Saw => "SAW",
        LfoWaveform::Square => "SQR",
        LfoWaveform::SlewRandom => "SLW",
        LfoWaveform::SampleAndHold => "S+H",
    }
}

fn waveform_sample(w: LfoWaveform, phase: f32, width: f32) -> f32 {
    match w {
        LfoWaveform::Sine => {
            #[cfg(any(feature = "std", test))]
            { (phase * core::f32::consts::TAU).sin() }
            #[cfg(not(any(feature = "std", test)))]
            { libm::sinf(phase * core::f32::consts::TAU) }
        }
        LfoWaveform::Triangle => {
            if phase < width {
                if width > 0.0 { (phase / width) * 2.0 - 1.0 } else { -1.0 }
            } else if width < 1.0 {
                1.0 - ((phase - width) / (1.0 - width)) * 2.0
            } else {
                1.0
            }
        }
        LfoWaveform::Saw => phase * 2.0 - 1.0,
        LfoWaveform::Square => {
            if phase < width { 1.0 } else { -1.0 }
        }
        LfoWaveform::SlewRandom | LfoWaveform::SampleAndHold => {
            // Simplified: deterministic pseudo-waveform for display
            let seg = (phase * 8.0) as u32;
            let vals = [0.5, -0.3, 0.8, -0.6, 0.2, -0.9, 0.7, -0.1];
            vals[(seg & 7) as usize]
        }
    }
}
