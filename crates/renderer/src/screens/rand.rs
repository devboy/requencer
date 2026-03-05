use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::{GateAlgo, ModMode, PitchMode, SequencerState, VelocityMode};

use crate::{colors, draw, layout, types::UiState};

/// Render the randomizer parameter screen.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let track_idx = ui.selected_track as usize;
    let cfg = &state.random_configs[track_idx];
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
        "RAND",
        color,
    );

    let list_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let row_h = layout::ROW_H as i32;
    let max_visible =
        ((layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H) / layout::ROW_H)
            as usize;
    let total_rows: usize = 22;

    let scroll = if (ui.rand_param as usize) >= max_visible {
        ui.rand_param as usize - max_visible + 1
    } else {
        0
    };

    for i in scroll..(scroll + max_visible).min(total_rows) {
        let y = list_y + (i - scroll) as i32 * row_h;
        let is_sel = ui.rand_param as usize == i;
        let mut buf = [0u8; 16];

        match i {
            0 => draw_section(display, y, "PITCH"),
            1 => draw_row(display, y, "MODE", pitch_mode_name(cfg.pitch.mode), color, is_sel),
            2 => {
                let v = draw::format_u16(cfg.pitch.low as u16, &mut buf);
                draw_row(display, y, "LO", v, color, is_sel);
            }
            3 => {
                let v = draw::format_u16(cfg.pitch.high as u16, &mut buf);
                draw_row(display, y, "HI", v, color, is_sel);
            }
            4 => draw_section(display, y, "GATE"),
            5 => draw_row(display, y, "MODE", gate_mode_name(cfg.gate.mode), color, is_sel),
            6 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate.fill_min * 100.0) as u16));
                draw_row(display, y, "FILL MIN", v, color, is_sel);
            }
            7 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate.fill_max * 100.0) as u16));
                draw_row(display, y, "FILL MAX", v, color, is_sel);
            }
            8 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate_length.min * 100.0) as u16));
                draw_row(display, y, "GL MIN", v, color, is_sel);
            }
            9 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate_length.max * 100.0) as u16));
                draw_row(display, y, "GL MAX", v, color, is_sel);
            }
            10 => {
                let v = draw::format_u16(cfg.ratchet.max_ratchet as u16, &mut buf);
                draw_row(display, y, "RATCH MAX", v, color, is_sel);
            }
            11 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.ratchet.probability * 100.0) as u16));
                draw_row(display, y, "RATCH %", v, color, is_sel);
            }
            12 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.slide.probability * 100.0) as u16));
                draw_row(display, y, "SLIDE %", v, color, is_sel);
            }
            13 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.tie.probability * 100.0) as u16));
                draw_row(display, y, "TIE %", v, color, is_sel);
            }
            14 => draw_section(display, y, "VEL"),
            15 => draw_row(display, y, "MODE", vel_mode_name(cfg.velocity.mode), color, is_sel),
            16 => {
                let v = draw::format_u16(cfg.velocity.low as u16, &mut buf);
                draw_row(display, y, "LO", v, color, is_sel);
            }
            17 => {
                let v = draw::format_u16(cfg.velocity.high as u16, &mut buf);
                draw_row(display, y, "HI", v, color, is_sel);
            }
            18 => draw_section(display, y, "MOD"),
            19 => draw_row(display, y, "MODE", mod_mode_name(cfg.modulation.mode), color, is_sel),
            20 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.modulation.low * 100.0) as u16));
                draw_row(display, y, "LO", v, color, is_sel);
            }
            21 => {
                let v = draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.modulation.high * 100.0) as u16));
                draw_row(display, y, "HI", v, color, is_sel);
            }
            _ => {}
        }
    }

    // Scroll indicator (track color)
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
    draw::fill_rect(display, layout::PAD as i32, y + row_h / 2, layout::LCD_W - layout::PAD * 2, 1, colors::TEXT_DIM);
    draw::text_center(display, layout::LCD_W as i32 / 2, y + 7, label, colors::TEXT_DIM);
}

fn draw_row<D: DrawTarget<Color = Rgb565>>(
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

fn pitch_mode_name(m: PitchMode) -> &'static str {
    match m {
        PitchMode::Random => "RAND",
        PitchMode::Arp => "ARP",
        PitchMode::Walk => "WALK",
        PitchMode::Rise => "RISE",
        PitchMode::Fall => "FALL",
    }
}

fn gate_mode_name(m: GateAlgo) -> &'static str {
    match m {
        GateAlgo::Random => "RAND",
        GateAlgo::Euclidean => "EUCL",
        GateAlgo::Sync => "SYNC",
        GateAlgo::Cluster => "CLST",
    }
}

fn vel_mode_name(m: VelocityMode) -> &'static str {
    match m {
        VelocityMode::Random => "RAND",
        VelocityMode::Accent => "ACNT",
        VelocityMode::Sync => "SYNC",
        VelocityMode::Rise => "RISE",
        VelocityMode::Fall => "FALL",
        VelocityMode::Walk => "WALK",
    }
}

fn mod_mode_name(m: ModMode) -> &'static str {
    match m {
        ModMode::Random => "RAND",
        ModMode::Rise => "RISE",
        ModMode::Fall => "FALL",
        ModMode::Vee => "VEE",
        ModMode::Hill => "HILL",
        ModMode::Sync => "SYNC",
        ModMode::Walk => "WALK",
    }
}
