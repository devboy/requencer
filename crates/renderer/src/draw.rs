use embedded_graphics::{
    mono_font::MonoTextStyle,
    pixelcolor::Rgb565,
    prelude::*,
    primitives::{PrimitiveStyleBuilder, Rectangle},
    text::{Alignment, Text},
};
use profont::{PROFONT_12_POINT, PROFONT_14_POINT, PROFONT_18_POINT};

use crate::layout;

/// Fill the entire screen with a color.
pub fn fill_screen<D: DrawTarget<Color = Rgb565>>(display: &mut D, color: Rgb565) {
    let _ = Rectangle::new(
        Point::zero(),
        Size::new(layout::LCD_W, layout::LCD_H),
    )
    .into_styled(PrimitiveStyleBuilder::new().fill_color(color).build())
    .draw(display);
}

/// Draw a filled rectangle.
pub fn fill_rect<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    color: Rgb565,
) {
    let _ = Rectangle::new(Point::new(x, y), Size::new(w, h))
        .into_styled(PrimitiveStyleBuilder::new().fill_color(color).build())
        .draw(display);
}

/// Draw a rectangle outline.
pub fn stroke_rect<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    color: Rgb565,
) {
    let _ = Rectangle::new(Point::new(x, y), Size::new(w, h))
        .into_styled(
            PrimitiveStyleBuilder::new()
                .stroke_color(color)
                .stroke_width(1)
                .build(),
        )
        .draw(display);
}

/// Draw text at position (left-aligned, standard 14pt font).
pub fn text<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_14_POINT, color);
    let _ = Text::new(s, Point::new(x, y + layout::CHAR_H as i32), style).draw(display);
}

/// Draw small text (12pt) — for dense info, footers, secondary labels.
pub fn text_sm<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_12_POINT, color);
    let _ = Text::new(s, Point::new(x, y + layout::CHAR_H_SM as i32), style).draw(display);
}

/// Draw large text (18pt) — for headers, titles, prominent values.
pub fn text_lg<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_18_POINT, color);
    let _ = Text::new(s, Point::new(x, y + layout::CHAR_H_LG as i32), style).draw(display);
}

/// Draw text right-aligned at x position.
pub fn text_right<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_14_POINT, color);
    let _ = Text::with_alignment(
        s,
        Point::new(x, y + layout::CHAR_H as i32),
        style,
        Alignment::Right,
    )
    .draw(display);
}

/// Draw small text right-aligned.
pub fn text_right_sm<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_12_POINT, color);
    let _ = Text::with_alignment(
        s,
        Point::new(x, y + layout::CHAR_H_SM as i32),
        style,
        Alignment::Right,
    )
    .draw(display);
}

/// Draw large text right-aligned.
pub fn text_right_lg<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_18_POINT, color);
    let _ = Text::with_alignment(
        s,
        Point::new(x, y + layout::CHAR_H_LG as i32),
        style,
        Alignment::Right,
    )
    .draw(display);
}

/// Draw text center-aligned at x position.
pub fn text_center<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_14_POINT, color);
    let _ = Text::with_alignment(
        s,
        Point::new(x, y + layout::CHAR_H as i32),
        style,
        Alignment::Center,
    )
    .draw(display);
}

/// Draw small text center-aligned.
pub fn text_center_sm<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_12_POINT, color);
    let _ = Text::with_alignment(
        s,
        Point::new(x, y + layout::CHAR_H_SM as i32),
        style,
        Alignment::Center,
    )
    .draw(display);
}

/// Draw large text center-aligned.
pub fn text_center_lg<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&PROFONT_18_POINT, color);
    let _ = Text::with_alignment(
        s,
        Point::new(x, y + layout::CHAR_H_LG as i32),
        style,
        Alignment::Center,
    )
    .draw(display);
}

/// Draw the status bar (top 24px).
pub fn status_bar<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    left_text: &str,
    bpm: u16,
    playing: bool,
) {
    use crate::colors;

    fill_rect(display, 0, 0, layout::LCD_W, layout::STATUS_H, colors::STATUS_BAR);

    // Left: mode/track info
    text(display, layout::PAD as i32, 4, left_text, colors::TEXT);

    // Right: BPM + transport
    let mut buf = [0u8; 16];
    let bpm_str = format_u16(bpm, &mut buf);
    let bpm_x = layout::LCD_W as i32 - layout::PAD as i32 - 30;
    text_right(display, bpm_x, 4, bpm_str, colors::TEXT_DIM);

    // Transport indicator
    let tx = layout::LCD_W as i32 - layout::PAD as i32 - 10;
    let ty = 7;
    let indicator_color = if playing {
        colors::PLAY_GREEN
    } else {
        colors::STOP_DIM
    };
    fill_rect(display, tx, ty, 8, 10, indicator_color);
}

/// Format u16 to string in a fixed buffer. Returns &str.
pub fn format_u16(val: u16, buf: &mut [u8; 16]) -> &str {
    use core::fmt::Write;
    let len = {
        let mut cursor = WriteCursor::new(buf);
        let _ = write!(cursor, "{}", val);
        cursor.len()
    };
    core::str::from_utf8(&buf[..len]).unwrap_or("")
}

/// Format i32 to string in a fixed buffer.
pub fn format_i32(val: i32, buf: &mut [u8; 16]) -> &str {
    use core::fmt::Write;
    let len = {
        let mut cursor = WriteCursor::new(buf);
        let _ = write!(cursor, "{}", val);
        cursor.len()
    };
    core::str::from_utf8(&buf[..len]).unwrap_or("")
}

/// Format f32 with 1 decimal place.
pub fn format_f32_1(val: f32, buf: &mut [u8; 16]) -> &str {
    use core::fmt::Write;
    let len = {
        let mut cursor = WriteCursor::new(buf);
        let int_part = val as i32;
        let frac = (((val - int_part as f32) * 10.0).abs()) as u8;
        let _ = write!(cursor, "{}.{}", int_part, frac);
        cursor.len()
    };
    core::str::from_utf8(&buf[..len]).unwrap_or("")
}

/// Write formatted text into a buffer, return &str slice of what was written.
pub fn fmt_buf<'a>(buf: &'a mut [u8; 16], args: core::fmt::Arguments<'_>) -> &'a str {
    use core::fmt::Write;
    let len = {
        let mut cursor = WriteCursor::new(buf);
        let _ = cursor.write_fmt(args);
        cursor.len()
    };
    core::str::from_utf8(&buf[..len]).unwrap_or("")
}

/// Draw a vertical scroll bar on the right edge.
pub fn scroll_bar<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    y: i32,
    height: u32,
    scroll: usize,
    total: usize,
    visible: usize,
    color: Rgb565,
) {
    if total <= visible {
        return;
    }
    let thumb_h = (height * visible as u32 / total as u32).max(8);
    let thumb_y = y + (scroll as u32 * height / total as u32) as i32;
    fill_rect(display, layout::LCD_W as i32 - 3, thumb_y, 2, thumb_h, color);
}

/// Draw a dropdown popup overlay. `anchor_y` is the y position of the row
/// that triggered the dropdown. Items are rendered centered around the anchor,
/// clamped within the LCD content area.
pub fn dropdown<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    dropdown: &crate::types::DropdownState,
    anchor_y: i32,
    track_color: Rgb565,
) {
    // Default bounds: full content area minus footer
    let top = layout::CONTENT_Y as i32;
    let bottom = layout::LCD_H as i32 - layout::EDIT_FOOTER_H as i32;
    dropdown_bounded(display, dropdown, anchor_y, track_color, top, bottom);
}

pub fn dropdown_bounded<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    dropdown: &crate::types::DropdownState,
    anchor_y: i32,
    track_color: Rgb565,
    bounds_top: i32,
    bounds_bottom: i32,
) {
    use crate::colors;

    if !dropdown.open || dropdown.items.is_empty() {
        return;
    }

    let total = dropdown.items.len();
    let max_visible: usize = 7;
    let visible = total.min(max_visible);
    let row_h = layout::ROW_H as i32;

    // Compute popup width from longest item
    let max_chars = dropdown.items.iter().map(|s| s.len()).max().unwrap_or(4);
    let popup_w = ((max_chars as u32 + 4) * layout::CHAR_W).max(120);
    let popup_x = layout::LCD_W as i32 - layout::PAD as i32 - 6 - popup_w as i32;

    let popup_h = visible as i32 * row_h;

    // Position: try to show dropdown below anchor row, flip above if no room
    let below_top = anchor_y + row_h; // just below the anchor row
    let above_bottom = anchor_y; // just above the anchor row

    let popup_top = if below_top + popup_h <= bounds_bottom {
        // Fits below — preferred position
        below_top
    } else if above_bottom - popup_h >= bounds_top {
        // Fits above
        above_bottom - popup_h
    } else {
        // Doesn't fit either way — clamp to bounds (align to bottom)
        (bounds_bottom - popup_h).max(bounds_top)
    };

    // Scroll window centered on selection
    let sel = dropdown.selected as usize;
    let mut scroll_start = sel as i32 - (visible as i32 / 2);
    scroll_start = scroll_start.max(0).min(total as i32 - visible as i32);
    let scroll_start = scroll_start as usize;

    // Background + border
    fill_rect(
        display,
        popup_x - 4,
        popup_top - 2,
        popup_w + 8,
        popup_h as u32 + 4,
        colors::DROPDOWN_BG,
    );
    stroke_rect(
        display,
        popup_x - 4,
        popup_top - 2,
        popup_w + 8,
        popup_h as u32 + 4,
        colors::DROPDOWN_BORDER,
    );

    // Draw items
    for vi in 0..visible {
        let item_idx = scroll_start + vi;
        if item_idx >= total {
            break;
        }
        let y = popup_top + vi as i32 * row_h;
        let is_sel = item_idx == sel;

        if is_sel {
            fill_rect(display, popup_x - 4, y, popup_w + 8, layout::ROW_H, colors::DROPDOWN_SEL);
            text(display, popup_x, y + 5, ">", track_color);
            text(display, popup_x + 18, y + 5, &dropdown.items[item_idx], colors::TEXT_BRIGHT);
        } else {
            text(display, popup_x + 18, y + 5, &dropdown.items[item_idx], colors::TEXT_DIM);
        }
    }
}

/// Draw a playhead indicator bar (2px wide white bar at bottom of cell).
pub fn playhead_bar<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    w: u32,
    h: u32,
) {
    fill_rect(display, x + 1, y + h as i32 - 2, w - 2, 2, crate::colors::PLAYHEAD);
}

/// Small no_std write cursor for formatting into a fixed buffer.
pub struct WriteCursor<'a> {
    buf: &'a mut [u8],
    pos: usize,
}

impl<'a> WriteCursor<'a> {
    pub fn new(buf: &'a mut [u8]) -> Self {
        Self { buf, pos: 0 }
    }

    pub fn len(&self) -> usize {
        self.pos
    }

    pub fn is_empty(&self) -> bool {
        self.pos == 0
    }
}

impl<'a> core::fmt::Write for WriteCursor<'a> {
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        let bytes = s.as_bytes();
        let remaining = self.buf.len() - self.pos;
        let to_write = bytes.len().min(remaining);
        self.buf[self.pos..self.pos + to_write].copy_from_slice(&bytes[..to_write]);
        self.pos += to_write;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_u16_zero() {
        let mut buf = [0u8; 16];
        assert_eq!(format_u16(0, &mut buf), "0");
    }

    #[test]
    fn format_u16_large() {
        let mut buf = [0u8; 16];
        assert_eq!(format_u16(65535, &mut buf), "65535");
    }

    #[test]
    fn format_i32_negative() {
        let mut buf = [0u8; 16];
        assert_eq!(format_i32(-42, &mut buf), "-42");
    }

    #[test]
    fn format_f32_1_positive() {
        let mut buf = [0u8; 16];
        assert_eq!(format_f32_1(99.5, &mut buf), "99.5");
    }

    #[test]
    fn format_f32_1_zero() {
        let mut buf = [0u8; 16];
        assert_eq!(format_f32_1(0.0, &mut buf), "0.0");
    }

    #[test]
    fn fmt_buf_basic() {
        let mut buf = [0u8; 16];
        let s = fmt_buf(&mut buf, format_args!("T{}", 3));
        assert_eq!(s, "T3");
    }

    #[test]
    fn fmt_buf_truncates_overflow() {
        let mut buf = [0u8; 16];
        // WriteCursor handles truncation internally; fmt_buf uses [u8;16]
        let s = fmt_buf(&mut buf, format_args!("ABCDEFGHIJKLMNOPQRST"));
        assert_eq!(s, "ABCDEFGHIJKLMNOP"); // truncated to 16 bytes
    }

    #[test]
    fn write_cursor_is_empty() {
        let mut buf = [0u8; 16];
        let cursor = WriteCursor::new(&mut buf);
        assert!(cursor.is_empty());
        assert_eq!(cursor.len(), 0);
    }
}
