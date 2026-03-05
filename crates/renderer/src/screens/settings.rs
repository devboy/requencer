use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::{ClockSource, SequencerState};

use crate::{colors, draw, layout, types::UiState};

/// Render the settings screen.
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
        "SETTINGS",
        colors::TEXT,
    );

    let list_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let row_h = layout::ROW_H as i32;
    let color = colors::ACCENT;

    // Section: CLOCK
    let mut row = 0i32;
    draw_section(display, list_y + row * row_h, "-- CLOCK --");
    row += 1;

    // BPM
    let mut bpm_buf = [0u8; 16];
    let bpm_str = draw::format_u16(state.transport.bpm, &mut bpm_buf);
    draw_param(display, list_y + row * row_h, "BPM", bpm_str, color, ui.settings_param == 0);
    row += 1;

    // Clock source
    let src_str = match state.transport.clock_source {
        ClockSource::Internal => "INT",
        ClockSource::Midi => "MIDI",
        ClockSource::External => "EXT",
    };
    draw_param(display, list_y + row * row_h, "SOURCE", src_str, color, ui.settings_param == 1);
    row += 1;

    // Clock out
    let clk_out_str = if state.midi_clock_out { "ON" } else { "OFF" };
    draw_param(display, list_y + row * row_h, "CLK OUT", clk_out_str, color, ui.settings_param == 2);
    row += 1;

    // Section: MIDI
    draw_section(display, list_y + row * row_h, "-- MIDI --");
    row += 1;

    // MIDI enabled
    let midi_str = if state.midi_enabled { "ON" } else { "OFF" };
    draw_param(display, list_y + row * row_h, "MIDI", midi_str, color, ui.settings_param == 3);
    row += 1;

    // MIDI channels
    for ch_idx in 0..4usize {
        let mut ch_buf = [0u8; 16];
        let ch_str = draw::fmt_buf(&mut ch_buf, format_args!("CH {}", state.midi_configs[ch_idx].channel));
        let mut label_buf = [0u8; 16];
        let label_str = draw::fmt_buf(&mut label_buf, format_args!("OUT {}", ch_idx + 1));
        draw_param(
            display,
            list_y + row * row_h,
            label_str,
            ch_str,
            colors::TRACK[ch_idx],
            ui.settings_param as usize == 4 + ch_idx,
        );
        row += 1;
    }
    let _ = row;

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

fn draw_section<D: DrawTarget<Color = Rgb565>>(display: &mut D, y: i32, label: &str) {
    let row_h = layout::ROW_H as i32;
    draw::fill_rect(display, 0, y + row_h / 2, layout::LCD_W, 1, colors::TEXT_DIM);
    draw::text_center(display, layout::LCD_W as i32 / 2, y + 7, label, colors::TEXT_DIM);
}

fn draw_param<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    y: i32,
    label: &str,
    value: &str,
    color: Rgb565,
    selected: bool,
) {
    if selected {
        draw::fill_rect(display, 0, y, layout::LCD_W, layout::ROW_H, colors::SELECTED_ROW);
        draw::text(display, layout::PAD as i32, y + 7, ">", colors::TEXT_BRIGHT);
    }
    draw::text(display, layout::PAD as i32 + 14, y + 7, label, colors::TEXT);
    draw::text_right(
        display,
        layout::LCD_W as i32 - layout::PAD as i32,
        y + 7,
        value,
        color,
    );
}
