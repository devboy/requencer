//! ST7796 480×320 TFT display driver via SPI0.
//!
//! Uses the `mipidsi` crate which provides DrawTarget<Rgb565> implementation.
//! The display shares SPI0 with the SD card — never access both simultaneously.
//! Uses blocking SPI for compatibility with mipidsi's synchronous API.

use display_interface_spi::SPIInterface;
use embassy_rp::gpio::Output;
use embassy_rp::spi::Spi;
use embedded_hal_bus::spi::ExclusiveDevice;
use mipidsi::models::ST7796;
use mipidsi::options::{ColorInversion, ColorOrder, Orientation, Rotation};

/// Type alias for the configured ST7796 display (no reset pin managed by mipidsi).
pub type Display<'d> = mipidsi::Display<
    SPIInterface<
        ExclusiveDevice<
            Spi<'d, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
            Output<'d>,
            embedded_hal_bus::spi::NoDelay,
        >,
        Output<'d>,
    >,
    ST7796,
    mipidsi::NoResetPin,
>;

/// Initialize the ST7796 display.
///
/// Reset is handled manually before calling this function.
/// Returns a `mipidsi::Display` which implements `DrawTarget<Color = Rgb565>`.
pub fn init<'d>(
    spi: Spi<'d, embassy_rp::peripherals::SPI0, embassy_rp::spi::Blocking>,
    dc: Output<'d>,
    cs: Output<'d>,
    mut delay: embassy_time::Delay,
) -> Display<'d> {
    let spi_device = ExclusiveDevice::new_no_delay(spi, cs).unwrap();
    let spi_iface = SPIInterface::new(spi_device, dc);

    mipidsi::Builder::new(ST7796, spi_iface)
        .display_size(crate::pins::LCD_WIDTH, crate::pins::LCD_HEIGHT)
        .orientation(Orientation::new().rotate(Rotation::Deg90))
        .color_order(ColorOrder::Bgr)
        .invert_colors(ColorInversion::Normal)
        .init(&mut delay)
        .expect("display init failed")
}

/// Set backlight brightness via PWM (0-100%).
pub fn set_backlight(
    pwm: &mut embassy_rp::pwm::Pwm<'_>,
    percent: u8,
) {
    let percent = percent.min(100);
    let mut config = embassy_rp::pwm::Config::default();
    config.top = 1000;
    config.compare_b = (percent as u16) * 10;
    pwm.set_config(&config);
}
