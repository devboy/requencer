//! Requencer WASM target — browser integration.
//!
//! Provides Canvas2D framebuffer DrawTarget implementation and
//! wasm-bindgen bindings for the JS/TS web preview.
//!
//! WASM is the single source of truth — Rust owns engine, renderer, and mode machine.
//! JS only handles I/O glue (clock, audio, MIDI, keyboard, panel).

use wasm_bindgen::prelude::*;

use embedded_graphics_core::{
    draw_target::DrawTarget,
    geometry::{OriginDimensions, Size},
    pixelcolor::Rgb565,
    Pixel,
};
use requencer_engine::sequencer::tick as engine_tick;
use requencer_engine::types::{ClockSource, SequencerState};
use requencer_renderer::{
    layout,
    types::{ScreenMode, UiState},
};

// ── Canvas2D Framebuffer DrawTarget ─────────────────────────────────

/// A pixel framebuffer that implements `DrawTarget<Color = Rgb565>`.
/// After rendering, the buffer can be flushed to an HTML Canvas via ImageData.
struct Framebuffer {
    /// RGBA pixel data, row-major, 4 bytes per pixel.
    data: Vec<u8>,
    width: u32,
    height: u32,
}

impl Framebuffer {
    fn new(width: u32, height: u32) -> Self {
        let size = (width * height * 4) as usize;
        Self {
            data: vec![0u8; size],
            width,
            height,
        }
    }

    fn set_pixel(&mut self, x: u32, y: u32, color: Rgb565) {
        if x >= self.width || y >= self.height {
            return;
        }
        let (r, g, b) = rgb565_to_rgb888(color);
        let offset = ((y * self.width + x) * 4) as usize;
        self.data[offset] = r;
        self.data[offset + 1] = g;
        self.data[offset + 2] = b;
        self.data[offset + 3] = 255;
    }
}

impl OriginDimensions for Framebuffer {
    fn size(&self) -> Size {
        Size::new(self.width, self.height)
    }
}

impl DrawTarget for Framebuffer {
    type Color = Rgb565;
    type Error = core::convert::Infallible;

    fn draw_iter<I>(&mut self, pixels: I) -> Result<(), Self::Error>
    where
        I: IntoIterator<Item = Pixel<Self::Color>>,
    {
        for Pixel(coord, color) in pixels {
            if coord.x >= 0
                && coord.y >= 0
                && (coord.x as u32) < self.width
                && (coord.y as u32) < self.height
            {
                self.set_pixel(coord.x as u32, coord.y as u32, color);
            }
        }
        Ok(())
    }
}

/// Convert Rgb565 to (R8, G8, B8).
fn rgb565_to_rgb888(c: Rgb565) -> (u8, u8, u8) {
    use embedded_graphics_core::pixelcolor::RgbColor;
    let r5 = c.r();
    let g6 = c.g();
    let b5 = c.b();
    let r = (r5 << 3) | (r5 >> 2);
    let g = (g6 << 2) | (g6 >> 4);
    let b = (b5 << 3) | (b5 >> 2);
    (r, g, b)
}

// ── WASM-Bindgen API ────────────────────────────────────────────────

/// The main sequencer instance exposed to JavaScript.
#[wasm_bindgen]
pub struct WasmSequencer {
    state: SequencerState,
    ui: UiState,
    framebuffer: Framebuffer,
    system_tick: u32,
}

#[wasm_bindgen]
impl WasmSequencer {
    /// Create a new sequencer instance.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            state: {
                let mut s = SequencerState::new();
                s.apply_default_presets();
                s
            },
            ui: UiState::default(),
            framebuffer: Framebuffer::new(layout::LCD_W, layout::LCD_H),
            system_tick: 0,
        }
    }

    // ── Rendering ───────────────────────────────────────────────────

    /// Get display width.
    pub fn width(&self) -> u32 {
        layout::LCD_W
    }

    /// Get display height.
    pub fn height(&self) -> u32 {
        layout::LCD_H
    }

    /// Render the current state to the internal framebuffer and return RGBA pixel data.
    pub fn render(&mut self) -> Vec<u8> {
        requencer_renderer::render(&mut self.framebuffer, &self.state, &self.ui);
        self.framebuffer.data.clone()
    }

    /// Render into the internal framebuffer without copying.
    pub fn render_in_place(&mut self) {
        requencer_renderer::render(&mut self.framebuffer, &self.state, &self.ui);
    }

    /// Pointer to the internal RGBA framebuffer (for zero-copy JS access via WASM memory).
    pub fn buffer_ptr(&self) -> *const u8 {
        self.framebuffer.data.as_ptr()
    }

    /// Length of the RGBA framebuffer in bytes.
    pub fn buffer_len(&self) -> usize {
        self.framebuffer.data.len()
    }

    // ── Transport ───────────────────────────────────────────────────

    /// Set BPM.
    pub fn set_bpm(&mut self, bpm: u16) {
        self.state.transport.bpm = bpm.clamp(20, 300);
    }

    /// Get BPM.
    pub fn get_bpm(&self) -> u16 {
        self.state.transport.bpm
    }

    /// Set playing state.
    pub fn set_playing(&mut self, playing: bool) {
        self.state.transport.playing = playing;
    }

    /// Check if playing.
    pub fn is_playing(&self) -> bool {
        self.state.transport.playing
    }

    /// Set clock source (0=internal, 1=midi, 2=external).
    pub fn set_clock_source(&mut self, source: u8) {
        self.state.transport.clock_source = match source {
            1 => ClockSource::Midi,
            2 => ClockSource::External,
            _ => ClockSource::Internal,
        };
    }

    /// Get clock source as u8 (0=internal, 1=midi, 2=external).
    pub fn get_clock_source(&self) -> u8 {
        match self.state.transport.clock_source {
            ClockSource::Internal => 0,
            ClockSource::Midi => 1,
            ClockSource::External => 2,
        }
    }

    // ── Playhead ────────────────────────────────────────────────────

    /// Reset all playheads to 0.
    pub fn reset_playheads(&mut self) {
        self.state.reset_playheads();
    }

    /// Get master tick count.
    pub fn get_master_tick(&self) -> u32 {
        self.state.transport.master_tick as u32
    }

    // ── Tick / NoteEvent ────────────────────────────────────────────

    /// Advance sequencer by one tick. Returns a flat f32 array of 4 events.
    /// Each event = 12 floats: [valid, output, gate, pitch, velocity,
    ///   modulation, mod_slew, gate_length, ratchet_count, slide, retrigger, sustain]
    pub fn tick(&mut self) -> Vec<f32> {
        let events = engine_tick(&mut self.state);
        let mut out = Vec::with_capacity(48);
        for event in &events {
            match event {
                Some(e) => {
                    out.push(1.0); // valid
                    out.push(e.output as f32);
                    out.push(if e.gate { 1.0 } else { 0.0 });
                    out.push(e.pitch as f32);
                    out.push(e.velocity as f32);
                    out.push(e.modulation as f32);
                    out.push(e.mod_slew);
                    out.push(e.gate_length);
                    out.push(e.ratchet_count as f32);
                    out.push(e.slide);
                    out.push(if e.retrigger { 1.0 } else { 0.0 });
                    out.push(if e.sustain { 1.0 } else { 0.0 });
                }
                None => {
                    out.push(0.0); // not valid
                    out.extend(core::iter::repeat_n(0.0, 11));
                }
            }
        }
        out
    }

    // ── Mode Machine API ─────────────────────────────────────────────

    /// Set the system tick for CLR timeout tracking.
    pub fn set_system_tick(&mut self, tick: u32) {
        self.system_tick = tick;
    }

    /// Dispatch a control event through the Rust mode machine.
    ///
    /// Event type mapping:
    ///  0 = EncoderATurn(delta=param1)
    ///  1 = EncoderAPush
    ///  2 = EncoderBTurn(delta=param1)
    ///  3 = EncoderBPush
    ///  4 = Back
    ///  5 = PlayStop
    ///  6 = Reset
    ///  7 = TrackSelect(track=param1)
    ///  8 = SubtrackSelect(subtrack=param1: 0=gate,1=pitch,2=vel,3=mod)
    ///  9 = FeaturePress(feature=param1: 0=mute,1=route,2=rand,3=mutate,4=xpose,5=var)
    /// 10 = StepPress(step=param1)
    /// 11 = HoldStart(kind=param1: 0=track(param2),1=subtrack(param2),2=feature(param2),3=step(param2))
    /// 12 = HoldEnd
    /// 13 = SettingsPress
    /// 14 = ClrPress
    /// 15 = PatternPress
    pub fn handle_event(&mut self, event_type: u8, param1: i32, param2: i32) {
        use requencer_engine::input::ControlEvent;
        use requencer_engine::ui_types::{Feature, HeldButton, UiSubtrack};

        let event = match event_type {
            0 => ControlEvent::EncoderATurn { delta: param1 },
            1 => ControlEvent::EncoderAPush,
            2 => ControlEvent::EncoderBTurn { delta: param1 },
            3 => ControlEvent::EncoderBPush,
            4 => ControlEvent::Back,
            5 => ControlEvent::PlayStop,
            6 => ControlEvent::Reset,
            7 => ControlEvent::TrackSelect { track: param1 as u8 },
            8 => {
                let sub = match param1 {
                    0 => UiSubtrack::Gate,
                    1 => UiSubtrack::Pitch,
                    2 => UiSubtrack::Velocity,
                    3 => UiSubtrack::Mod,
                    _ => return,
                };
                ControlEvent::SubtrackSelect { subtrack: sub }
            }
            9 => {
                let feature = match param1 {
                    0 => Feature::Mute,
                    1 => Feature::Route,
                    2 => Feature::Rand,
                    3 => Feature::Mutate,
                    4 => Feature::Transpose,
                    5 => Feature::Variation,
                    _ => return,
                };
                ControlEvent::FeaturePress { feature }
            }
            10 => ControlEvent::StepPress { step: param1 as u8 },
            11 => {
                let button = match param1 {
                    0 => HeldButton::Track(param2 as u8),
                    1 => {
                        let sub = match param2 {
                            0 => UiSubtrack::Gate,
                            1 => UiSubtrack::Pitch,
                            2 => UiSubtrack::Velocity,
                            3 => UiSubtrack::Mod,
                            _ => return,
                        };
                        HeldButton::Subtrack(sub)
                    }
                    2 => {
                        let feature = match param2 {
                            0 => Feature::Mute,
                            1 => Feature::Route,
                            2 => Feature::Rand,
                            3 => Feature::Mutate,
                            4 => Feature::Transpose,
                            5 => Feature::Variation,
                            _ => return,
                        };
                        HeldButton::Feature(feature)
                    }
                    3 => HeldButton::Step(param2 as u8),
                    _ => return,
                };
                ControlEvent::HoldStart { button }
            }
            12 => ControlEvent::HoldEnd,
            13 => ControlEvent::SettingsPress,
            14 => ControlEvent::ClrPress,
            15 => ControlEvent::PatternPress,
            _ => return,
        };

        requencer_engine::mode_machine::dispatch(
            &mut self.ui,
            &mut self.state,
            event,
            self.system_tick,
        );
    }

    /// Get LED state as a flat array: [step0..step15, track0..track3, play].
    /// Values: 0=Off, 1=On, 2=Dim, 3=Flash.
    pub fn get_led_state(&self) -> Vec<u8> {
        use requencer_engine::ui_types::LedMode;
        let leds = requencer_engine::mode_machine::get_led_state(&self.ui, &self.state);
        let mut out = Vec::with_capacity(21);
        for s in &leds.steps {
            out.push(match s {
                LedMode::Off => 0,
                LedMode::On => 1,
                LedMode::Dim => 2,
                LedMode::Flash => 3,
            });
        }
        for &t in &leds.tracks {
            out.push(if t { 1 } else { 0 });
        }
        out.push(match leds.play {
            LedMode::Off => 0,
            LedMode::On => 1,
            LedMode::Dim => 2,
            LedMode::Flash => 3,
        });
        out
    }

    /// Get the current screen mode as u8 (from mode machine state).
    pub fn get_mode(&self) -> u8 {
        match self.ui.mode {
            ScreenMode::Home => 0,
            ScreenMode::GateEdit => 1,
            ScreenMode::PitchEdit => 2,
            ScreenMode::VelEdit => 3,
            ScreenMode::ModEdit => 4,
            ScreenMode::MuteEdit => 5,
            ScreenMode::Route => 6,
            ScreenMode::Rand => 7,
            ScreenMode::MutateEdit => 8,
            ScreenMode::TransposeEdit => 9,
            ScreenMode::VariationEdit => 10,
            ScreenMode::Settings => 11,
            ScreenMode::Pattern => 12,
            ScreenMode::PatternLoad => 13,
            ScreenMode::NameEntry => 14,
        }
    }

    /// Get selected track (from mode machine state).
    pub fn get_selected_track(&self) -> u8 {
        self.ui.selected_track
    }

    /// Check CLR timeout and cancel pending if expired.
    pub fn check_clr_timeout(&mut self) {
        requencer_engine::mode_machine::check_clr_timeout(&mut self.ui, self.system_tick);
    }

    /// Whether CLR confirm is pending (first press waiting for second).
    pub fn get_clr_pending(&self) -> bool {
        self.ui.clr_pending
    }

    /// Get MIDI enabled state.
    pub fn get_midi_enabled(&self) -> bool {
        self.state.midi_enabled
    }

    /// Get MIDI clock out state.
    pub fn get_midi_clock_out(&self) -> bool {
        self.state.midi_clock_out
    }

    /// Get MIDI channel for an output (1-16).
    pub fn get_midi_channel(&self, output: u8) -> u8 {
        self.state.midi_configs[output.min(3) as usize].channel
    }

    // ── Persistence ────────────────────────────────────────────────

    /// Export full sequencer state as serialized bytes.
    pub fn export_state(&self) -> Vec<u8> {
        let mut buf = vec![0u8; requencer_engine::storage::STATE_BUF_SIZE];
        match requencer_engine::storage::serialize_state(&self.state, &mut buf) {
            Ok(bytes) => bytes.to_vec(),
            Err(_) => Vec::new(),
        }
    }

    /// Import sequencer state from serialized bytes. Returns true on success.
    pub fn import_state(&mut self, data: &[u8]) -> bool {
        match requencer_engine::storage::deserialize_state(data) {
            Ok(mut state) => {
                // Reset ephemeral state
                state.transport.playing = false;
                state.transport.master_tick = 0;
                state.lfo_runtimes = core::array::from_fn(|_| {
                    requencer_engine::types::LfoRuntime::default()
                });
                state.reset_playheads();
                self.state = state;
                true
            }
            Err(_) => false,
        }
    }

    /// Export saved patterns and user presets as serialized bytes.
    pub fn export_library(&self) -> Vec<u8> {
        let mut buf = vec![0u8; requencer_engine::storage::LIBRARY_BUF_SIZE];
        match requencer_engine::storage::serialize_library(
            &self.state.saved_patterns,
            &self.state.user_presets,
            &mut buf,
        ) {
            Ok(bytes) => bytes.to_vec(),
            Err(_) => Vec::new(),
        }
    }

    /// Import saved patterns and user presets from serialized bytes. Returns true on success.
    pub fn import_library(&mut self, data: &[u8]) -> bool {
        match requencer_engine::storage::deserialize_library(data) {
            Ok((patterns, presets)) => {
                self.state.saved_patterns = patterns;
                self.state.user_presets = presets;
                true
            }
            Err(_) => false,
        }
    }
}

impl Default for WasmSequencer {
    fn default() -> Self {
        Self::new()
    }
}
