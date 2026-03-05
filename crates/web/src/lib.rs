//! Requencer WASM target — browser integration.
//!
//! Provides Canvas2D framebuffer DrawTarget implementation and
//! wasm-bindgen bindings for the JS/TS web preview.

use wasm_bindgen::prelude::*;

use embedded_graphics_core::{
    draw_target::DrawTarget,
    geometry::{OriginDimensions, Size},
    pixelcolor::Rgb565,
    Pixel,
};
use requencer_engine::types::SequencerState;
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
}

#[wasm_bindgen]
impl WasmSequencer {
    /// Create a new sequencer instance.
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            state: SequencerState::new(),
            ui: UiState::default(),
            framebuffer: Framebuffer::new(layout::LCD_W, layout::LCD_H),
        }
    }

    /// Get display width.
    pub fn width(&self) -> u32 {
        layout::LCD_W
    }

    /// Get display height.
    pub fn height(&self) -> u32 {
        layout::LCD_H
    }

    /// Render the current state to the internal framebuffer and return RGBA pixel data.
    /// Note: this clones the buffer. For zero-copy, use render_to_ptr() + buffer_ptr().
    pub fn render(&mut self) -> Vec<u8> {
        requencer_renderer::render(&mut self.framebuffer, &self.state, &self.ui);
        self.framebuffer.data.clone()
    }

    /// Render into the internal framebuffer without copying.
    /// After calling this, read pixels via buffer_ptr() + buffer_len().
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

    // ── UI Navigation ───────────────────────────────────────────────

    /// Set the current screen mode (0=Home, 1=GateEdit, etc.).
    pub fn set_screen(&mut self, mode: u8) {
        self.ui.mode = match mode {
            0 => ScreenMode::Home,
            1 => ScreenMode::GateEdit,
            2 => ScreenMode::PitchEdit,
            3 => ScreenMode::VelEdit,
            4 => ScreenMode::ModEdit,
            5 => ScreenMode::MuteEdit,
            6 => ScreenMode::Route,
            7 => ScreenMode::Rand,
            8 => ScreenMode::MutateEdit,
            9 => ScreenMode::TransposeEdit,
            10 => ScreenMode::VariationEdit,
            11 => ScreenMode::Settings,
            12 => ScreenMode::Pattern,
            13 => ScreenMode::PatternLoad,
            14 => ScreenMode::NameEntry,
            _ => ScreenMode::Home,
        };
    }

    /// Get current screen mode as u8.
    pub fn get_screen(&self) -> u8 {
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

    /// Set selected track (0-3).
    pub fn set_selected_track(&mut self, track: u8) {
        self.ui.selected_track = track.min(3);
    }

    /// Set selected step (0-15).
    pub fn set_selected_step(&mut self, step: u8) {
        self.ui.selected_step = step.min(15);
    }

    /// Set current page (0-based).
    pub fn set_current_page(&mut self, page: u8) {
        self.ui.current_page = page;
    }

    /// Set the rand screen parameter cursor.
    pub fn set_rand_param(&mut self, param: u8) {
        self.ui.rand_param = param;
    }

    /// Set the route screen parameter cursor.
    pub fn set_route_param(&mut self, param: u8) {
        self.ui.route_param = param;
    }

    /// Set the mutate screen parameter cursor.
    pub fn set_mutate_param(&mut self, param: u8) {
        self.ui.mutate_param = param;
    }

    /// Set the transpose screen parameter cursor.
    pub fn set_xpose_param(&mut self, param: u8) {
        self.ui.xpose_param = param;
    }

    /// Set the settings screen parameter cursor.
    pub fn set_settings_param(&mut self, param: u8) {
        self.ui.settings_param = param;
    }

    /// Toggle MOD/LFO view.
    pub fn toggle_mod_lfo_view(&mut self) {
        self.ui.mod_lfo_view = !self.ui.mod_lfo_view;
    }

    // ── Step Editing ────────────────────────────────────────────────

    /// Toggle gate on/off for a step.
    pub fn toggle_gate(&mut self, track: u8, step: u8) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].gate.steps.len() {
            self.state.tracks[t].gate.steps[s].on = !self.state.tracks[t].gate.steps[s].on;
        }
    }

    /// Set pitch note for a step.
    pub fn set_pitch_note(&mut self, track: u8, step: u8, note: u8) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].pitch.steps.len() {
            self.state.tracks[t].pitch.steps[s].note = note.min(127);
        }
    }

    /// Set velocity for a step.
    pub fn set_velocity(&mut self, track: u8, step: u8, vel: u8) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].velocity.steps.len() {
            self.state.tracks[t].velocity.steps[s] = vel.min(127);
        }
    }

    /// Set gate length for a step (0.0-1.0).
    pub fn set_gate_length(&mut self, track: u8, step: u8, length: f32) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].gate.steps.len() {
            self.state.tracks[t].gate.steps[s].length = length.clamp(0.0, 1.0);
        }
    }

    /// Set ratchet count for a step (1-4).
    pub fn set_ratchet(&mut self, track: u8, step: u8, count: u8) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].gate.steps.len() {
            self.state.tracks[t].gate.steps[s].ratchet = count.clamp(1, 4);
        }
    }

    /// Toggle tie for a step.
    pub fn toggle_tie(&mut self, track: u8, step: u8) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].gate.steps.len() {
            self.state.tracks[t].gate.steps[s].tie = !self.state.tracks[t].gate.steps[s].tie;
        }
    }

    /// Set slide for a step.
    pub fn set_slide(&mut self, track: u8, step: u8, slide: f32) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].pitch.steps.len() {
            self.state.tracks[t].pitch.steps[s].slide = slide.clamp(0.0, 0.5);
        }
    }

    /// Set mod value for a step.
    pub fn set_mod_value(&mut self, track: u8, step: u8, value: f32) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].modulation.steps.len() {
            self.state.tracks[t].modulation.steps[s].value = value.clamp(0.0, 1.0);
        }
    }

    /// Set mod slew for a step.
    pub fn set_mod_slew(&mut self, track: u8, step: u8, slew: f32) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].modulation.steps.len() {
            self.state.tracks[t].modulation.steps[s].slew = slew.clamp(0.0, 1.0);
        }
    }

    /// Toggle mute for a step.
    pub fn toggle_mute(&mut self, track: u8, step: u8) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.mute_patterns[t].steps.len() {
            self.state.mute_patterns[t].steps[s] = !self.state.mute_patterns[t].steps[s];
        }
    }

    // ── Subtrack Length / Divider ────────────────────────────────────

    /// Set subtrack length. subtrack: 0=gate, 1=pitch, 2=vel, 3=mod.
    pub fn set_subtrack_length(&mut self, track: u8, subtrack: u8, length: u8) {
        let t = track.min(3) as usize;
        let len = length.clamp(1, 16);
        match subtrack {
            0 => self.state.tracks[t].gate.length = len,
            1 => self.state.tracks[t].pitch.length = len,
            2 => self.state.tracks[t].velocity.length = len,
            3 => self.state.tracks[t].modulation.length = len,
            _ => {}
        }
    }

    /// Set subtrack clock divider. subtrack: 0=gate, 1=pitch, 2=vel, 3=mod.
    pub fn set_subtrack_divider(&mut self, track: u8, subtrack: u8, div: u8) {
        let t = track.min(3) as usize;
        let d = div.clamp(1, 32);
        match subtrack {
            0 => self.state.tracks[t].gate.clock_divider = d,
            1 => self.state.tracks[t].pitch.clock_divider = d,
            2 => self.state.tracks[t].velocity.clock_divider = d,
            3 => self.state.tracks[t].modulation.clock_divider = d,
            _ => {}
        }
    }

    /// Set track-level clock divider.
    pub fn set_track_divider(&mut self, track: u8, div: u8) {
        let t = track.min(3) as usize;
        self.state.tracks[t].clock_divider = div.clamp(1, 32);
    }

    // ── Routing ─────────────────────────────────────────────────────

    /// Set output gate source track.
    pub fn set_route_gate(&mut self, output: u8, source_track: u8) {
        let o = output.min(3) as usize;
        self.state.routing[o].gate = source_track.min(3);
    }

    /// Set output pitch source track.
    pub fn set_route_pitch(&mut self, output: u8, source_track: u8) {
        let o = output.min(3) as usize;
        self.state.routing[o].pitch = source_track.min(3);
    }

    /// Set output velocity source track.
    pub fn set_route_velocity(&mut self, output: u8, source_track: u8) {
        let o = output.min(3) as usize;
        self.state.routing[o].velocity = source_track.min(3);
    }

    /// Set output modulation source track.
    pub fn set_route_mod(&mut self, output: u8, source_track: u8) {
        let o = output.min(3) as usize;
        self.state.routing[o].modulation = source_track.min(3);
    }

    /// Set mod source (0=seq, 1=lfo) for an output.
    pub fn set_mod_source(&mut self, output: u8, source: u8) {
        let o = output.min(3) as usize;
        self.state.routing[o].mod_source = if source == 0 {
            requencer_engine::types::ModSource::Seq
        } else {
            requencer_engine::types::ModSource::Lfo
        };
    }

    // ── Playhead ────────────────────────────────────────────────────

    /// Advance the playhead for a specific subtrack (for tick sync from JS clock).
    pub fn set_playhead(&mut self, track: u8, subtrack: u8, step: u8) {
        let t = track.min(3) as usize;
        match subtrack {
            0 => self.state.tracks[t].gate.current_step = step,
            1 => self.state.tracks[t].pitch.current_step = step,
            2 => self.state.tracks[t].velocity.current_step = step,
            3 => self.state.tracks[t].modulation.current_step = step,
            _ => {}
        }
    }

    /// Reset all playheads to 0.
    pub fn reset_playheads(&mut self) {
        for t in 0..4 {
            self.state.tracks[t].gate.current_step = 0;
            self.state.tracks[t].pitch.current_step = 0;
            self.state.tracks[t].velocity.current_step = 0;
            self.state.tracks[t].modulation.current_step = 0;
            self.state.mute_patterns[t].current_step = 0;
        }
    }
}

impl Default for WasmSequencer {
    fn default() -> Self {
        Self::new()
    }
}
