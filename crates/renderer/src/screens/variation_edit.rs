use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::{SequencerState, TransformType};

use crate::{colors, draw, layout, types::UiState};

/// Render the variation screen: bar overview + transform stack.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let track_idx = ui.selected_track as usize;
    let var = &state.variation_patterns[track_idx];
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

    let enabled_str = if var.enabled { "VAR ON" } else { "VAR OFF" };
    draw::text(
        display,
        layout::PAD as i32,
        layout::CONTENT_Y as i32 + 9,
        enabled_str,
        if var.enabled { color } else { colors::TEXT_DIM },
    );

    let grid_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;

    // Bar grid: 2 rows × 8 cols
    let cell_w = (layout::LCD_W - layout::PAD * 2) / 8;
    let cell_h: u32 = 28;

    for row in 0..2u32 {
        for col in 0..8u32 {
            let bar_idx = (row * 8 + col) as usize;
            if bar_idx >= var.length as usize {
                continue;
            }
            let x = layout::PAD as i32 + col as i32 * cell_w as i32;
            let y = grid_y + row as i32 * cell_h as i32;
            let is_current = var.current_bar as usize == bar_idx;
            let is_selected = ui.var_selected_bar >= 0 && ui.var_selected_bar as usize == bar_idx;
            let slot = &var.slots[bar_idx];
            let has_transforms = !slot.transforms.is_empty();

            let bg = if is_current {
                colors::SELECTED_ROW
            } else {
                colors::LCD_BG
            };
            draw::fill_rect(display, x + 1, y + 1, cell_w - 2, cell_h - 2, bg);

            // Bar number
            let mut buf = [0u8; 16];
            let bar_str = draw::format_u16(bar_idx as u16 + 1, &mut buf);
            draw::text_center(
                display,
                x + cell_w as i32 / 2,
                y + 4,
                bar_str,
                if has_transforms { color } else { colors::TEXT_DIM },
            );

            // Transform count dot
            if has_transforms {
                let count = slot.transforms.len() as u32;
                let dot_w = (count * 4).min(cell_w - 6);
                draw::fill_rect(
                    display,
                    x + (cell_w as i32 - dot_w as i32) / 2,
                    y + cell_h as i32 - 5,
                    dot_w,
                    2,
                    color,
                );
            }

            if is_selected {
                draw::stroke_rect(display, x, y, cell_w, cell_h, colors::TEXT_BRIGHT);
            }
        }
    }

    // Transform stack (below grid, if a bar is selected)
    let stack_y = grid_y + 2 * cell_h as i32 + 4;

    if ui.var_selected_bar >= 0 {
        let bar_idx = ui.var_selected_bar as usize;
        if bar_idx < var.slots.len() {
            let slot = &var.slots[bar_idx];

            for (i, t) in slot.transforms.iter().enumerate() {
                let y = stack_y + i as i32 * layout::ROW_H as i32;
                let is_cursor = ui.var_cursor as usize == i;

                if is_cursor {
                    draw::fill_rect(display, 0, y, layout::LCD_W, layout::ROW_H, colors::SELECTED_ROW);
                }

                // Transform number + name
                let mut t_buf = [0u8; 16];
                let t_str = draw::fmt_buf(&mut t_buf, format_args!("{}. {}", i + 1, transform_name(t.transform_type)));
                draw::text(display, layout::PAD as i32 + 4, y + 7, t_str, colors::TEXT);

                // Parameter
                if t.param != 0 {
                    let mut p_buf = [0u8; 16];
                    let p_str = draw::format_i32(t.param, &mut p_buf);
                    draw::text_right(
                        display,
                        layout::LCD_W as i32 - layout::PAD as i32,
                        y + 7,
                        p_str,
                        color,
                    );
                }
            }
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

fn transform_name(t: TransformType) -> &'static str {
    match t {
        TransformType::Reverse => "REV",
        TransformType::PingPong => "PING",
        TransformType::Rotate => "ROT",
        TransformType::DoubleTime => "2X",
        TransformType::Stutter => "STUT",
        TransformType::HalfTime => "1/2",
        TransformType::Skip => "SKIP",
        TransformType::DrunkWalk => "DRUNK",
        TransformType::Scramble => "SCRM",
        TransformType::Thin => "THIN",
        TransformType::Fill => "FILL",
        TransformType::SkipEven => "SKPE",
        TransformType::SkipOdd => "SKPO",
        TransformType::InvertGates => "INVG",
        TransformType::Densify => "DENS",
        TransformType::Drop => "DROP",
        TransformType::Ratchet => "RCHT",
        TransformType::Transpose => "XPOS",
        TransformType::Invert => "INV",
        TransformType::OctaveShift => "OCT",
        TransformType::Fold => "FOLD",
        TransformType::Quantize => "QNTZ",
        TransformType::Accent => "ACNT",
        TransformType::FadeIn => "FD>",
        TransformType::FadeOut => "FD<",
        TransformType::Humanize => "HUMN",
    }
}
