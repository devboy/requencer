use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::{MutateTrigger, SequencerState};

use crate::{colors, draw, layout, types::UiState};

/// Render the drift/mutate screen: 4 rate bars + trigger config.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let track_idx = ui.selected_track as usize;
    let cfg = &state.mutate_configs[track_idx];
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
        "DRIFT",
        color,
    );

    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let row_h = 36i32;
    let bar_w = layout::LCD_W - layout::PAD * 2 - 80;

    // Rate rows
    let rates: [(&str, f32); 4] = [
        ("GATE", cfg.gate),
        ("PITCH", cfg.pitch),
        ("VEL", cfg.velocity),
        ("MOD", cfg.modulation),
    ];

    for (i, (label, rate)) in rates.iter().enumerate() {
        let y = grid_y + i as i32 * row_h;
        let is_sel = ui.mutate_param as usize == i;

        if is_sel {
            draw::fill_rect(display, 0, y, layout::LCD_W, row_h as u32, colors::SELECTED_ROW);
            draw::text(display, layout::PAD as i32, y + 13, ">", colors::TEXT_BRIGHT);
        }

        draw::text(display, layout::PAD as i32 + 14, y + 13, label, colors::TEXT);

        // Rate bar background
        let bar_x = layout::PAD as i32 + 70;
        draw::fill_rect(display, bar_x, y + 8, bar_w, 16, colors::BUTTON_BG);

        // Rate bar fill
        if *rate > 0.0 {
            let fill_w = (*rate * bar_w as f32) as u32;
            draw::fill_rect(display, bar_x, y + 8, fill_w.max(1), 16, color);
        }

        // Percentage text
        let mut buf = [0u8; 16];
        if *rate > 0.0 {
            let pct_str = draw::format_f32_1(*rate * 100.0, &mut buf);
            draw::text_right(
                display,
                layout::LCD_W as i32 - layout::PAD as i32,
                y + 13,
                pct_str,
                color,
            );
        } else {
            draw::text_right(
                display,
                layout::LCD_W as i32 - layout::PAD as i32,
                y + 13,
                "OFF",
                colors::TEXT_DIM,
            );
        }
    }

    // Trigger row
    let trig_y = grid_y + 4 * row_h;
    let is_trig_sel = ui.mutate_param == 4;
    if is_trig_sel {
        draw::fill_rect(display, 0, trig_y, layout::LCD_W, row_h as u32, colors::SELECTED_ROW);
        draw::text(display, layout::PAD as i32, trig_y + 13, ">", colors::TEXT_BRIGHT);
    }
    draw::text(display, layout::PAD as i32 + 14, trig_y + 13, "TRIGGER", colors::TEXT);
    let trig_str = match cfg.trigger {
        MutateTrigger::Loop => "LOOP",
        MutateTrigger::Bars => "BARS",
    };
    draw::text_right(
        display,
        layout::LCD_W as i32 - layout::PAD as i32,
        trig_y + 13,
        trig_str,
        color,
    );

    // Bars/loops count row
    let bars_y = grid_y + 5 * row_h;
    let is_bars_sel = ui.mutate_param == 5;
    if is_bars_sel {
        draw::fill_rect(display, 0, bars_y, layout::LCD_W, row_h as u32, colors::SELECTED_ROW);
        draw::text(display, layout::PAD as i32, bars_y + 13, ">", colors::TEXT_BRIGHT);
    }
    draw::text(display, layout::PAD as i32 + 14, bars_y + 13, "EVERY", colors::TEXT);
    let mut bars_buf = [0u8; 16];
    let bars_str = draw::format_u16(cfg.bars as u16, &mut bars_buf);
    draw::text_right(
        display,
        layout::LCD_W as i32 - layout::PAD as i32,
        bars_y + 13,
        bars_str,
        color,
    );

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
