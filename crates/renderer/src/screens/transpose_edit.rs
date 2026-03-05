use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

use crate::{colors, draw, layout, types::UiState};

/// Render the transpose/scale screen.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let track_idx = ui.selected_track as usize;
    let cfg = &state.transpose_configs[track_idx];
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
    draw::text(
        display,
        layout::PAD as i32,
        layout::CONTENT_Y as i32 + 9,
        "XPOSE",
        color,
    );

    let list_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let row_h = layout::ROW_H as i32;

    // Section: PITCH
    let mut row = 0i32;
    draw::fill_rect(display, 0, list_y + row * row_h + row_h / 2, layout::LCD_W, 1, colors::TEXT_DIM);
    draw::text_center(display, layout::LCD_W as i32 / 2, list_y + row * row_h + 7, "-- PITCH --", colors::TEXT_DIM);
    row += 1;

    // Semitones
    let mut st_buf = [0u8; 16];
    let st_str = draw::format_i32(cfg.semitones as i32, &mut st_buf);
    draw_param_row(display, list_y + row * row_h, "SEMI", st_str, color, ui.xpose_param == 0);
    row += 1;

    // Note low
    let (lo_name, lo_oct) = colors::midi_note_name(cfg.note_low);
    let mut lo_buf = [0u8; 16];
    let lo_str = draw::fmt_buf(&mut lo_buf, format_args!("{}{}", lo_name, lo_oct));
    draw_param_row(display, list_y + row * row_h, "NOTE LO", lo_str, color, ui.xpose_param == 1);
    row += 1;

    // Note high
    let (hi_name, hi_oct) = colors::midi_note_name(cfg.note_high);
    let mut hi_buf = [0u8; 16];
    let hi_str = draw::fmt_buf(&mut hi_buf, format_args!("{}{}", hi_name, hi_oct));
    draw_param_row(display, list_y + row * row_h, "NOTE HI", hi_str, color, ui.xpose_param == 2);
    row += 1;

    // Section: DYNAMICS
    draw::fill_rect(display, 0, list_y + row * row_h + row_h / 2, layout::LCD_W, 1, colors::TEXT_DIM);
    draw::text_center(display, layout::LCD_W as i32 / 2, list_y + row * row_h + 7, "-- DYNAMICS --", colors::TEXT_DIM);
    row += 1;

    // GL scale
    let mut gl_buf = [0u8; 16];
    let gl_str = draw::format_f32_1(cfg.gl_scale * 100.0, &mut gl_buf);
    draw_param_row(display, list_y + row * row_h, "GL SCALE %", gl_str, color, ui.xpose_param == 3);
    row += 1;

    // Vel scale
    let mut vel_buf = [0u8; 16];
    let vel_str = draw::format_f32_1(cfg.vel_scale * 100.0, &mut vel_buf);
    draw_param_row(display, list_y + row * row_h, "VEL SCALE %", vel_str, color, ui.xpose_param == 4);
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

fn draw_param_row<D: DrawTarget<Color = Rgb565>>(
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
