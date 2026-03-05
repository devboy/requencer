use embedded_graphics::{
    mono_font::{ascii::FONT_6X10, MonoTextStyle},
    pixelcolor::Rgb565,
    prelude::*,
    primitives::{PrimitiveStyleBuilder, Rectangle},
    text::{Alignment, Text},
};

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

/// Draw text at position (left-aligned, 6x10 font).
pub fn text<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&FONT_6X10, color);
    let _ = Text::new(s, Point::new(x, y + layout::CHAR_H as i32), style).draw(display);
}

/// Draw text right-aligned at x position.
pub fn text_right<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    x: i32,
    y: i32,
    s: &str,
    color: Rgb565,
) {
    let style = MonoTextStyle::new(&FONT_6X10, color);
    let _ = Text::with_alignment(
        s,
        Point::new(x, y + layout::CHAR_H as i32),
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
    let style = MonoTextStyle::new(&FONT_6X10, color);
    let _ = Text::with_alignment(
        s,
        Point::new(x, y + layout::CHAR_H as i32),
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
    text(display, layout::PAD as i32, 7, left_text, colors::TEXT);

    // Right: BPM + transport
    let mut buf = [0u8; 16];
    let bpm_str = format_u16(bpm, &mut buf);
    let bpm_x = layout::LCD_W as i32 - layout::PAD as i32 - 30;
    text_right(display, bpm_x, 7, bpm_str, colors::TEXT_DIM);

    // Transport indicator
    let tx = layout::LCD_W as i32 - layout::PAD as i32 - 8;
    let ty = 8;
    let indicator_color = if playing {
        colors::PLAY_GREEN
    } else {
        colors::STOP_DIM
    };
    fill_rect(display, tx, ty, 6, 8, indicator_color);
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
