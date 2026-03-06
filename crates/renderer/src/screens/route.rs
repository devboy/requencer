use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::{ModSource, SequencerState};

use crate::{colors, draw, layout, types::UiState};

/// Render the route screen: 4 rows showing output-to-track routing.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let output_idx = ui.selected_track as usize;
    let routing = &state.routing[output_idx];
    let color = colors::TRACK[output_idx];

    // Header
    draw::fill_rect(
        display,
        0,
        layout::CONTENT_Y as i32,
        layout::LCD_W,
        layout::EDIT_HEADER_H,
        colors::STATUS_BAR,
    );
    let mut hdr_buf = [0u8; 16];
    let hdr_str = draw::fmt_buf(&mut hdr_buf, format_args!("ROUTE O{}", output_idx + 1));
    draw::text(
        display,
        layout::PAD as i32,
        layout::CONTENT_Y as i32 + 9,
        hdr_str,
        color,
    );

    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let avail_h = layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H;
    let row_h = avail_h / 4;

    let rows: [(&str, u8, Option<&str>); 4] = [
        ("GATE", routing.gate, None),
        ("PITCH", routing.pitch, None),
        ("VEL", routing.velocity, None),
        (
            "MOD",
            routing.modulation,
            Some(match routing.mod_source {
                ModSource::Seq => "MOD",
                ModSource::Lfo => "LFO",
            }),
        ),
    ];

    for (i, (label, source, suffix)) in rows.iter().enumerate() {
        let y = grid_y + i as i32 * row_h as i32;
        let is_sel = ui.route_param as usize == i;
        let source_color = colors::TRACK[*source as usize];

        if is_sel {
            draw::fill_rect(display, 0, y, layout::LCD_W, row_h, colors::SELECTED_ROW);
        }

        // Cursor (unicode-style arrow)
        let cursor_color = if is_sel { colors::TEXT_BRIGHT } else { colors::LCD_BG };
        draw::text(display, layout::PAD as i32, y + row_h as i32 / 2 - 5, ">", cursor_color);

        // Label
        let label_color = if is_sel { colors::TEXT } else { colors::TEXT_DIM };
        draw::text(display, layout::PAD as i32 + 14, y + row_h as i32 / 2 - 5, label, label_color);

        // Arrow
        draw::text_center(
            display,
            layout::LCD_W as i32 / 2,
            y + row_h as i32 / 2 - 5,
            "<-",
            colors::TEXT_DIM,
        );

        // Source track
        let mut src_buf = [0u8; 16];
        let src_str = match suffix {
            Some(s) => draw::fmt_buf(&mut src_buf, format_args!("T{} {}", *source + 1, s)),
            None => draw::fmt_buf(&mut src_buf, format_args!("T{}", *source + 1)),
        };
        draw::text_right(
            display,
            layout::LCD_W as i32 - layout::PAD as i32,
            y + row_h as i32 / 2 - 5,
            src_str,
            source_color,
        );

        // Hint on MOD row when selected: PUSH to toggle MOD/LFO
        if i == 3 && is_sel {
            draw::text_right(
                display,
                layout::LCD_W as i32 - layout::PAD as i32,
                y + row_h as i32 / 2 + 6,
                "PUSH:MOD/LFO",
                colors::TEXT_DIM,
            );
        }
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
