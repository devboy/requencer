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
    let total_rows = 10usize; // 2 sections + 3 clock + 1 midi enable + 4 channels
    let max_visible =
        ((layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H) / layout::ROW_H)
            as usize;

    let scroll = if (ui.settings_param as usize) >= max_visible {
        ui.settings_param as usize - max_visible + 1
    } else {
        0
    };

    for i in scroll..(scroll + max_visible).min(total_rows) {
        let y = list_y + (i - scroll) as i32 * row_h;

        match i {
            0 => draw_section(display, y, "CLOCK"),
            1 => {
                let mut buf = [0u8; 16];
                let bpm_str = draw::format_u16(state.transport.bpm, &mut buf);
                draw_param(display, y, "BPM", bpm_str, color, ui.settings_param == 0);
            }
            2 => {
                let src_str = match state.transport.clock_source {
                    ClockSource::Internal => "INT",
                    ClockSource::Midi => "MIDI",
                    ClockSource::External => "EXT",
                };
                draw_param(display, y, "SOURCE", src_str, color, ui.settings_param == 1);
            }
            3 => {
                let clk_str = if state.midi_clock_out { "ON" } else { "OFF" };
                draw_param(display, y, "CLK OUT", clk_str, color, ui.settings_param == 2);
            }
            4 => draw_section(display, y, "MIDI"),
            5 => {
                let midi_str = if state.midi_enabled { "ON" } else { "OFF" };
                draw_param(display, y, "MIDI", midi_str, color, ui.settings_param == 3);
            }
            6..=9 => {
                let ch_idx = i - 6;
                let mut ch_buf = [0u8; 16];
                let ch_str = draw::fmt_buf(
                    &mut ch_buf,
                    format_args!("CH {}", state.midi_configs[ch_idx].channel),
                );
                let mut label_buf = [0u8; 16];
                let label_str =
                    draw::fmt_buf(&mut label_buf, format_args!("OUT {}", ch_idx + 1));
                draw_param(
                    display,
                    y,
                    label_str,
                    ch_str,
                    colors::TRACK[ch_idx],
                    ui.settings_param as usize == 4 + ch_idx,
                );
            }
            _ => {}
        }
    }

    // Scroll indicator
    let bar_h = layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H;
    draw::scroll_bar(display, list_y, bar_h, scroll, total_rows, max_visible, colors::TEXT_DIM);

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
    draw::fill_rect(
        display,
        layout::PAD as i32,
        y + row_h / 2,
        layout::LCD_W - layout::PAD * 2,
        1,
        colors::TEXT_DIM,
    );
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
    let label_color = if selected { colors::TEXT } else { colors::TEXT_DIM };
    draw::text(display, layout::PAD as i32 + 14, y + 7, label, label_color);
    let val_color = if selected { colors::TEXT_BRIGHT } else { color };
    draw::text_right(
        display,
        layout::LCD_W as i32 - layout::PAD as i32 - 6,
        y + 7,
        value,
        val_color,
    );
}
