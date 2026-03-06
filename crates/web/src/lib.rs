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
use requencer_engine::sequencer::tick as engine_tick;
use requencer_engine::types::{
    ArpDirection, ClockSource, GateAlgo, LfoSyncMode, LfoWaveform, ModMode,
    MutateTrigger, PitchArpDirection, PitchMode, SequencerState, TransformType, VelocityMode,
};
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

    /// Set gate on/off for a step (non-toggling).
    pub fn set_gate_on(&mut self, track: u8, step: u8, on: bool) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].gate.steps.len() {
            self.state.tracks[t].gate.steps[s].on = on;
        }
    }

    /// Set gate tie for a step (non-toggling).
    pub fn set_gate_tie(&mut self, track: u8, step: u8, tie: bool) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.tracks[t].gate.steps.len() {
            self.state.tracks[t].gate.steps[s].tie = tie;
        }
    }

    /// Set mute on/off for a step (non-toggling).
    pub fn set_mute_step(&mut self, track: u8, step: u8, muted: bool) {
        let t = track.min(3) as usize;
        let s = step as usize;
        if s < self.state.mute_patterns[t].steps.len() {
            self.state.mute_patterns[t].steps[s] = muted;
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
        self.state.reset_playheads();
    }

    /// Get master tick count.
    pub fn get_master_tick(&self) -> u32 {
        self.state.transport.master_tick as u32
    }

    /// Set clock source (0=internal, 1=midi, 2=external).
    pub fn set_clock_source(&mut self, source: u8) {
        self.state.transport.clock_source = match source {
            1 => ClockSource::Midi,
            2 => ClockSource::External,
            _ => ClockSource::Internal,
        };
    }

    // ── Tick / NoteEvent ────────────────────────────────────────────

    /// Advance sequencer by one tick. Returns a flat f32 array of 4 events.
    /// Each event = 12 floats: [valid, output, gate, pitch, velocity,
    ///   modulation, mod_slew, gate_length, ratchet_count, slide, retrigger, sustain]
    /// valid=0 means None (between step boundaries), valid=1 means Some.
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

    // ── Randomization ───────────────────────────────────────────────

    /// Randomize all subtracks of a track.
    pub fn randomize_full_track(&mut self, track: u8, seed: u32) {
        self.state.randomize_full_track(track.min(3) as usize, seed);
    }

    /// Randomize gate pattern only.
    pub fn randomize_gate(&mut self, track: u8, seed: u32) {
        self.state.randomize_gate(track.min(3) as usize, seed);
    }

    /// Randomize pitch pattern only.
    pub fn randomize_pitch(&mut self, track: u8, seed: u32) {
        self.state.randomize_pitch(track.min(3) as usize, seed);
    }

    /// Randomize velocity pattern only.
    pub fn randomize_velocity(&mut self, track: u8, seed: u32) {
        self.state.randomize_velocity(track.min(3) as usize, seed);
    }

    /// Randomize mod pattern only.
    pub fn randomize_mod(&mut self, track: u8, seed: u32) {
        self.state.randomize_mod(track.min(3) as usize, seed);
    }

    // ── Clear ───────────────────────────────────────────────────────

    /// Clear all steps in a track to defaults.
    pub fn clear_track_to_defaults(&mut self, track: u8) {
        self.state.clear_track_to_defaults(track.min(3) as usize);
    }

    /// Clear gate steps on page.
    pub fn clear_gate_steps_on_page(&mut self, track: u8, page: u8) {
        self.state.clear_gate_steps_on_page(track.min(3) as usize, page as usize);
    }

    /// Clear pitch steps on page.
    pub fn clear_pitch_steps_on_page(&mut self, track: u8, page: u8) {
        self.state.clear_pitch_steps_on_page(track.min(3) as usize, page as usize);
    }

    /// Clear velocity steps on page.
    pub fn clear_vel_steps_on_page(&mut self, track: u8, page: u8) {
        self.state.clear_vel_steps_on_page(track.min(3) as usize, page as usize);
    }

    /// Clear mod steps on page.
    pub fn clear_mod_steps_on_page(&mut self, track: u8, page: u8) {
        self.state.clear_mod_steps_on_page(track.min(3) as usize, page as usize);
    }

    /// Clear mute steps on page.
    pub fn clear_mute_steps_on_page(&mut self, track: u8, page: u8) {
        self.state.clear_mute_steps_on_page(track.min(3) as usize, page as usize);
    }

    // ── Tie ─────────────────────────────────────────────────────────

    /// Set tie range from one step to another.
    pub fn set_tie_range(&mut self, track: u8, from: u8, to: u8) {
        self.state.set_tie_range(track.min(3) as usize, from as usize, to as usize);
    }

    // ── Mute ────────────────────────────────────────────────────────

    /// Set mute pattern length.
    pub fn set_mute_length(&mut self, track: u8, length: u8) {
        self.state.set_mute_length(track.min(3) as usize, length);
    }

    /// Set mute clock divider.
    pub fn set_mute_divider(&mut self, track: u8, div: u8) {
        self.state.set_mute_clock_divider(track.min(3) as usize, div);
    }

    // ── LFO Config ──────────────────────────────────────────────────

    /// Set LFO waveform (0=sine, 1=tri, 2=saw, 3=square, 4=slew-random, 5=s+h).
    pub fn set_lfo_waveform(&mut self, track: u8, waveform: u8) {
        let t = track.min(3) as usize;
        self.state.lfo_configs[t].waveform = match waveform {
            1 => LfoWaveform::Triangle,
            2 => LfoWaveform::Saw,
            3 => LfoWaveform::Square,
            4 => LfoWaveform::SlewRandom,
            5 => LfoWaveform::SampleAndHold,
            _ => LfoWaveform::Sine,
        };
    }

    /// Set LFO sync mode (0=track, 1=free).
    pub fn set_lfo_sync_mode(&mut self, track: u8, mode: u8) {
        let t = track.min(3) as usize;
        self.state.lfo_configs[t].sync_mode = if mode == 1 {
            LfoSyncMode::Free
        } else {
            LfoSyncMode::Track
        };
    }

    /// Set LFO rate (synced, steps per cycle).
    pub fn set_lfo_rate(&mut self, track: u8, rate: u8) {
        self.state.lfo_configs[track.min(3) as usize].rate = rate.clamp(1, 64);
    }

    /// Set LFO free rate in Hz.
    pub fn set_lfo_free_rate(&mut self, track: u8, rate: f32) {
        self.state.lfo_configs[track.min(3) as usize].free_rate = rate.clamp(0.05, 20.0);
    }

    /// Set LFO depth (0.0-1.0).
    pub fn set_lfo_depth(&mut self, track: u8, depth: f32) {
        self.state.lfo_configs[track.min(3) as usize].depth = depth.clamp(0.0, 1.0);
    }

    /// Set LFO offset (0.0-1.0).
    pub fn set_lfo_offset(&mut self, track: u8, offset: f32) {
        self.state.lfo_configs[track.min(3) as usize].offset = offset.clamp(0.0, 1.0);
    }

    /// Set LFO width/skew (0.0-1.0).
    pub fn set_lfo_width(&mut self, track: u8, width: f32) {
        self.state.lfo_configs[track.min(3) as usize].width = width.clamp(0.0, 1.0);
    }

    /// Set LFO phase offset (0.0-1.0).
    pub fn set_lfo_phase(&mut self, track: u8, phase: f32) {
        self.state.lfo_configs[track.min(3) as usize].phase = phase.clamp(0.0, 1.0);
    }

    // ── Transpose Config ────────────────────────────────────────────

    /// Set transpose semitones (-48 to +48).
    pub fn set_transpose_semitones(&mut self, track: u8, semitones: i8) {
        self.state.transpose_configs[track.min(3) as usize].semitones = semitones.clamp(-48, 48);
    }

    /// Set transpose note low/high bounds.
    pub fn set_transpose_range(&mut self, track: u8, low: u8, high: u8) {
        let t = track.min(3) as usize;
        self.state.transpose_configs[t].note_low = low.min(127);
        self.state.transpose_configs[t].note_high = high.min(127);
    }

    /// Set gate length scale (0.25-4.0).
    pub fn set_transpose_gl_scale(&mut self, track: u8, scale: f32) {
        self.state.transpose_configs[track.min(3) as usize].gl_scale = scale.clamp(0.25, 4.0);
    }

    /// Set velocity scale (0.25-4.0).
    pub fn set_transpose_vel_scale(&mut self, track: u8, scale: f32) {
        self.state.transpose_configs[track.min(3) as usize].vel_scale = scale.clamp(0.25, 4.0);
    }

    // ── Mutate Config ───────────────────────────────────────────────

    /// Set mutate trigger mode (0=loop, 1=bars).
    pub fn set_mutate_trigger(&mut self, track: u8, trigger: u8) {
        self.state.mutate_configs[track.min(3) as usize].trigger = if trigger == 1 {
            MutateTrigger::Bars
        } else {
            MutateTrigger::Loop
        };
    }

    /// Set mutate bars interval (1, 2, 4, 8, 16).
    pub fn set_mutate_bars(&mut self, track: u8, bars: u8) {
        self.state.mutate_configs[track.min(3) as usize].bars = bars;
    }

    /// Set mutate drift rates (gate, pitch, velocity, modulation as 0.0-1.0).
    pub fn set_mutate_rates(&mut self, track: u8, gate: f32, pitch: f32, vel: f32, modulation: f32) {
        let t = track.min(3) as usize;
        self.state.mutate_configs[t].gate = gate.clamp(0.0, 1.0);
        self.state.mutate_configs[t].pitch = pitch.clamp(0.0, 1.0);
        self.state.mutate_configs[t].velocity = vel.clamp(0.0, 1.0);
        self.state.mutate_configs[t].modulation = modulation.clamp(0.0, 1.0);
    }

    // ── Arp Config ──────────────────────────────────────────────────

    /// Set arpeggiator enabled/disabled.
    pub fn set_arp_enabled(&mut self, track: u8, enabled: bool) {
        self.state.arp_configs[track.min(3) as usize].enabled = enabled;
    }

    /// Set arpeggiator direction (0=up, 1=down, 2=triangle, 3=random).
    pub fn set_arp_direction(&mut self, track: u8, direction: u8) {
        self.state.arp_configs[track.min(3) as usize].direction = match direction {
            1 => ArpDirection::Down,
            2 => ArpDirection::Triangle,
            3 => ArpDirection::Random,
            _ => ArpDirection::Up,
        };
    }

    /// Set arpeggiator octave range (1-4).
    pub fn set_arp_octave_range(&mut self, track: u8, range: u8) {
        self.state.arp_configs[track.min(3) as usize].octave_range = range.clamp(1, 4);
    }

    // ── Variation Config ────────────────────────────────────────────

    /// Enable/disable variation for a track.
    pub fn set_variation_enabled(&mut self, track: u8, enabled: bool) {
        self.state.variation_patterns[track.min(3) as usize].enabled = enabled;
    }

    /// Set variation phrase length (bars).
    pub fn set_variation_length(&mut self, track: u8, length: u8) {
        self.state.variation_patterns[track.min(3) as usize].length = length.clamp(1, 16);
    }

    /// Set variation loop mode.
    pub fn set_variation_loop(&mut self, track: u8, loop_mode: bool) {
        self.state.variation_patterns[track.min(3) as usize].loop_mode = loop_mode;
    }

    /// Add a transform to a variation bar slot.
    /// transform_type: 0-25 maps to TransformType enum order.
    pub fn add_variation_transform(&mut self, track: u8, bar: u8, transform_type: u8, param: i32) {
        let t = track.min(3) as usize;
        let b = bar as usize;
        if b < self.state.variation_patterns[t].slots.len() {
            let tt = u8_to_transform_type(transform_type);
            let _ = self.state.variation_patterns[t].slots[b]
                .transforms
                .push(requencer_engine::types::Transform {
                    transform_type: tt,
                    param,
                });
        }
    }

    /// Remove a transform from a variation bar slot by index.
    pub fn remove_variation_transform(&mut self, track: u8, bar: u8, index: u8) {
        let t = track.min(3) as usize;
        let b = bar as usize;
        if b < self.state.variation_patterns[t].slots.len() {
            let i = index as usize;
            if i < self.state.variation_patterns[t].slots[b].transforms.len() {
                self.state.variation_patterns[t].slots[b].transforms.remove(i);
            }
        }
    }

    // ── Random Config ───────────────────────────────────────────────

    /// Set pitch config for randomizer.
    pub fn set_rand_pitch(&mut self, track: u8, low: u8, high: u8, root: u8, max_notes: u8, mode: u8) {
        let t = track.min(3) as usize;
        self.state.random_configs[t].pitch.low = low;
        self.state.random_configs[t].pitch.high = high;
        self.state.random_configs[t].pitch.root = root;
        self.state.random_configs[t].pitch.max_notes = max_notes;
        self.state.random_configs[t].pitch.mode = match mode {
            1 => PitchMode::Arp,
            2 => PitchMode::Walk,
            3 => PitchMode::Rise,
            4 => PitchMode::Fall,
            _ => PitchMode::Random,
        };
    }

    /// Set pitch arp direction for randomizer.
    pub fn set_rand_pitch_arp_direction(&mut self, track: u8, direction: u8) {
        self.state.random_configs[track.min(3) as usize].pitch.arp_direction = match direction {
            1 => PitchArpDirection::Down,
            2 => PitchArpDirection::UpDown,
            3 => PitchArpDirection::Random,
            _ => PitchArpDirection::Up,
        };
    }

    /// Set gate config for randomizer.
    pub fn set_rand_gate(&mut self, track: u8, fill_min: f32, fill_max: f32, mode: u8, random_offset: bool, cluster_cont: f32) {
        let t = track.min(3) as usize;
        self.state.random_configs[t].gate.fill_min = fill_min;
        self.state.random_configs[t].gate.fill_max = fill_max;
        self.state.random_configs[t].gate.mode = match mode {
            1 => GateAlgo::Euclidean,
            2 => GateAlgo::Sync,
            3 => GateAlgo::Cluster,
            _ => GateAlgo::Random,
        };
        self.state.random_configs[t].gate.random_offset = random_offset;
        self.state.random_configs[t].gate.cluster_continuation = cluster_cont;
    }

    /// Set velocity config for randomizer.
    pub fn set_rand_velocity(&mut self, track: u8, low: u8, high: u8, mode: u8) {
        let t = track.min(3) as usize;
        self.state.random_configs[t].velocity.low = low;
        self.state.random_configs[t].velocity.high = high;
        self.state.random_configs[t].velocity.mode = match mode {
            1 => VelocityMode::Accent,
            2 => VelocityMode::Sync,
            3 => VelocityMode::Rise,
            4 => VelocityMode::Fall,
            5 => VelocityMode::Walk,
            _ => VelocityMode::Random,
        };
    }

    /// Set gate length config for randomizer.
    pub fn set_rand_gate_length(&mut self, track: u8, min: f32, max: f32) {
        let t = track.min(3) as usize;
        self.state.random_configs[t].gate_length.min = min;
        self.state.random_configs[t].gate_length.max = max;
    }

    /// Set ratchet config for randomizer.
    pub fn set_rand_ratchet(&mut self, track: u8, max_ratchet: u8, probability: f32) {
        let t = track.min(3) as usize;
        self.state.random_configs[t].ratchet.max_ratchet = max_ratchet;
        self.state.random_configs[t].ratchet.probability = probability;
    }

    /// Set slide probability for randomizer.
    pub fn set_rand_slide(&mut self, track: u8, probability: f32) {
        self.state.random_configs[track.min(3) as usize].slide.probability = probability;
    }

    /// Set mod config for randomizer.
    #[allow(clippy::too_many_arguments)]
    pub fn set_rand_mod(&mut self, track: u8, low: f32, high: f32, mode: u8, slew: f32, slew_prob: f32, walk_step: f32, sync_bias: f32) {
        let t = track.min(3) as usize;
        self.state.random_configs[t].modulation.low = low;
        self.state.random_configs[t].modulation.high = high;
        self.state.random_configs[t].modulation.mode = match mode {
            1 => ModMode::Rise,
            2 => ModMode::Fall,
            3 => ModMode::Vee,
            4 => ModMode::Hill,
            5 => ModMode::Sync,
            6 => ModMode::Walk,
            _ => ModMode::Random,
        };
        self.state.random_configs[t].modulation.slew = slew;
        self.state.random_configs[t].modulation.slew_probability = slew_prob;
        self.state.random_configs[t].modulation.walk_step_size = walk_step;
        self.state.random_configs[t].modulation.sync_bias = sync_bias;
    }

    /// Set tie config for randomizer.
    pub fn set_rand_tie(&mut self, track: u8, probability: f32, max_length: u8) {
        let t = track.min(3) as usize;
        self.state.random_configs[t].tie.probability = probability;
        self.state.random_configs[t].tie.max_length = max_length;
    }

    // ── Presets ──────────────────────────────────────────────────────

    /// Apply factory default presets to all tracks.
    pub fn apply_default_presets(&mut self) {
        self.state.apply_default_presets();
    }

    /// Get number of user presets.
    pub fn user_preset_count(&self) -> u32 {
        self.state.user_presets.len() as u32
    }

    /// Delete a user preset by index.
    pub fn delete_user_preset(&mut self, index: u32) {
        self.state.delete_user_preset(index as usize);
    }

    /// Apply a user preset's random config to a track.
    pub fn apply_user_preset(&mut self, preset_index: u32, track: u8) {
        let i = preset_index as usize;
        if i < self.state.user_presets.len() {
            self.state.random_configs[track.min(3) as usize] =
                self.state.user_presets[i].config.clone();
        }
    }

    /// Save a user preset from a track's current random config.
    pub fn save_user_preset_from_track(&mut self, track: u8, name: &str) {
        let config = self.state.random_configs[track.min(3) as usize].clone();
        self.state.save_user_preset(name, config);
    }

    // ── Patterns ────────────────────────────────────────────────────

    /// Get number of saved patterns.
    pub fn saved_pattern_count(&self) -> u32 {
        self.state.saved_patterns.len() as u32
    }

    /// Save current track as a named pattern.
    pub fn save_pattern(&mut self, track: u8, name: &str) {
        let pattern = requencer_engine::patterns::create_saved_pattern(
            &self.state,
            track.min(3) as usize,
            name,
        );
        requencer_engine::patterns::save_pattern(&mut self.state, pattern);
    }

    /// Delete a saved pattern by index.
    pub fn delete_pattern(&mut self, index: u32) {
        requencer_engine::patterns::delete_pattern(&mut self.state, index as usize);
    }

    /// Load a saved pattern into a target track (all layers).
    pub fn load_pattern(&mut self, pattern_index: u32, target_track: u8) {
        let i = pattern_index as usize;
        if i < self.state.saved_patterns.len() {
            let slot = self.state.saved_patterns[i].data.clone();
            let layers = requencer_engine::types::LayerFlags::default();
            requencer_engine::patterns::restore_track_slot(
                &mut self.state,
                target_track.min(3) as usize,
                &slot,
                &layers,
            );
        }
    }

    /// Load a saved pattern with specific layer flags.
    #[allow(clippy::too_many_arguments)]
    pub fn load_pattern_layers(
        &mut self,
        pattern_index: u32,
        target_track: u8,
        gate: bool,
        pitch: bool,
        vel: bool,
        modulation: bool,
        transpose: bool,
        drift: bool,
        variation: bool,
    ) {
        let i = pattern_index as usize;
        if i < self.state.saved_patterns.len() {
            let slot = self.state.saved_patterns[i].data.clone();
            let layers = requencer_engine::types::LayerFlags {
                gate,
                pitch,
                velocity: vel,
                modulation,
                transpose,
                drift,
                variation,
            };
            requencer_engine::patterns::restore_track_slot(
                &mut self.state,
                target_track.min(3) as usize,
                &slot,
                &layers,
            );
        }
    }

    // ── MIDI Config ─────────────────────────────────────────────────

    /// Set MIDI enabled.
    pub fn set_midi_enabled(&mut self, enabled: bool) {
        self.state.midi_enabled = enabled;
    }

    /// Set MIDI clock out.
    pub fn set_midi_clock_out(&mut self, enabled: bool) {
        self.state.midi_clock_out = enabled;
    }

    /// Set MIDI channel for an output (1-16).
    pub fn set_midi_channel(&mut self, output: u8, channel: u8) {
        let o = output.min(3) as usize;
        self.state.midi_configs[o].channel = channel.clamp(1, 16);
    }

    // ── State Getters (for TS sync) ─────────────────────────────────

    /// Get gate step data as flat array: [on, tie, length, ratchet] × 16 steps.
    pub fn get_gate_steps(&self, track: u8) -> Vec<f32> {
        let t = track.min(3) as usize;
        let mut out = Vec::with_capacity(64);
        for step in self.state.tracks[t].gate.steps.iter() {
            out.push(if step.on { 1.0 } else { 0.0 });
            out.push(if step.tie { 1.0 } else { 0.0 });
            out.push(step.length);
            out.push(step.ratchet as f32);
        }
        out
    }

    /// Get pitch step data as flat array: [note, slide] × 16.
    pub fn get_pitch_steps(&self, track: u8) -> Vec<f32> {
        let t = track.min(3) as usize;
        let mut out = Vec::with_capacity(32);
        for step in self.state.tracks[t].pitch.steps.iter() {
            out.push(step.note as f32);
            out.push(step.slide);
        }
        out
    }

    /// Get velocity steps as flat array.
    pub fn get_velocity_steps(&self, track: u8) -> Vec<f32> {
        let t = track.min(3) as usize;
        self.state.tracks[t]
            .velocity
            .steps
            .iter()
            .map(|&v| v as f32)
            .collect()
    }

    /// Get mod step data as flat array: [value, slew] × 16.
    pub fn get_mod_steps(&self, track: u8) -> Vec<f32> {
        let t = track.min(3) as usize;
        let mut out = Vec::with_capacity(32);
        for step in self.state.tracks[t].modulation.steps.iter() {
            out.push(step.value);
            out.push(step.slew);
        }
        out
    }

    /// Get subtrack lengths as [gate_len, pitch_len, vel_len, mod_len].
    pub fn get_subtrack_lengths(&self, track: u8) -> Vec<u8> {
        let t = track.min(3) as usize;
        vec![
            self.state.tracks[t].gate.length,
            self.state.tracks[t].pitch.length,
            self.state.tracks[t].velocity.length,
            self.state.tracks[t].modulation.length,
        ]
    }

    /// Get subtrack dividers as [gate_div, pitch_div, vel_div, mod_div].
    pub fn get_subtrack_dividers(&self, track: u8) -> Vec<u8> {
        let t = track.min(3) as usize;
        vec![
            self.state.tracks[t].gate.clock_divider,
            self.state.tracks[t].pitch.clock_divider,
            self.state.tracks[t].velocity.clock_divider,
            self.state.tracks[t].modulation.clock_divider,
        ]
    }

    /// Get mute pattern as flat bool array (as u8: 0/1).
    pub fn get_mute_pattern(&self, track: u8) -> Vec<u8> {
        let t = track.min(3) as usize;
        self.state.mute_patterns[t]
            .steps
            .iter()
            .map(|&m| if m { 1 } else { 0 })
            .collect()
    }

    /// Get playhead positions: [gate, pitch, vel, mod] current_step for a track.
    pub fn get_playheads(&self, track: u8) -> Vec<u8> {
        let t = track.min(3) as usize;
        vec![
            self.state.tracks[t].gate.current_step,
            self.state.tracks[t].pitch.current_step,
            self.state.tracks[t].velocity.current_step,
            self.state.tracks[t].modulation.current_step,
        ]
    }

    /// Set flash message for UI overlay.
    pub fn set_flash_message(&mut self, msg: &str) {
        self.ui.flash_message = None; // Clear — actual flash is managed from JS
        // For the Rust renderer, we store a static str reference.
        // Since WASM strings are transient, we use a small static buffer.
        if !msg.is_empty() {
            // Map common flash messages to static strings
            self.ui.flash_message = match msg {
                "SAVED" => Some("SAVED"),
                "LOADED" => Some("LOADED"),
                "DELETED" => Some("DELETED"),
                "CLEARED" => Some("CLEARED"),
                "COPIED" => Some("COPIED"),
                _ => None,
            };
        }
    }

    // ── Variation UI state ──────────────────────────────────────────

    /// Set variation selected bar (-1 = overview mode).
    pub fn set_var_selected_bar(&mut self, bar: i8) {
        self.ui.var_selected_bar = bar;
    }

    /// Set variation cursor position.
    pub fn set_var_cursor(&mut self, cursor: u8) {
        self.ui.var_cursor = cursor;
    }

    // ── Name entry UI state ─────────────────────────────────────────

    /// Set name entry cursor position.
    pub fn set_name_cursor(&mut self, pos: u8) {
        self.ui.name_cursor = pos;
    }

    /// Set name entry character at position.
    pub fn set_name_char(&mut self, pos: u8, ch: u8) {
        if (pos as usize) < self.ui.name_chars.len() {
            self.ui.name_chars[pos as usize] = ch;
        }
    }

    /// Set name entry length.
    pub fn set_name_len(&mut self, len: u8) {
        self.ui.name_len = len;
    }

    /// Set name entry context (true=pattern, false=preset).
    pub fn set_name_context(&mut self, pattern: bool) {
        self.ui.pattern_context = pattern;
    }

    /// Set MOD/LFO view directly.
    pub fn set_mod_lfo_view(&mut self, lfo: bool) {
        self.ui.mod_lfo_view = lfo;
    }

    /// Set settings scroll position.
    pub fn set_settings_scroll(&mut self, scroll: u8) {
        self.ui.settings_param = scroll;
    }
}

/// Map u8 to TransformType enum.
fn u8_to_transform_type(v: u8) -> TransformType {
    match v {
        0 => TransformType::Reverse,
        1 => TransformType::PingPong,
        2 => TransformType::Rotate,
        3 => TransformType::DoubleTime,
        4 => TransformType::Stutter,
        5 => TransformType::HalfTime,
        6 => TransformType::Skip,
        7 => TransformType::DrunkWalk,
        8 => TransformType::Scramble,
        9 => TransformType::Thin,
        10 => TransformType::Fill,
        11 => TransformType::SkipEven,
        12 => TransformType::SkipOdd,
        13 => TransformType::InvertGates,
        14 => TransformType::Densify,
        15 => TransformType::Drop,
        16 => TransformType::Ratchet,
        17 => TransformType::Transpose,
        18 => TransformType::Invert,
        19 => TransformType::OctaveShift,
        20 => TransformType::Fold,
        21 => TransformType::Quantize,
        22 => TransformType::Accent,
        23 => TransformType::FadeIn,
        24 => TransformType::FadeOut,
        25 => TransformType::Humanize,
        _ => TransformType::Reverse,
    }
}

impl Default for WasmSequencer {
    fn default() -> Self {
        Self::new()
    }
}
