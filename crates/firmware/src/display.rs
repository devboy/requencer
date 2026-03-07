//! ST7796 480×320 TFT display driver over SPI0.
//!
//! Uses a framebuffer in memory that implements `DrawTarget<Color = Rgb565>`.
//! After rendering via the renderer crate, the framebuffer is flushed to the
//! display over SPI using scanline DMA transfers.

use defmt::info;
use embassy_rp::gpio::Output;
use embassy_rp::spi::Spi;
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

/// ST7796 command bytes.
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

/// Hardware display handle — manages the SPI bus, CS, and DC pins.
pub struct Display<'a> {
    spi: Spi<'a, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
    cs: Output<'a>,
    dc: Output<'a>,
    backlight: Output<'a>,
}

impl<'a> Display<'a> {
    pub fn new(
        spi: Spi<'a, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
        cs: Output<'a>,
        dc: Output<'a>,
        backlight: Output<'a>,
    ) -> Self {
        Self {
            spi,
            cs,
            dc,
            backlight,
        }
    }

    /// Send a command byte (DC low).
    fn write_cmd(&mut self, cmd: u8) {
        self.dc.set_low();
        self.cs.set_low();
        let _ = self.spi.blocking_write(&[cmd]);
        self.cs.set_high();
    }

    /// Send data bytes (DC high).
    fn write_data(&mut self, data: &[u8]) {
        self.dc.set_high();
        self.cs.set_low();
        let _ = self.spi.blocking_write(data);
        self.cs.set_high();
    }

    /// Send a command followed by data.
    fn write_cmd_data(&mut self, cmd: u8, data: &[u8]) {
        self.write_cmd(cmd);
        self.write_data(data);
    }

    /// Initialize the ST7796 display.
    pub async fn init(&mut self) {
        info!("ST7796: initializing display");

        // Hardware reset would go here if we had a RST pin
        // Software reset
        self.write_cmd(cmd::SWRESET);
        Timer::after_millis(150).await;

        // Sleep out
        self.write_cmd(cmd::SLPOUT);
        Timer::after_millis(60).await;

        // Pixel format: 16bpp (RGB565)
        self.write_cmd_data(cmd::COLMOD, &[0x55]);

        // Memory access control: landscape mode (MY=0, MX=1, MV=1)
        // This gives us 480 wide × 320 tall
        self.write_cmd_data(cmd::MADCTL, &[0x60]);

        // Display on
        self.write_cmd(cmd::DISPON);
        Timer::after_millis(20).await;

        // Backlight on
        self.backlight.set_high();

        info!("ST7796: display initialized, backlight on");
    }

    /// Set the drawing window to full screen.
    fn set_address_window(&mut self) {
        // Column address (0 to WIDTH-1)
        self.write_cmd_data(
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
            cmd::RASET,
            &[
                0,
                0,
                ((HEIGHT - 1) >> 8) as u8,
                ((HEIGHT - 1) & 0xFF) as u8,
            ],
        );
    }

    /// Flush the framebuffer to the display via SPI.
    /// Transfers scanline-by-scanline to limit SRAM buffer requirements.
    pub fn flush(&mut self, fb: &Framebuffer) {
        self.set_address_window();
        self.write_cmd(cmd::RAMWR);

        // Transfer in scanlines — each scanline is 480 pixels × 2 bytes = 960 bytes
        self.dc.set_high();
        self.cs.set_low();

        // We send the framebuffer in chunks to avoid needing a huge byte buffer.
        // Each pixel is already u16 big-endian in the framebuffer.
        const LINE_PIXELS: usize = WIDTH as usize;
        let mut line_buf = [0u8; LINE_PIXELS * 2];

        for y in 0..HEIGHT as usize {
            let start = y * LINE_PIXELS;
            let end = start + LINE_PIXELS;
            for (i, &px) in fb.pixels[start..end].iter().enumerate() {
                // ST7796 expects big-endian RGB565
                line_buf[i * 2] = (px >> 8) as u8;
                line_buf[i * 2 + 1] = (px & 0xFF) as u8;
            }
            let _ = self.spi.blocking_write(&line_buf);
        }

        self.cs.set_high();
    }
}
