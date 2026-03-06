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
    let total_rows = 7usize;
    let max_visible =
        ((layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H) / layout::ROW_H)
            as usize;

    let scroll = if (ui.xpose_param as usize) >= max_visible {
        ui.xpose_param as usize - max_visible + 1
    } else {
        0
    };

    // All rows
    for i in scroll..(scroll + max_visible).min(total_rows) {
        let y = list_y + (i - scroll) as i32 * row_h;

        match i {
            0 => draw_section(display, y, "PITCH"),
            1 => {
                let mut buf = [0u8; 16];
                let st_str = draw::format_i32(cfg.semitones as i32, &mut buf);
                draw_param_row(display, y, "SEMI", st_str, color, ui.xpose_param == 0);
            }
            2 => {
                let (lo_name, lo_oct) = colors::midi_note_name(cfg.note_low);
                let mut buf = [0u8; 16];
                let lo_str = draw::fmt_buf(&mut buf, format_args!("{}{}", lo_name, lo_oct));
                draw_param_row(display, y, "NOTE LO", lo_str, color, ui.xpose_param == 1);
            }
            3 => {
                let (hi_name, hi_oct) = colors::midi_note_name(cfg.note_high);
                let mut buf = [0u8; 16];
                let hi_str = draw::fmt_buf(&mut buf, format_args!("{}{}", hi_name, hi_oct));
                draw_param_row(display, y, "NOTE HI", hi_str, color, ui.xpose_param == 2);
            }
            4 => draw_section(display, y, "DYNAMICS"),
            5 => {
                let mut buf = [0u8; 16];
                let gl_str = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gl_scale * 100.0) as u16));
                draw_param_row(display, y, "GL SCALE", gl_str, color, ui.xpose_param == 3);
            }
            6 => {
                let mut buf = [0u8; 16];
                let vel_str = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.vel_scale * 100.0) as u16));
                draw_param_row(display, y, "VEL SCALE", vel_str, color, ui.xpose_param == 4);
            }
            _ => {}
        }
    }

    // Scroll indicator
    let bar_h = layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H;
    draw::scroll_bar(display, list_y, bar_h, scroll, total_rows, max_visible, color);

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
