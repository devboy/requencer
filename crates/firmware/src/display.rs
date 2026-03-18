//! ST7796 480×320 TFT display driver over SPI0.
//!
//! Uses a framebuffer in memory that implements `DrawTarget<Color = Rgb565>`.
//! After rendering via the renderer crate, the framebuffer is flushed to the
//! display over SPI using scanline DMA transfers.

#[cfg(target_os = "none")]
use defmt::info;
#[cfg(target_os = "none")]
use embassy_rp::gpio::Output;
#[cfg(target_os = "none")]
use embassy_rp::spi::Spi;
#[cfg(target_os = "none")]
use embassy_time::Timer;
use embedded_graphics_core::pixelcolor::raw::RawU16;
use embedded_graphics_core::pixelcolor::Rgb565;
use embedded_graphics_core::prelude::*;

/// Display dimensions.
pub const WIDTH: u32 = 480;
pub const HEIGHT: u32 = 320;
const PIXEL_COUNT: usize = (WIDTH * HEIGHT) as usize;

/// Framebuffer holding the full display contents in Rgb565.
/// After rendering with embedded-graphics, call `flush()` to transfer to hardware.
pub struct Framebuffer {
    pixels: [u16; PIXEL_COUNT],
}

impl Default for Framebuffer {
    fn default() -> Self {
        Self::new()
    }
}

impl Framebuffer {
    pub const fn new() -> Self {
        Self {
            pixels: [0; PIXEL_COUNT],
        }
    }
}

impl DrawTarget for Framebuffer {
    type Color = Rgb565;
    type Error = core::convert::Infallible;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Self::Color>>,
    {
        for Pixel(point, color) in pixels {
            if point.x >= 0
                && point.x < WIDTH as i32
                && point.y >= 0
                && point.y < HEIGHT as i32
            {
                let idx = point.y as usize * WIDTH as usize + point.x as usize;
                self.pixels[idx] = RawU16::from(color).into_inner();
            }
        }
        Ok(())
    }
}

impl OriginDimensions for Framebuffer {
    fn size(&self) -> Size {
        Size::new(WIDTH, HEIGHT)
    }
}

#[cfg(target_os = "none")]
mod cmd {
    pub const SWRESET: u8 = 0x01;
    pub const SLPOUT: u8 = 0x11;
    pub const DISPON: u8 = 0x29;
    pub const MADCTL: u8 = 0x36;
    pub const COLMOD: u8 = 0x3A;
    pub const CASET: u8 = 0x2A;
    pub const RASET: u8 = 0x2B;
    pub const RAMWR: u8 = 0x2C;
}

/// State for chunked display flush. Tracks which scanline band to send next.
#[cfg(target_os = "none")]
pub struct FlushState {
    next_y: usize,
}

#[cfg(target_os = "none")]
type Spi0 = Spi<'static, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>;

/// ST7796 display driver. Does not own the SPI bus — callers pass `&mut Spi0`
/// so the bus can be shared with the SD card (both on SPI0, never simultaneously).
#[cfg(target_os = "none")]
pub struct Display<'a> {
    cs: Output<'a>,
    dc: Output<'a>,
    backlight: Output<'a>,
    rst: Output<'a>,
}

#[cfg(target_os = "none")]
impl<'a> Display<'a> {
    pub fn new(
        cs: Output<'a>,
        dc: Output<'a>,
        backlight: Output<'a>,
        rst: Output<'a>,
    ) -> Self {
        Self { cs, dc, backlight, rst }
    }

    /// Send a command byte (DC low).
    fn write_cmd(&mut self, spi: &mut Spi0, cmd: u8) {
        self.dc.set_low();
        self.cs.set_low();
        if spi.blocking_write(&[cmd]).is_err() {
            defmt::warn!("Display SPI cmd write failed");
        }
        self.cs.set_high();
    }

    /// Send data bytes (DC high).
    fn write_data(&mut self, spi: &mut Spi0, data: &[u8]) {
        self.dc.set_high();
        self.cs.set_low();
        if spi.blocking_write(data).is_err() {
            defmt::warn!("Display SPI data write failed");
        }
        self.cs.set_high();
    }

    /// Send a command followed by data.
    fn write_cmd_data(&mut self, spi: &mut Spi0, cmd: u8, data: &[u8]) {
        self.write_cmd(spi, cmd);
        self.write_data(spi, data);
    }

    /// Initialize the ST7796 display.
    pub async fn init(&mut self, spi: &mut Spi0) {
        info!("ST7796: initializing display");

        // Hardware reset (GP22, active low)
        self.rst.set_low();
        Timer::after_millis(10).await;
        self.rst.set_high();
        Timer::after_millis(120).await;

        // Software reset (belt and suspenders)
        self.write_cmd(spi, cmd::SWRESET);
        Timer::after_millis(150).await;

        // Sleep out
        self.write_cmd(spi, cmd::SLPOUT);
        Timer::after_millis(60).await;

        // Pixel format: 16bpp (RGB565)
        self.write_cmd_data(spi, cmd::COLMOD, &[0x55]);

        // Memory access control: landscape mode (MY=0, MX=1, MV=1)
        // This gives us 480 wide × 320 tall
        self.write_cmd_data(spi, cmd::MADCTL, &[0x60]);

        // Display on
        self.write_cmd(spi, cmd::DISPON);
        Timer::after_millis(20).await;

        // Backlight on
        self.backlight.set_high();

        info!("ST7796: display initialized, backlight on");
    }

    /// Set the drawing window to full screen.
    fn set_address_window(&mut self, spi: &mut Spi0) {
        // Column address (0 to WIDTH-1)
        self.write_cmd_data(
            spi,
            cmd::CASET,
            &[
                0,
                0,
                ((WIDTH - 1) >> 8) as u8,
                ((WIDTH - 1) & 0xFF) as u8,
            ],
        );
        // Row address (0 to HEIGHT-1)
        self.write_cmd_data(
            spi,
            cmd::RASET,
            &[
                0,
                0,
                ((HEIGHT - 1) >> 8) as u8,
                ((HEIGHT - 1) & 0xFF) as u8,
            ],
        );
    }

    /// Number of scanlines per flush chunk. At 62.5 MHz SPI, each scanline
    /// takes ~15µs to transfer. 16 lines = ~240µs blocking per chunk,
    /// giving the main loop ~20 opportunities per frame to service ticks.
    const CHUNK_LINES: usize = 16;

    /// Flush a band of scanlines [y_start, y_end) to the display.
    /// Returns false if an SPI write failed (caller should stop flushing).
    fn flush_band(&mut self, spi: &mut Spi0, fb: &Framebuffer, y_start: usize, y_end: usize) -> bool {
        const LINE_PIXELS: usize = WIDTH as usize;
        let mut line_buf = [0u8; LINE_PIXELS * 2];

        for y in y_start..y_end {
            let start = y * LINE_PIXELS;
            let end = start + LINE_PIXELS;
            for (i, &px) in fb.pixels[start..end].iter().enumerate() {
                // ST7796 expects big-endian RGB565
                line_buf[i * 2] = (px >> 8) as u8;
                line_buf[i * 2 + 1] = (px & 0xFF) as u8;
            }
            if spi.blocking_write(&line_buf).is_err() {
                defmt::warn!("Display SPI scanline write failed at y={}", y);
                return false;
            }
        }
        true
    }

    /// Begin a chunked flush: send address window + RAMWR command, assert CS.
    /// Returns a FlushState to pass to flush_next_chunk.
    pub fn flush_begin(&mut self, spi: &mut Spi0) -> FlushState {
        self.set_address_window(spi);
        self.write_cmd(spi, cmd::RAMWR);
        self.dc.set_high();
        self.cs.set_low();
        FlushState { next_y: 0 }
    }

    /// Flush the next chunk of scanlines. Returns true if more chunks remain.
    /// Call from the main loop between tick processing to reduce blocking.
    pub fn flush_next_chunk(&mut self, spi: &mut Spi0, fb: &Framebuffer, state: &mut FlushState) -> bool {
        if state.next_y >= HEIGHT as usize {
            self.cs.set_high();
            return false;
        }
        let y_end = (state.next_y + Self::CHUNK_LINES).min(HEIGHT as usize);
        if !self.flush_band(spi, fb, state.next_y, y_end) {
            self.cs.set_high();
            return false;
        }
        state.next_y = y_end;
        if state.next_y >= HEIGHT as usize {
            self.cs.set_high();
            return false;
        }
        true
    }

    /// Blocking flush — transfers entire framebuffer at once.
    /// Use flush_begin + flush_next_chunk for non-blocking chunked transfers.
    #[allow(dead_code)]
    pub fn flush(&mut self, spi: &mut Spi0, fb: &Framebuffer) {
        let mut state = self.flush_begin(spi);
        while self.flush_next_chunk(spi, fb, &mut state) {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use embedded_graphics_core::pixelcolor::Rgb565;

    #[test]
    fn framebuffer_dimensions() {
        let fb = Framebuffer::new();
        assert_eq!(fb.size(), Size::new(480, 320));
    }

    #[test]
    fn framebuffer_initial_state_is_black() {
        let fb = Framebuffer::new();
        assert!(fb.pixels.iter().all(|&p| p == 0));
    }

    #[test]
    fn framebuffer_draw_single_pixel() {
        let mut fb = Framebuffer::new();
        let color = Rgb565::new(31, 63, 31); // White
        let pixel = Pixel(Point::new(10, 20), color);
        fb.draw_iter(core::iter::once(pixel)).unwrap();

        let idx = 20 * WIDTH as usize + 10;
        let raw = RawU16::from(color).into_inner();
        assert_eq!(fb.pixels[idx], raw);
    }

    #[test]
    fn framebuffer_draw_origin() {
        let mut fb = Framebuffer::new();
        let color = Rgb565::new(31, 0, 0); // Red
        let pixel = Pixel(Point::new(0, 0), color);
        fb.draw_iter(core::iter::once(pixel)).unwrap();
        assert_ne!(fb.pixels[0], 0);
    }

    #[test]
    fn framebuffer_draw_last_pixel() {
        let mut fb = Framebuffer::new();
        let color = Rgb565::new(0, 63, 0); // Green
        let pixel = Pixel(Point::new(479, 319), color);
        fb.draw_iter(core::iter::once(pixel)).unwrap();

        let idx = 319 * 480 + 479;
        assert_ne!(fb.pixels[idx], 0);
    }

    #[test]
    fn framebuffer_clips_negative_x() {
        let mut fb = Framebuffer::new();
        let pixel = Pixel(Point::new(-1, 0), Rgb565::new(31, 0, 0));
        fb.draw_iter(core::iter::once(pixel)).unwrap();
        // Should not crash, and no pixel should be written
        assert!(fb.pixels.iter().all(|&p| p == 0));
    }

    #[test]
    fn framebuffer_clips_negative_y() {
        let mut fb = Framebuffer::new();
        let pixel = Pixel(Point::new(0, -1), Rgb565::new(31, 0, 0));
        fb.draw_iter(core::iter::once(pixel)).unwrap();
        assert!(fb.pixels.iter().all(|&p| p == 0));
    }

    #[test]
    fn framebuffer_clips_beyond_width() {
        let mut fb = Framebuffer::new();
        let pixel = Pixel(Point::new(480, 0), Rgb565::new(31, 0, 0));
        fb.draw_iter(core::iter::once(pixel)).unwrap();
        assert!(fb.pixels.iter().all(|&p| p == 0));
    }

    #[test]
    fn framebuffer_clips_beyond_height() {
        let mut fb = Framebuffer::new();
        let pixel = Pixel(Point::new(0, 320), Rgb565::new(31, 0, 0));
        fb.draw_iter(core::iter::once(pixel)).unwrap();
        assert!(fb.pixels.iter().all(|&p| p == 0));
    }

    #[test]
    fn framebuffer_multiple_pixels() {
        let mut fb = Framebuffer::new();
        let red = Rgb565::new(31, 0, 0);
        let green = Rgb565::new(0, 63, 0);
        let pixels = [
            Pixel(Point::new(0, 0), red),
            Pixel(Point::new(100, 100), green),
        ];
        fb.draw_iter(pixels.into_iter()).unwrap();

        assert_ne!(fb.pixels[0], 0);
        assert_ne!(fb.pixels[100 * 480 + 100], 0);
        // Other pixels should still be 0
        assert_eq!(fb.pixels[1], 0);
    }

    #[test]
    fn framebuffer_pixel_index_calculation() {
        // Verify that pixel at (x, y) maps to index y * WIDTH + x
        let mut fb = Framebuffer::new();
        let color = Rgb565::new(31, 63, 31);
        for x in [0, 1, 239, 479] {
            for y in [0, 1, 159, 319] {
                fb.draw_iter(core::iter::once(Pixel(Point::new(x, y), color))).unwrap();
                let idx = y as usize * WIDTH as usize + x as usize;
                assert_ne!(fb.pixels[idx], 0, "pixel ({}, {}) not set at index {}", x, y, idx);
            }
        }
    }
}
