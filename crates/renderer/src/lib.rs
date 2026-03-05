#![cfg_attr(not(any(feature = "std", test)), no_std)]

//! Requencer renderer — platform-agnostic display rendering.
//!
//! Uses `embedded-graphics` DrawTarget abstraction to render
//! the sequencer UI to any display backend (Canvas2D via WASM,
//! ST7796 TFT via SPI on RP2350).

use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::types::SequencerState;

pub mod colors;
pub mod draw;
pub mod layout;
pub mod screens;
pub mod types;

use types::{ScreenMode, UiState};

/// Render the full display: status bar + current screen.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    // Clear display
    draw::fill_screen(display, colors::BG);

    // Status bar
    let status_left = match ui.mode {
        ScreenMode::Home => "HOME",
        ScreenMode::GateEdit => "GATE",
        ScreenMode::PitchEdit => "PITCH",
        ScreenMode::VelEdit => "VEL",
        ScreenMode::ModEdit => {
            if ui.mod_lfo_view { "LFO" } else { "MOD" }
        }
        ScreenMode::MuteEdit => "MUTE",
        ScreenMode::Route => "ROUTE",
        ScreenMode::Rand => "RAND",
        ScreenMode::MutateEdit => "DRIFT",
        ScreenMode::TransposeEdit => "XPOSE",
        ScreenMode::VariationEdit => "VAR",
        ScreenMode::Settings => "SETTINGS",
        ScreenMode::Pattern => "PATTERN",
        ScreenMode::PatternLoad => "LOAD",
        ScreenMode::NameEntry => "NAME",
    };
    draw::status_bar(display, status_left, state.transport.bpm, state.transport.playing);

    // Screen content
    match ui.mode {
        ScreenMode::Home => screens::home::render(display, state, ui),
        ScreenMode::GateEdit => screens::gate_edit::render(display, state, ui),
        ScreenMode::PitchEdit => screens::pitch_edit::render(display, state, ui),
        ScreenMode::VelEdit => screens::vel_edit::render(display, state, ui),
        ScreenMode::ModEdit => screens::mod_edit::render(display, state, ui),
        ScreenMode::MuteEdit => screens::mute_edit::render(display, state, ui),
        ScreenMode::Route => screens::route::render(display, state, ui),
        ScreenMode::Rand => screens::rand::render(display, state, ui),
        ScreenMode::MutateEdit => screens::mutate_edit::render(display, state, ui),
        ScreenMode::TransposeEdit => screens::transpose_edit::render(display, state, ui),
        ScreenMode::VariationEdit => screens::variation_edit::render(display, state, ui),
        ScreenMode::Settings => screens::settings::render(display, state, ui),
        ScreenMode::Pattern => screens::pattern::render(display, state, ui),
        ScreenMode::PatternLoad => screens::pattern_load::render(display, state, ui),
        ScreenMode::NameEntry => screens::name_entry::render(display, state, ui),
    }

    // Flash message overlay
    if let Some(msg) = ui.flash_message {
        if ui.mode != ScreenMode::NameEntry {
            let msg_y = layout::LCD_H as i32 - layout::EDIT_FOOTER_H as i32 - 30;
            draw::fill_rect(display, 40, msg_y, layout::LCD_W - 80, 24, colors::STATUS_BAR);
            draw::text_center(
                display,
                layout::LCD_W as i32 / 2,
                msg_y + 7,
                msg,
                colors::TEXT_BRIGHT,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use embedded_graphics_core::{
        draw_target::DrawTarget,
        geometry::{OriginDimensions, Size},
        Pixel,
    };

    /// Null display that counts pixels drawn but discards them.
    struct NullDisplay {
        pixel_count: usize,
    }

    impl NullDisplay {
        fn new() -> Self {
            Self { pixel_count: 0 }
        }
    }

    impl OriginDimensions for NullDisplay {
        fn size(&self) -> Size {
            Size::new(layout::LCD_W, layout::LCD_H)
        }
    }

    impl DrawTarget for NullDisplay {
        type Color = Rgb565;
        type Error = core::convert::Infallible;

        fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
        where
            I: IntoIterator<Item = Pixel<Self::Color>>,
        {
            for _ in pixels {
                self.pixel_count += 1;
            }
            Ok(())
        }
    }

    #[test]
    fn render_all_screens_no_panic() {
        let state = SequencerState::new();

        let modes = [
            ScreenMode::Home,
            ScreenMode::GateEdit,
            ScreenMode::PitchEdit,
            ScreenMode::VelEdit,
            ScreenMode::ModEdit,
            ScreenMode::MuteEdit,
            ScreenMode::Route,
            ScreenMode::Rand,
            ScreenMode::MutateEdit,
            ScreenMode::TransposeEdit,
            ScreenMode::VariationEdit,
            ScreenMode::Settings,
            ScreenMode::Pattern,
            ScreenMode::PatternLoad,
            ScreenMode::NameEntry,
        ];

        for mode in &modes {
            let mut display = NullDisplay::new();
            let ui = UiState {
                mode: *mode,
                ..UiState::default()
            };
            render(&mut display, &state, &ui);
            assert!(display.pixel_count > 0, "Screen {:?} drew no pixels", mode);
        }
    }

    #[test]
    fn render_with_flash_message() {
        let state = SequencerState::new();
        let mut display = NullDisplay::new();
        let ui = UiState {
            flash_message: Some("SAVED"),
            ..UiState::default()
        };
        render(&mut display, &state, &ui);
        assert!(display.pixel_count > 0);
    }

    #[test]
    fn render_mod_lfo_view() {
        let state = SequencerState::new();
        let mut display = NullDisplay::new();
        let ui = UiState {
            mode: ScreenMode::ModEdit,
            mod_lfo_view: true,
            ..UiState::default()
        };
        render(&mut display, &state, &ui);
        assert!(display.pixel_count > 0);
    }

    #[test]
    fn render_each_track_selected() {
        let state = SequencerState::new();
        for track in 0..4u8 {
            let mut display = NullDisplay::new();
            let ui = UiState {
                selected_track: track,
                ..UiState::default()
            };
            render(&mut display, &state, &ui);
            assert!(display.pixel_count > 0);
        }
    }
}
