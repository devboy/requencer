//! Mode machine — maps (UiState, SequencerState, ControlEvent) → mutated state.
//!
//! This is the Rust port of `web/src/ui/mode-machine.ts`.
//! Pure logic, no platform dependencies. Shared by firmware and WASM.

#![allow(clippy::too_many_lines)]

use crate::input::ControlEvent;
use crate::math::{clamp, roundf};
use crate::presets;
use crate::sequencer::SubtrackId;
use crate::types::{
    ArpDirection, ClockSource, GateAlgo, LayerFlags, LfoSyncMode, LfoWaveform,
    MutateTrigger, ModMode, ModSource, PitchArpDirection, PitchMode,
    SequencerState, TransformType, VariationSlot, VelocityMode,
};
use crate::ui_types::{
    Feature, HeldButton, LedMode, LedState, NameEntryContext, ScreenMode, UiState, UiSubtrack,
};
use crate::MAX_STEPS;

/// Name entry charset: A-Z, space, 0-9, dash (37 chars).
pub const NAME_CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789-";
const NAME_MAX_LEN: usize = 12;

/// LFO waveform cycle order.
const LFO_WAVEFORMS: [LfoWaveform; 6] = [
    LfoWaveform::Sine,
    LfoWaveform::Triangle,
    LfoWaveform::Saw,
    LfoWaveform::Square,
    LfoWaveform::SlewRandom,
    LfoWaveform::SampleAndHold,
];

const LFO_PARAM_COUNT: i32 = 7;
const MUTATE_PARAM_COUNT: i32 = 6;

/// Bar options for mutate config.
const BAR_OPTIONS: [u8; 5] = [1, 2, 4, 8, 16];

// ── Helpers ──────────────────────────────────────────────────────────

fn clamp_i32(v: i32, lo: i32, hi: i32) -> i32 {
    if v < lo { lo } else if v > hi { hi } else { v }
}

fn clamp_u8(v: i32, lo: u8, hi: u8) -> u8 {
    clamp_i32(v, lo as i32, hi as i32) as u8
}

fn wrap(v: i32, n: i32) -> i32 {
    ((v % n) + n) % n
}

/// Round f32 to 2 decimal places.
fn round2(v: f32) -> f32 {
    roundf(v * 100.0) / 100.0
}

fn clamp_round(v: f32, lo: f32, hi: f32) -> f32 {
    round2(clamp(v, lo, hi))
}

fn subtrack_to_id(s: UiSubtrack) -> SubtrackId {
    match s {
        UiSubtrack::Gate => SubtrackId::Gate,
        UiSubtrack::Pitch => SubtrackId::Pitch,
        UiSubtrack::Velocity => SubtrackId::Velocity,
        UiSubtrack::Mod => SubtrackId::Mod,
    }
}

// ── Main dispatch ────────────────────────────────────────────────────

/// Process a control event, mutating UI and engine state in place.
pub fn dispatch(
    ui: &mut UiState,
    engine: &mut SequencerState,
    event: ControlEvent,
    system_tick: u32,
) {
    // --- Hold events ---
    match event {
        ControlEvent::HoldStart { button } => {
            // Step hold in gate-edit: select step for GL/ratchet editing
            if let HeldButton::Step(step) = button {
                if ui.mode == ScreenMode::GateEdit {
                    ui.held_button = Some(button);
                    ui.hold_encoder_used = false;
                    ui.selected_step = step as i8;
                    return;
                }
            }
            // Only feature buttons with hold combos (mute, variation) get hold state
            if let HeldButton::Feature(f) = button {
                if f != Feature::Mute && f != Feature::Variation {
                    return;
                }
            }
            ui.held_button = Some(button);
            ui.hold_encoder_used = false;
            return;
        }
        ControlEvent::HoldEnd => {
            let clear_step = matches!(ui.held_button, Some(HeldButton::Step(_)));
            ui.held_button = None;
            ui.hold_encoder_used = false;
            if clear_step {
                ui.selected_step = -1;
            }
            return;
        }
        _ => {}
    }

    // --- Hold combo: step held in gate-edit + step press → tie range ---
    if let Some(HeldButton::Step(_)) = ui.held_button {
        if ui.mode == ScreenMode::GateEdit {
            if let ControlEvent::StepPress { step } = event {
                dispatch_step_tie(ui, engine, step);
                return;
            }
        }
    }

    // --- Hold combo: step held in gate-edit → encoder A = gate length, encoder B = ratchet ---
    if let Some(HeldButton::Step(_)) = ui.held_button {
        if ui.mode == ScreenMode::GateEdit {
            match event {
                ControlEvent::EncoderATurn { delta } | ControlEvent::EncoderBTurn { delta } => {
                    dispatch_step_hold_combo(ui, engine, &event, delta);
                    return;
                }
                _ => {}
            }
        }
    }

    // --- Hold combo: encoder turns while button held → length/division ---
    if ui.held_button.is_some() {
        match event {
            ControlEvent::EncoderATurn { delta } | ControlEvent::EncoderBTurn { delta } => {
                dispatch_hold_combo(ui, engine, &event, delta);
                return;
            }
            _ => {}
        }
    }

    // --- Hold combo: RESET while button held → targeted playhead reset ---
    if ui.held_button.is_some() && event == ControlEvent::Reset {
        dispatch_hold_reset(ui, engine);
        return;
    }

    // --- Hold combo: RAND while button held → targeted randomization ---
    if ui.held_button.is_some() {
        if let ControlEvent::FeaturePress { feature: Feature::Rand } = event {
            dispatch_hold_rand(ui, engine, system_tick);
            return;
        }
    }

    // --- Name entry mode: isolates all input ---
    if ui.mode == ScreenMode::NameEntry {
        dispatch_name_entry(ui, engine, event);
        return;
    }

    // --- Global events (work in every mode) ---

    if event == ControlEvent::PlayStop {
        engine.transport.playing = !engine.transport.playing;
        return;
    }

    if event == ControlEvent::Reset {
        engine.reset_playheads();
        return;
    }

    // --- Pattern-load mode intercepts (before cross-modal handlers) ---
    if ui.mode == ScreenMode::PatternLoad {
        match event {
            ControlEvent::TrackSelect { track } => {
                ui.pattern_load_target = track;
                return;
            }
            ControlEvent::SubtrackSelect { subtrack } => {
                match subtrack {
                    UiSubtrack::Gate => ui.pattern_layer_flags.gate = !ui.pattern_layer_flags.gate,
                    UiSubtrack::Pitch => ui.pattern_layer_flags.pitch = !ui.pattern_layer_flags.pitch,
                    UiSubtrack::Velocity => ui.pattern_layer_flags.velocity = !ui.pattern_layer_flags.velocity,
                    UiSubtrack::Mod => ui.pattern_layer_flags.modulation = !ui.pattern_layer_flags.modulation,
                }
                return;
            }
            ControlEvent::FeaturePress { feature } => {
                match feature {
                    Feature::Mutate => ui.pattern_layer_flags.drift = !ui.pattern_layer_flags.drift,
                    Feature::Transpose => ui.pattern_layer_flags.transpose = !ui.pattern_layer_flags.transpose,
                    Feature::Variation => ui.pattern_layer_flags.variation = !ui.pattern_layer_flags.variation,
                    _ => {}
                }
                return;
            }
            ControlEvent::SettingsPress
            | ControlEvent::ClrPress
            | ControlEvent::StepPress { .. }
            | ControlEvent::PatternPress => return,
            _ => {} // fall through to cross-modal
        }
    }

    // Track select — cross-modal
    if let ControlEvent::TrackSelect { track } = event {
        ui.selected_track = track;
        ui.current_page = 0;
        ui.selected_step = 0;
        ui.rand_dropdown_open = false;
        return;
    }

    // Subtrack buttons — in variation-edit: enter/exit subtrack sub-screen
    if let ControlEvent::SubtrackSelect { subtrack } = event {
        if ui.mode == ScreenMode::VariationEdit {
            if ui.var_edit_subtrack == Some(subtrack) {
                ui.var_edit_subtrack = None;
                ui.var_selected_bar = -1;
                ui.var_cursor = 0;
                ui.var_catalog_open = false;
            } else {
                ui.var_edit_subtrack = Some(subtrack);
                ui.var_selected_bar = -1;
                ui.var_cursor = 0;
                ui.var_catalog_open = false;
            }
            return;
        }

        // Subtrack buttons — enter edit screen
        let new_mode = match subtrack {
            UiSubtrack::Gate => ScreenMode::GateEdit,
            UiSubtrack::Pitch => ScreenMode::PitchEdit,
            UiSubtrack::Velocity => ScreenMode::VelEdit,
            UiSubtrack::Mod => ScreenMode::ModEdit,
        };
        let step = if new_mode == ScreenMode::GateEdit { -1 } else { 0 };
        ui.mode = new_mode;
        ui.selected_step = step;
        ui.current_page = 0;
        return;
    }

    // Back — in variation-edit with subtrack editing: return to track-level first
    if event == ControlEvent::Back && ui.mode == ScreenMode::VariationEdit && ui.var_edit_subtrack.is_some() {
        ui.var_edit_subtrack = None;
        ui.var_selected_bar = -1;
        ui.var_cursor = 0;
        ui.var_catalog_open = false;
        return;
    }

    // Back — pattern-load: return to pattern screen
    if event == ControlEvent::Back && ui.mode == ScreenMode::PatternLoad {
        ui.mode = ScreenMode::Pattern;
        return;
    }

    // Back — cross-modal navigation to home
    if event == ControlEvent::Back {
        ui.mode = ScreenMode::Home;
        ui.current_page = 0;
        ui.rand_dropdown_open = false;
        return;
    }

    // Feature buttons — enter feature screen
    if let ControlEvent::FeaturePress { feature } = event {
        ui.mode = match feature {
            Feature::Mute => ScreenMode::MuteEdit,
            Feature::Route => ScreenMode::Route,
            Feature::Rand => ScreenMode::Rand,
            Feature::Mutate => ScreenMode::MutateEdit,
            Feature::Transpose => ScreenMode::TransposeEdit,
            Feature::Variation => ScreenMode::VariationEdit,
        };
        ui.selected_step = 0;
        ui.current_page = 0;
        ui.var_selected_bar = -1;
        ui.var_cursor = 0;
        ui.var_catalog_open = false;
        ui.var_edit_subtrack = None;
        return;
    }

    if event == ControlEvent::SettingsPress {
        ui.mode = ScreenMode::Settings;
        ui.settings_param = 0;
        return;
    }

    // --- CLR button dispatch ---
    if event == ControlEvent::ClrPress {
        dispatch_clr(ui, engine, system_tick);
        return;
    }

    // Cancel CLR pending on any other event
    if ui.clr_pending {
        ui.clr_pending = false;
        ui.clr_pending_tick = 0;
    }

    if event == ControlEvent::PatternPress {
        ui.mode = ScreenMode::Pattern;
        ui.pattern_param = 0;
        ui.pattern_index = 0;
        return;
    }

    // --- Mode-specific dispatch ---
    match ui.mode {
        ScreenMode::Home => dispatch_home(ui, engine, event),
        ScreenMode::GateEdit => dispatch_gate_edit(ui, engine, event),
        ScreenMode::PitchEdit => dispatch_pitch_edit(ui, engine, event),
        ScreenMode::VelEdit => dispatch_vel_edit(ui, engine, event),
        ScreenMode::MuteEdit => dispatch_mute_edit(ui, engine, event),
        ScreenMode::ModEdit => dispatch_mod_edit(ui, engine, event),
        ScreenMode::Rand => dispatch_rand(ui, engine, event, system_tick),
        ScreenMode::Route => dispatch_route(ui, engine, event),
        ScreenMode::MutateEdit => dispatch_mutate_edit(ui, engine, event),
        ScreenMode::TransposeEdit => dispatch_transpose_edit(ui, engine, event),
        ScreenMode::VariationEdit => dispatch_variation_edit(ui, engine, event),
        ScreenMode::Settings => dispatch_settings(ui, engine, event),
        ScreenMode::Pattern => dispatch_pattern(ui, engine, event),
        ScreenMode::PatternLoad => dispatch_pattern_load(ui, engine, event),
        ScreenMode::NameEntry => {} // handled above
    }
}

// ── Home Screen ──────────────────────────────────────────────────────

fn dispatch_home(ui: &mut UiState, _engine: &mut SequencerState, event: ControlEvent) {
    match event {
        ControlEvent::EncoderATurn { delta } => {
            ui.selected_track = wrap(ui.selected_track as i32 - delta, 4) as u8;
        }
        ControlEvent::EncoderAPush => {
            ui.mode = ScreenMode::GateEdit;
            ui.selected_step = 0;
            ui.current_page = 0;
        }
        _ => {}
    }
}

// ── Gate Edit ────────────────────────────────────────────────────────

fn dispatch_gate_edit(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let t = ui.selected_track as usize;
    let gate_len = engine.tracks[t].gate.length;
    let max_page = if gate_len > 16 { (gate_len - 1) / 16 } else { 0 };

    match event {
        ControlEvent::StepPress { step } => {
            let idx = ui.current_page as usize * 16 + step as usize;
            if idx >= gate_len as usize { return; }
            let cur = engine.tracks[t].gate.steps[idx].on;
            engine.set_gate_on(t, idx, !cur);
        }
        ControlEvent::EncoderBTurn { delta } => {
            ui.current_page = clamp_u8(ui.current_page as i32 + delta, 0, max_page);
        }
        _ => {}
    }
}

// ── Pitch Edit ───────────────────────────────────────────────────────

fn dispatch_pitch_edit(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let t = ui.selected_track as usize;
    let pitch_len = engine.tracks[t].pitch.length;
    let max_page = if pitch_len > 16 { (pitch_len - 1) / 16 } else { 0 };

    match event {
        ControlEvent::StepPress { step } => {
            let idx = ui.current_page as usize * 16 + step as usize;
            if idx >= pitch_len as usize { return; }
            ui.selected_step = step as i8;
        }
        ControlEvent::EncoderATurn { delta } => {
            let idx = ui.current_page as usize * 16 + ui.selected_step.max(0) as usize;
            if idx >= pitch_len as usize { return; }
            let cur = engine.tracks[t].pitch.steps[idx].note;
            engine.set_pitch_note(t, idx, clamp_u8(cur as i32 + delta, 0, 127));
        }
        ControlEvent::EncoderBTurn { delta } => {
            // Slide duration for selected step
            let idx = ui.current_page as usize * 16 + ui.selected_step.max(0) as usize;
            if idx >= pitch_len as usize { return; }
            let cur = engine.tracks[t].pitch.steps[idx].slide;
            let next = clamp_round(cur + delta as f32 * 0.05, 0.0, 0.5);
            engine.set_slide(t, idx, next);
        }
        ControlEvent::EncoderAPush => {
            ui.current_page = (ui.current_page + 1) % (max_page + 1);
        }
        _ => {}
    }
}

// ── Velocity Edit ────────────────────────────────────────────────────

fn dispatch_vel_edit(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let t = ui.selected_track as usize;
    let vel_len = engine.tracks[t].velocity.length;
    let max_page = if vel_len > 16 { (vel_len - 1) / 16 } else { 0 };

    match event {
        ControlEvent::StepPress { step } => {
            let idx = ui.current_page as usize * 16 + step as usize;
            if idx >= vel_len as usize { return; }
            ui.selected_step = step as i8;
        }
        ControlEvent::EncoderATurn { delta } => {
            let idx = ui.current_page as usize * 16 + ui.selected_step.max(0) as usize;
            if idx >= vel_len as usize { return; }
            let cur = engine.tracks[t].velocity.steps[idx] as i32;
            engine.set_velocity(t, idx, clamp_u8(cur + delta, 0, 127));
        }
        ControlEvent::EncoderBTurn { delta } => {
            ui.current_page = clamp_u8(ui.current_page as i32 + delta, 0, max_page);
        }
        _ => {}
    }
}

// ── Mute Edit ────────────────────────────────────────────────────────

fn dispatch_mute_edit(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let t = ui.selected_track as usize;
    let mute_len = engine.mute_patterns[t].length;
    let max_page = if mute_len > 16 { (mute_len - 1) / 16 } else { 0 };

    match event {
        ControlEvent::StepPress { step } => {
            let idx = ui.current_page as usize * 16 + step as usize;
            if idx >= mute_len as usize { return; }
            let cur = engine.mute_patterns[t].steps[idx];
            engine.set_mute_step(t, idx, !cur);
        }
        ControlEvent::EncoderBTurn { delta } => {
            ui.current_page = clamp_u8(ui.current_page as i32 + delta, 0, max_page);
        }
        _ => {}
    }
}

// ── MOD Edit ─────────────────────────────────────────────────────────

fn dispatch_mod_edit(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    if event == ControlEvent::EncoderAPush {
        ui.mod_lfo_view = !ui.mod_lfo_view;
        return;
    }

    if ui.mod_lfo_view {
        dispatch_mod_lfo(ui, engine, event);
    } else {
        dispatch_mod_seq(ui, engine, event);
    }
}

fn dispatch_mod_seq(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let t = ui.selected_track as usize;
    let mod_len = engine.tracks[t].modulation.length;
    let max_page = if mod_len > 16 { (mod_len - 1) / 16 } else { 0 };

    match event {
        ControlEvent::StepPress { step } => {
            let idx = ui.current_page as usize * 16 + step as usize;
            if idx >= mod_len as usize { return; }
            ui.selected_step = step as i8;
        }
        ControlEvent::EncoderATurn { delta } => {
            let idx = ui.current_page as usize * 16 + ui.selected_step.max(0) as usize;
            if idx >= mod_len as usize { return; }
            let cur = engine.tracks[t].modulation.steps[idx].value;
            let next = clamp_round(cur + delta as f32 * 0.01, 0.0, 1.0);
            let slew = engine.tracks[t].modulation.steps[idx].slew;
            engine.set_mod_step(t, idx, next, slew);
        }
        ControlEvent::EncoderBTurn { delta } => {
            // If a step is being held, adjust its slew
            if let Some(HeldButton::Step(held_step)) = ui.held_button {
                let idx = ui.current_page as usize * 16 + held_step as usize;
                if idx >= mod_len as usize { return; }
                let cur = engine.tracks[t].modulation.steps[idx].slew;
                let next = clamp_round(cur + delta as f32 * 0.05, 0.0, 1.0);
                let val = engine.tracks[t].modulation.steps[idx].value;
                engine.set_mod_step(t, idx, val, next);
                ui.hold_encoder_used = true;
            } else {
                ui.current_page = clamp_u8(ui.current_page as i32 + delta, 0, max_page);
            }
        }
        _ => {}
    }
}

fn dispatch_mod_lfo(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let t = ui.selected_track as usize;

    match event {
        ControlEvent::EncoderATurn { delta } => {
            ui.mod_lfo_param = clamp_u8(ui.mod_lfo_param as i32 + delta, 0, (LFO_PARAM_COUNT - 1) as u8);
        }
        ControlEvent::EncoderBTurn { delta } => {
            adjust_lfo_param(engine, t, ui.mod_lfo_param, delta);
        }
        _ => {}
    }
}

fn adjust_lfo_param(engine: &mut SequencerState, track: usize, param: u8, delta: i32) {
    let config = &mut engine.lfo_configs[track];
    match param {
        0 => {
            // WAVE — cycle through waveforms
            let cur = LFO_WAVEFORMS.iter().position(|w| *w == config.waveform).unwrap_or(0) as i32;
            let next = wrap(cur + delta, LFO_WAVEFORMS.len() as i32) as usize;
            config.waveform = LFO_WAVEFORMS[next];
        }
        1 => {
            // SYNC — toggle track/free
            config.sync_mode = if config.sync_mode == LfoSyncMode::Track {
                LfoSyncMode::Free
            } else {
                LfoSyncMode::Track
            };
        }
        2 => {
            // RATE
            if config.sync_mode == LfoSyncMode::Free {
                config.free_rate = clamp_round(config.free_rate + delta as f32 * 0.1, 0.1, 20.0);
            } else {
                config.rate = clamp_u8(config.rate as i32 + delta, 1, 64);
            }
        }
        3 => config.depth = clamp_round(config.depth + delta as f32 * 0.01, 0.0, 1.0),
        4 => config.offset = clamp_round(config.offset + delta as f32 * 0.01, 0.0, 1.0),
        5 => config.width = clamp_round(config.width + delta as f32 * 0.01, 0.0, 1.0),
        6 => config.phase = clamp_round(config.phase + delta as f32 * 0.01, 0.0, 1.0),
        _ => {}
    }
}

// ── Mutate (DRIFT) Edit ──────────────────────────────────────────────

fn dispatch_mutate_edit(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let t = ui.selected_track as usize;

    match event {
        ControlEvent::StepPress { step } => {
            if step < 4 {
                ui.selected_track = step;
                ui.mutate_param = 0;
            }
        }
        ControlEvent::EncoderATurn { delta } => {
            ui.mutate_param = clamp_u8(ui.mutate_param as i32 + delta, 0, (MUTATE_PARAM_COUNT - 1) as u8);
        }
        ControlEvent::EncoderBTurn { delta } => {
            let row = ui.mutate_param;
            let mc = &mut engine.mutate_configs[t];
            if row < 4 {
                let rate = match row {
                    0 => &mut mc.gate,
                    1 => &mut mc.pitch,
                    2 => &mut mc.velocity,
                    3 => &mut mc.modulation,
                    _ => unreachable!(),
                };
                *rate = clamp_round(*rate + delta as f32 * 0.01, 0.0, 1.0);
            } else if row == 4 {
                mc.trigger = if mc.trigger == MutateTrigger::Loop {
                    MutateTrigger::Bars
                } else {
                    MutateTrigger::Loop
                };
            } else {
                // row 5: bars
                let cur_idx = BAR_OPTIONS.iter().position(|&b| b == mc.bars).unwrap_or(0) as i32;
                let new_idx = clamp_i32(cur_idx + delta, 0, BAR_OPTIONS.len() as i32 - 1) as usize;
                mc.bars = BAR_OPTIONS[new_idx];
            }
        }
        ControlEvent::EncoderAPush => {
            // Quick all-off
            let mc = &mut engine.mutate_configs[t];
            mc.gate = 0.0;
            mc.pitch = 0.0;
            mc.velocity = 0.0;
            mc.modulation = 0.0;
        }
        _ => {}
    }
}

// ── Route Screen ─────────────────────────────────────────────────────

fn dispatch_route(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let output = ui.selected_track as usize;

    match event {
        ControlEvent::EncoderATurn { delta } => {
            ui.route_param = clamp_u8(ui.route_param as i32 + delta, 0, 3);
        }
        ControlEvent::EncoderAPush => {
            // On MOD row, toggle modSource between seq and lfo
            if ui.route_param == 3 {
                engine.routing[output].mod_source = match engine.routing[output].mod_source {
                    ModSource::Seq => ModSource::Lfo,
                    ModSource::Lfo => ModSource::Seq,
                };
            }
        }
        ControlEvent::EncoderBTurn { delta } => {
            let sub = match ui.route_param {
                0 => SubtrackId::Gate,
                1 => SubtrackId::Pitch,
                2 => SubtrackId::Velocity,
                3 => SubtrackId::Mod,
                _ => return,
            };
            let current = match sub {
                SubtrackId::Gate => engine.routing[output].gate,
                SubtrackId::Pitch => engine.routing[output].pitch,
                SubtrackId::Velocity => engine.routing[output].velocity,
                SubtrackId::Mod => engine.routing[output].modulation,
            };
            let next = wrap(current as i32 + delta, 4) as u8;
            engine.set_output_source(output, sub, next);
        }
        _ => {}
    }
}

// ── Transpose Edit ───────────────────────────────────────────────────

/// Transpose parameter IDs.
const XPOSE_PARAMS: [u8; 5] = [0, 1, 2, 3, 4];
// 0=semi, 1=noteLow, 2=noteHigh, 3=glScale, 4=velScale

fn dispatch_transpose_edit(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let max_idx = XPOSE_PARAMS.len() as i32 - 1;

    match event {
        ControlEvent::EncoderATurn { delta } => {
            ui.xpose_param = clamp_u8(ui.xpose_param as i32 + delta, 0, max_idx as u8);
        }
        ControlEvent::EncoderBTurn { delta } => {
            let t = ui.selected_track as usize;
            let tc = &mut engine.transpose_configs[t];
            match ui.xpose_param {
                0 => {
                    // semitones
                    tc.semitones = clamp_i32(tc.semitones as i32 + delta, -48, 48) as i8;
                }
                1 => {
                    // noteLow
                    let new_low = clamp_u8(tc.note_low as i32 + delta, 0, 127);
                    tc.note_low = new_low;
                    if tc.note_high < new_low {
                        tc.note_high = new_low;
                    }
                }
                2 => {
                    // noteHigh
                    let new_high = clamp_u8(tc.note_high as i32 + delta, 0, 127);
                    tc.note_high = new_high;
                    if tc.note_low > new_high {
                        tc.note_low = new_high;
                    }
                }
                3 => {
                    // glScale
                    tc.gl_scale = clamp_round(tc.gl_scale + delta as f32 * 0.05, 0.25, 4.0);
                }
                4 => {
                    // velScale
                    tc.vel_scale = clamp_round(tc.vel_scale + delta as f32 * 0.05, 0.25, 4.0);
                }
                _ => {}
            }
        }
        _ => {}
    }
}

// ── RAND Screen ──────────────────────────────────────────────────────

/// Rand parameter IDs — simplified enum-based system.
/// The TS version uses dynamic row visibility; Rust uses a fixed param list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RandParamId {
    Preset,
    PitchMode,
    PitchScale,
    PitchRoot,
    PitchLow,
    PitchHigh,
    PitchMaxNotes,
    PitchArpDirection,
    SlideProb,
    ArpEnabled,
    ArpDirection,
    ArpOctaveRange,
    GateMode,
    GateFillMin,
    GateFillMax,
    GateRandomOffset,
    GateClusterContinuation,
    GateLengthMin,
    GateLengthMax,
    RatchetMax,
    RatchetProb,
    TieProb,
    TieMaxLength,
    VelocityMode,
    VelocityLow,
    VelocityHigh,
    ModMode,
    ModLow,
    ModHigh,
    ModWalkStepSize,
    ModSyncBias,
    ModSlew,
    ModSlewProb,
    Save,
}

/// Build the list of visible rand param indices given the current config state.
/// Matches the renderer's row list (excluding header rows).
fn visible_rand_params(engine: &SequencerState, track: usize) -> heapless::Vec<u8, 40> {
    let cfg = &engine.random_configs[track];
    let mut v = heapless::Vec::new();
    let _ = v.push(0);  // Preset
    let _ = v.push(1);  // PitchMode
    let _ = v.push(2);  // PitchScale
    let _ = v.push(3);  // PitchRoot
    let _ = v.push(4);  // PitchLow
    let _ = v.push(5);  // PitchHigh
    let _ = v.push(6);  // PitchMaxNotes
    if cfg.pitch.mode == PitchMode::Arp {
        let _ = v.push(7);  // PitchArpDirection
    }
    let _ = v.push(8);  // SlideProb
    // 9-11 (Arp) not shown in renderer
    let _ = v.push(12); // GateMode
    let _ = v.push(13); // GateFillMin
    let _ = v.push(14); // GateFillMax
    if cfg.gate.mode == GateAlgo::Euclidean {
        let _ = v.push(15); // GateRandomOffset
    }
    if cfg.gate.mode == GateAlgo::Cluster {
        let _ = v.push(16); // GateClusterContinuation
    }
    let _ = v.push(17); // GateLengthMin
    let _ = v.push(18); // GateLengthMax
    let _ = v.push(19); // RatchetMax
    let _ = v.push(20); // RatchetProb
    let _ = v.push(21); // TieProb
    let _ = v.push(22); // TieMaxLength
    let _ = v.push(23); // VelocityMode
    let _ = v.push(24); // VelocityLow
    let _ = v.push(25); // VelocityHigh
    let _ = v.push(26); // ModMode
    if cfg.modulation.mode == ModMode::Walk {
        let _ = v.push(29); // ModWalkStepSize
    }
    if cfg.modulation.mode == ModMode::Sync {
        let _ = v.push(30); // ModSyncBias
    }
    let _ = v.push(27); // ModLow
    let _ = v.push(28); // ModHigh
    let _ = v.push(31); // ModSlew
    let _ = v.push(32); // ModSlewProb
    let _ = v.push(33); // Save
    v
}

pub fn rand_param_at(idx: u8) -> RandParamId {
    match idx {
        0 => RandParamId::Preset,
        1 => RandParamId::PitchMode,
        2 => RandParamId::PitchScale,
        3 => RandParamId::PitchRoot,
        4 => RandParamId::PitchLow,
        5 => RandParamId::PitchHigh,
        6 => RandParamId::PitchMaxNotes,
        7 => RandParamId::PitchArpDirection,
        8 => RandParamId::SlideProb,
        9 => RandParamId::ArpEnabled,
        10 => RandParamId::ArpDirection,
        11 => RandParamId::ArpOctaveRange,
        12 => RandParamId::GateMode,
        13 => RandParamId::GateFillMin,
        14 => RandParamId::GateFillMax,
        15 => RandParamId::GateRandomOffset,
        16 => RandParamId::GateClusterContinuation,
        17 => RandParamId::GateLengthMin,
        18 => RandParamId::GateLengthMax,
        19 => RandParamId::RatchetMax,
        20 => RandParamId::RatchetProb,
        21 => RandParamId::TieProb,
        22 => RandParamId::TieMaxLength,
        23 => RandParamId::VelocityMode,
        24 => RandParamId::VelocityLow,
        25 => RandParamId::VelocityHigh,
        26 => RandParamId::ModMode,
        27 => RandParamId::ModLow,
        28 => RandParamId::ModHigh,
        29 => RandParamId::ModWalkStepSize,
        30 => RandParamId::ModSyncBias,
        31 => RandParamId::ModSlew,
        32 => RandParamId::ModSlewProb,
        33 => RandParamId::Save,
        _ => RandParamId::Preset,
    }
}

fn dispatch_rand(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent, _system_tick: u32) {
    let visible = visible_rand_params(engine, ui.selected_track as usize);

    match event {
        ControlEvent::EncoderATurn { delta } => {
            // Navigate only through visible param indices
            let cur_pos = visible.iter().position(|&p| p == ui.rand_param).unwrap_or(0);
            let new_pos = clamp_i32(cur_pos as i32 + delta, 0, visible.len() as i32 - 1) as usize;
            ui.rand_param = visible[new_pos];
            ui.rand_dropdown_open = false;
        }
        ControlEvent::EncoderAPush => {
            let param = rand_param_at(ui.rand_param);
            match param {
                RandParamId::Preset => {
                    // Apply preset
                    let all = presets::get_presets();
                    let idx = ui.rand_preset_index as usize;
                    if idx < all.len() {
                        engine.random_configs[ui.selected_track as usize] = all[idx].config.clone();
                    } else {
                        // Check user presets
                        let user_idx = idx - all.len();
                        if user_idx < engine.user_presets.len() {
                            engine.random_configs[ui.selected_track as usize] =
                                engine.user_presets[user_idx].config.clone();
                        }
                    }
                }
                RandParamId::Save => {
                    // Enter name-entry mode for preset save
                    ui.mode = ScreenMode::NameEntry;
                    ui.name_chars = [26; 16]; // all spaces
                    ui.name_cursor = 0;
                    ui.name_entry_context = NameEntryContext::Preset;
                }
                _ => {}
            }
        }
        ControlEvent::EncoderBTurn { delta } => {
            dispatch_rand_param_adjust(ui, engine, delta);
        }
        ControlEvent::EncoderBPush => {
            if ui.rand_dropdown_open {
                ui.rand_dropdown_open = false;
            }
            // Also apply preset / trigger save (same as EncoderAPush for these actions)
            let param = rand_param_at(ui.rand_param);
            match param {
                RandParamId::Preset => {
                    let all = presets::get_presets();
                    let idx = ui.rand_preset_index as usize;
                    if idx < all.len() {
                        engine.random_configs[ui.selected_track as usize] = all[idx].config.clone();
                    } else {
                        let user_idx = idx - all.len();
                        if user_idx < engine.user_presets.len() {
                            engine.random_configs[ui.selected_track as usize] =
                                engine.user_presets[user_idx].config.clone();
                        }
                    }
                }
                RandParamId::Save => {
                    ui.mode = ScreenMode::NameEntry;
                    ui.name_chars = [26; 16];
                    ui.name_cursor = 0;
                    ui.name_entry_context = NameEntryContext::Preset;
                }
                _ => {}
            }
        }
        _ => {}
    }
}

fn dispatch_rand_param_adjust(ui: &mut UiState, engine: &mut SequencerState, delta: i32) {
    let t = ui.selected_track as usize;
    let param = rand_param_at(ui.rand_param);

    match param {
        RandParamId::Preset => {
            let factory_count = presets::NUM_PRESETS;
            let total = factory_count + engine.user_presets.len();
            if total == 0 { return; }
            ui.rand_preset_index = clamp_u8(ui.rand_preset_index as i32 + delta, 0, (total - 1) as u8);
            ui.rand_dropdown_open = true;
        }
        RandParamId::PitchMode => {
            const MODES: [PitchMode; 5] = [
                PitchMode::Random, PitchMode::Arp, PitchMode::Walk, PitchMode::Rise, PitchMode::Fall,
            ];
            let cur = MODES.iter().position(|m| *m == engine.random_configs[t].pitch.mode).unwrap_or(0) as i32;
            engine.random_configs[t].pitch.mode = MODES[wrap(cur + delta, MODES.len() as i32) as usize];
            ui.rand_dropdown_open = true;
        }
        RandParamId::PitchScale => {
            let scales = crate::scales::Scales::ALL;
            let cur = scales.iter().position(|s| *s == engine.random_configs[t].pitch.scale).unwrap_or(0) as i32;
            let next = clamp_i32(cur + delta, 0, scales.len() as i32 - 1) as usize;
            engine.random_configs[t].pitch.scale = scales[next].clone();
            ui.rand_dropdown_open = true;
        }
        RandParamId::PitchRoot => {
            let rc = &mut engine.random_configs[t];
            rc.pitch.root = clamp_u8(rc.pitch.root as i32 + delta, 0, 127);
        }
        RandParamId::PitchLow => {
            let rc = &mut engine.random_configs[t];
            let new_low = clamp_u8(rc.pitch.low as i32 + delta, 0, 127);
            rc.pitch.low = new_low;
            if rc.pitch.high < new_low { rc.pitch.high = new_low; }
        }
        RandParamId::PitchHigh => {
            let rc = &mut engine.random_configs[t];
            let new_high = clamp_u8(rc.pitch.high as i32 + delta, 0, 127);
            rc.pitch.high = new_high;
            if rc.pitch.low > new_high { rc.pitch.low = new_high; }
        }
        RandParamId::PitchMaxNotes => {
            engine.random_configs[t].pitch.max_notes = clamp_u8(
                engine.random_configs[t].pitch.max_notes as i32 + delta, 0, 12,
            );
        }
        RandParamId::PitchArpDirection => {
            const DIRS: [PitchArpDirection; 4] = [
                PitchArpDirection::Up, PitchArpDirection::Down,
                PitchArpDirection::UpDown, PitchArpDirection::Random,
            ];
            let cur = DIRS.iter().position(|d| *d == engine.random_configs[t].pitch.arp_direction).unwrap_or(0) as i32;
            engine.random_configs[t].pitch.arp_direction = DIRS[wrap(cur + delta, DIRS.len() as i32) as usize];
        }
        RandParamId::SlideProb => {
            let rc = &mut engine.random_configs[t];
            rc.slide.probability = clamp_round(rc.slide.probability + delta as f32 * 0.05, 0.0, 1.0);
        }
        RandParamId::ArpEnabled => {
            engine.arp_configs[t].enabled = !engine.arp_configs[t].enabled;
        }
        RandParamId::ArpDirection => {
            const DIRS: [ArpDirection; 4] = [
                ArpDirection::Up, ArpDirection::Down, ArpDirection::Triangle, ArpDirection::Random,
            ];
            let cur = DIRS.iter().position(|d| *d == engine.arp_configs[t].direction).unwrap_or(0) as i32;
            engine.arp_configs[t].direction = DIRS[wrap(cur + delta, DIRS.len() as i32) as usize];
        }
        RandParamId::ArpOctaveRange => {
            engine.arp_configs[t].octave_range = clamp_u8(engine.arp_configs[t].octave_range as i32 + delta, 1, 4);
        }
        RandParamId::GateMode => {
            const MODES: [GateAlgo; 4] = [GateAlgo::Random, GateAlgo::Euclidean, GateAlgo::Sync, GateAlgo::Cluster];
            let cur = MODES.iter().position(|m| *m == engine.random_configs[t].gate.mode).unwrap_or(0) as i32;
            engine.random_configs[t].gate.mode = MODES[wrap(cur + delta, MODES.len() as i32) as usize];
            ui.rand_dropdown_open = true;
        }
        RandParamId::GateFillMin => {
            let rc = &mut engine.random_configs[t];
            let new_min = clamp_round(rc.gate.fill_min + delta as f32 * 0.05, 0.0, 1.0);
            rc.gate.fill_min = new_min;
            if rc.gate.fill_max < new_min { rc.gate.fill_max = new_min; }
        }
        RandParamId::GateFillMax => {
            let rc = &mut engine.random_configs[t];
            let new_max = clamp_round(rc.gate.fill_max + delta as f32 * 0.05, 0.0, 1.0);
            rc.gate.fill_max = new_max;
            if rc.gate.fill_min > new_max { rc.gate.fill_min = new_max; }
        }
        RandParamId::GateRandomOffset => {
            engine.random_configs[t].gate.random_offset = !engine.random_configs[t].gate.random_offset;
        }
        RandParamId::GateClusterContinuation => {
            let rc = &mut engine.random_configs[t];
            rc.gate.cluster_continuation = clamp_round(rc.gate.cluster_continuation + delta as f32 * 0.05, 0.0, 1.0);
        }
        RandParamId::GateLengthMin => {
            let rc = &mut engine.random_configs[t];
            let new_min = clamp_round(rc.gate_length.min + delta as f32 * 0.05, 0.05, 1.0);
            rc.gate_length.min = new_min;
            if rc.gate_length.max < new_min { rc.gate_length.max = new_min; }
        }
        RandParamId::GateLengthMax => {
            let rc = &mut engine.random_configs[t];
            let new_max = clamp_round(rc.gate_length.max + delta as f32 * 0.05, 0.05, 1.0);
            rc.gate_length.max = new_max;
            if rc.gate_length.min > new_max { rc.gate_length.min = new_max; }
        }
        RandParamId::RatchetMax => {
            engine.random_configs[t].ratchet.max_ratchet = clamp_u8(
                engine.random_configs[t].ratchet.max_ratchet as i32 + delta, 1, 4,
            );
        }
        RandParamId::RatchetProb => {
            let rc = &mut engine.random_configs[t];
            rc.ratchet.probability = clamp_round(rc.ratchet.probability + delta as f32 * 0.05, 0.0, 1.0);
        }
        RandParamId::TieProb => {
            let rc = &mut engine.random_configs[t];
            rc.tie.probability = clamp_round(rc.tie.probability + delta as f32 * 0.05, 0.0, 1.0);
        }
        RandParamId::TieMaxLength => {
            engine.random_configs[t].tie.max_length = clamp_u8(
                engine.random_configs[t].tie.max_length as i32 + delta, 1, 8,
            );
        }
        RandParamId::VelocityMode => {
            const MODES: [VelocityMode; 6] = [
                VelocityMode::Random, VelocityMode::Accent, VelocityMode::Sync,
                VelocityMode::Rise, VelocityMode::Fall, VelocityMode::Walk,
            ];
            let cur = MODES.iter().position(|m| *m == engine.random_configs[t].velocity.mode).unwrap_or(0) as i32;
            engine.random_configs[t].velocity.mode = MODES[wrap(cur + delta, MODES.len() as i32) as usize];
            ui.rand_dropdown_open = true;
        }
        RandParamId::VelocityLow => {
            let rc = &mut engine.random_configs[t];
            let new_low = clamp_u8(rc.velocity.low as i32 + delta, 0, 127);
            rc.velocity.low = new_low;
            if rc.velocity.high < new_low { rc.velocity.high = new_low; }
        }
        RandParamId::VelocityHigh => {
            let rc = &mut engine.random_configs[t];
            let new_high = clamp_u8(rc.velocity.high as i32 + delta, 0, 127);
            rc.velocity.high = new_high;
            if rc.velocity.low > new_high { rc.velocity.low = new_high; }
        }
        RandParamId::ModMode => {
            const MODES: [ModMode; 7] = [
                ModMode::Random, ModMode::Rise, ModMode::Fall, ModMode::Vee,
                ModMode::Hill, ModMode::Sync, ModMode::Walk,
            ];
            let cur = MODES.iter().position(|m| *m == engine.random_configs[t].modulation.mode).unwrap_or(0) as i32;
            engine.random_configs[t].modulation.mode = MODES[wrap(cur + delta, MODES.len() as i32) as usize];
            ui.rand_dropdown_open = true;
        }
        RandParamId::ModLow => {
            let rc = &mut engine.random_configs[t];
            let new_low = clamp_round(rc.modulation.low + delta as f32 * 0.05, 0.0, 1.0);
            rc.modulation.low = new_low;
            if rc.modulation.high < new_low { rc.modulation.high = new_low; }
        }
        RandParamId::ModHigh => {
            let rc = &mut engine.random_configs[t];
            let new_high = clamp_round(rc.modulation.high + delta as f32 * 0.05, 0.0, 1.0);
            rc.modulation.high = new_high;
            if rc.modulation.low > new_high { rc.modulation.low = new_high; }
        }
        RandParamId::ModWalkStepSize => {
            let rc = &mut engine.random_configs[t];
            rc.modulation.walk_step_size = clamp_round(rc.modulation.walk_step_size + delta as f32 * 0.05, 0.0, 0.5);
        }
        RandParamId::ModSyncBias => {
            let rc = &mut engine.random_configs[t];
            rc.modulation.sync_bias = clamp_round(rc.modulation.sync_bias + delta as f32 * 0.05, 0.0, 1.0);
        }
        RandParamId::ModSlew => {
            let rc = &mut engine.random_configs[t];
            rc.modulation.slew = clamp_round(rc.modulation.slew + delta as f32 * 0.05, 0.0, 1.0);
        }
        RandParamId::ModSlewProb => {
            let rc = &mut engine.random_configs[t];
            rc.modulation.slew_probability = clamp_round(rc.modulation.slew_probability + delta as f32 * 0.05, 0.0, 1.0);
        }
        RandParamId::Save => {} // no encoder B action on save row
    }
}

// ── Variation Edit ───────────────────────────────────────────────────

/// Transform catalog — matching the TS TRANSFORM_CATALOG order.
pub const TRANSFORM_CATALOG: [(TransformType, i32); 25] = [
    (TransformType::Reverse, 0),
    (TransformType::PingPong, 0),
    (TransformType::Rotate, 1),
    (TransformType::DoubleTime, 0),
    (TransformType::HalfTime, 0),
    (TransformType::Stutter, 4),
    (TransformType::Skip, 3),
    (TransformType::DrunkWalk, 0), // 0.3 as i32 = 0; param is stored as i32 in Transform
    (TransformType::Scramble, 0),
    (TransformType::Thin, 0),      // 0.5
    (TransformType::Fill, 0),
    (TransformType::SkipEven, 0),
    (TransformType::SkipOdd, 0),
    (TransformType::InvertGates, 0),
    (TransformType::Densify, 0),   // 0.5
    (TransformType::Drop, 3),
    (TransformType::Ratchet, 2),
    (TransformType::Transpose, 7),
    (TransformType::Invert, 60),
    (TransformType::OctaveShift, 1),
    (TransformType::Fold, 12),
    (TransformType::Quantize, 1),
    (TransformType::Accent, 4),
    (TransformType::FadeIn, 0),
    (TransformType::FadeOut, 0),
];

fn dispatch_variation_edit(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let t = ui.selected_track as usize;
    let vp = &engine.variation_patterns[t];

    // Subtrack sub-screen without override pattern: only enc A push cycles override
    if ui.var_edit_subtrack.is_some() {
        // Simplified: variation subtrack overrides not in engine crate yet
        // Just handle basic events for track-level variation
    }

    match event {
        ControlEvent::StepPress { step } => {
            if step >= vp.length { return; }
            if ui.var_selected_bar == step as i8 {
                ui.var_selected_bar = -1;
                ui.var_cursor = 0;
                ui.var_catalog_open = false;
            } else {
                ui.var_selected_bar = step as i8;
                ui.var_cursor = 0;
                ui.var_catalog_open = false;
            }
        }
        ControlEvent::EncoderATurn { delta } => {
            if ui.var_selected_bar < 0 { return; }
            let bar = ui.var_selected_bar as usize;
            if bar < vp.slots.len() {
                let max_cursor = vp.slots[bar].transforms.len() as i32;
                ui.var_cursor = clamp_u8(ui.var_cursor as i32 + delta, 0, max_cursor as u8);
                ui.var_catalog_open = false;
            }
        }
        ControlEvent::EncoderAPush => {
            if ui.var_selected_bar < 0 {
                // Toggle variation enabled/disabled
                engine.variation_patterns[t].enabled = !engine.variation_patterns[t].enabled;
            }
        }
        ControlEvent::EncoderBTurn { delta } => {
            if ui.var_selected_bar < 0 { return; }
            let bar = ui.var_selected_bar as usize;
            let vp = &engine.variation_patterns[t];
            if bar >= vp.slots.len() { return; }
            let slot = &vp.slots[bar];

            if (ui.var_cursor as usize) >= slot.transforms.len() {
                // Cursor on "add" slot → browse catalog
                let max_idx = TRANSFORM_CATALOG.len() as i32 - 1;
                ui.var_param = clamp_u8(ui.var_param as i32 + delta, 0, max_idx as u8);
                ui.var_catalog_open = true;
            } else {
                // Cursor on existing transform → adjust param
                let idx = ui.var_cursor as usize;
                let t_ref = &mut engine.variation_patterns[t].slots[bar].transforms[idx];
                t_ref.param = adjust_transform_param(t_ref.transform_type, t_ref.param, delta);
            }
        }
        ControlEvent::EncoderBPush => {
            if ui.var_selected_bar < 0 { return; }
            let bar = ui.var_selected_bar as usize;
            let vp = &engine.variation_patterns[t];
            if bar >= vp.slots.len() { return; }
            let slot = &vp.slots[bar];

            if (ui.var_cursor as usize) < slot.transforms.len() { return; }
            // Cursor on "add" slot → add the catalog selection
            let cat_idx = ui.var_param as usize;
            if cat_idx >= TRANSFORM_CATALOG.len() { return; }
            let (transform_type, default_param) = TRANSFORM_CATALOG[cat_idx];
            let new_cursor = engine.variation_patterns[t].slots[bar].transforms.len();
            let _ = engine.variation_patterns[t].slots[bar].transforms.push(
                crate::types::Transform {
                    transform_type,
                    param: default_param,
                },
            );
            ui.var_cursor = new_cursor as u8;
            ui.var_catalog_open = false;
        }
        _ => {}
    }
}

fn adjust_transform_param(tt: TransformType, param: i32, delta: i32) -> i32 {
    match tt {
        TransformType::Rotate => clamp_i32(param + delta, 1, 64),
        TransformType::Thin | TransformType::Densify => {
            // These use f32 0.1-0.9 in TS, but we store as i32 in Rust
            // Use 1-9 range (multiply by 0.1 at transform time)
            clamp_i32(param + delta, 1, 9)
        }
        TransformType::Transpose => clamp_i32(param + delta, -24, 24),
        TransformType::Invert => clamp_i32(param + delta, 0, 127),
        TransformType::OctaveShift => clamp_i32(param + delta, -3, 3),
        TransformType::Stutter => clamp_i32(param + delta, 1, 16),
        TransformType::Skip => clamp_i32(param + delta, 2, 8),
        TransformType::DrunkWalk | TransformType::Humanize => {
            clamp_i32(param + delta, 1, 10)
        }
        TransformType::Drop => clamp_i32(param + delta, 2, 8),
        TransformType::Ratchet => clamp_i32(param + delta, 2, 4),
        TransformType::Fold => clamp_i32(param + delta * 2, 6, 48),
        TransformType::Quantize => clamp_i32(param + delta, 0, 7),
        TransformType::Accent => clamp_i32(param + delta, 2, 8),
        _ => param,
    }
}

// ── Settings Screen ──────────────────────────────────────────────────

/// Settings parameter IDs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SettingsParamId {
    Bpm,
    ClockSource,
    ClockOut,
    MidiEnabled,
    MidiCh0,
    MidiCh1,
    MidiCh2,
    MidiCh3,
}

const SETTINGS_PARAM_COUNT: i32 = 8;

fn settings_param_at(idx: u8) -> SettingsParamId {
    match idx {
        0 => SettingsParamId::Bpm,
        1 => SettingsParamId::ClockSource,
        2 => SettingsParamId::ClockOut,
        3 => SettingsParamId::MidiEnabled,
        4 => SettingsParamId::MidiCh0,
        5 => SettingsParamId::MidiCh1,
        6 => SettingsParamId::MidiCh2,
        7 => SettingsParamId::MidiCh3,
        _ => SettingsParamId::Bpm,
    }
}

fn dispatch_settings(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    match event {
        ControlEvent::EncoderATurn { delta } => {
            ui.settings_param = clamp_u8(ui.settings_param as i32 + delta, 0, (SETTINGS_PARAM_COUNT - 1) as u8);
        }
        ControlEvent::EncoderBTurn { delta } => {
            let param = settings_param_at(ui.settings_param);
            match param {
                SettingsParamId::Bpm => {
                    engine.transport.bpm = clamp_i32(engine.transport.bpm as i32 + delta, 20, 300) as u16;
                }
                SettingsParamId::ClockSource => {
                    const SOURCES: [ClockSource; 3] = [ClockSource::Internal, ClockSource::Midi, ClockSource::External];
                    let cur = SOURCES.iter().position(|s| *s == engine.transport.clock_source).unwrap_or(0) as i32;
                    engine.transport.clock_source = SOURCES[wrap(cur + delta, SOURCES.len() as i32) as usize];
                }
                SettingsParamId::ClockOut => {
                    if delta > 0 && !engine.midi_clock_out {
                        engine.midi_clock_out = true;
                    } else if delta < 0 && engine.midi_clock_out {
                        engine.midi_clock_out = false;
                    }
                }
                SettingsParamId::MidiEnabled => {
                    if delta > 0 && !engine.midi_enabled {
                        engine.midi_enabled = true;
                    } else if delta < 0 && engine.midi_enabled {
                        engine.midi_enabled = false;
                    }
                }
                SettingsParamId::MidiCh0 => {
                    engine.midi_configs[0].channel = clamp_u8(engine.midi_configs[0].channel as i32 + delta, 1, 16);
                }
                SettingsParamId::MidiCh1 => {
                    engine.midi_configs[1].channel = clamp_u8(engine.midi_configs[1].channel as i32 + delta, 1, 16);
                }
                SettingsParamId::MidiCh2 => {
                    engine.midi_configs[2].channel = clamp_u8(engine.midi_configs[2].channel as i32 + delta, 1, 16);
                }
                SettingsParamId::MidiCh3 => {
                    engine.midi_configs[3].channel = clamp_u8(engine.midi_configs[3].channel as i32 + delta, 1, 16);
                }
            }
        }
        _ => {}
    }
}

// ── Pattern Screen ───────────────────────────────────────────────────

fn dispatch_pattern(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    // Row 0 = save-track, rows 1..N = saved patterns
    let max_idx = engine.saved_patterns.len() as i32; // save row + pattern rows

    match event {
        ControlEvent::EncoderATurn { delta } => {
            ui.pattern_param = clamp_u8(ui.pattern_param as i32 + delta, 0, max_idx as u8);
        }
        ControlEvent::EncoderAPush => {
            if ui.pattern_param == 0 {
                // Save: enter name-entry mode for pattern save
                ui.mode = ScreenMode::NameEntry;
                ui.name_chars = [26; 16];
                ui.name_cursor = 0;
                ui.name_entry_context = NameEntryContext::Pattern;
            } else {
                // Load: enter pattern-load mode
                let pattern_idx = ui.pattern_param as usize - 1;
                if pattern_idx < engine.saved_patterns.len() {
                    ui.mode = ScreenMode::PatternLoad;
                    ui.pattern_index = pattern_idx as u8;
                    ui.pattern_layer_flags = LayerFlags::default();
                    ui.pattern_load_target = ui.selected_track;
                }
            }
        }
        _ => {}
    }
}

// ── Pattern Load Screen ──────────────────────────────────────────────

fn dispatch_pattern_load(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    let idx = ui.pattern_index as usize;
    if idx >= engine.saved_patterns.len() {
        ui.mode = ScreenMode::Pattern;
        return;
    }

    match event {
        ControlEvent::EncoderAPush => {
            // Apply: load selected layers into destination track
            let target = ui.pattern_load_target as usize;
            let flags = ui.pattern_layer_flags.clone();
            let slot = engine.saved_patterns[idx].data.clone();

            crate::patterns::restore_track_slot(engine, target, &slot, &flags);

            ui.mode = ScreenMode::Pattern;
            ui.flash_message = Some("LOADED");
        }
        ControlEvent::EncoderBTurn { delta } => {
            ui.pattern_load_target = clamp_u8(ui.pattern_load_target as i32 + delta, 0, 3);
        }
        _ => {}
    }
}

// ── Name Entry Screen ────────────────────────────────────────────────

fn dispatch_name_entry(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
    match event {
        ControlEvent::EncoderATurn { delta } => {
            let cur = ui.name_chars[ui.name_cursor as usize] as i32;
            ui.name_chars[ui.name_cursor as usize] = wrap(cur + delta, NAME_CHARSET.len() as i32) as u8;
        }
        ControlEvent::EncoderBTurn { delta } => {
            ui.name_cursor = clamp_u8(ui.name_cursor as i32 + delta, 0, (NAME_MAX_LEN - 1) as u8);
        }
        ControlEvent::EncoderAPush => {
            // Confirm: convert chars to string, save
            let mut name = heapless::String::<32>::new();
            for &ch_idx in &ui.name_chars[..NAME_MAX_LEN] {
                if (ch_idx as usize) < NAME_CHARSET.len() {
                    let _ = name.push(NAME_CHARSET[ch_idx as usize] as char);
                }
            }
            // Trim trailing spaces
            let trimmed = name.trim_end();

            match ui.name_entry_context {
                NameEntryContext::Preset => {
                    let config = engine.random_configs[ui.selected_track as usize].clone();
                    engine.save_user_preset(trimmed, config);
                    ui.mode = ScreenMode::Rand;
                }
                NameEntryContext::Pattern => {
                    let pattern = crate::patterns::create_saved_pattern(
                        engine,
                        ui.selected_track as usize,
                        trimmed,
                    );
                    crate::patterns::save_pattern(engine, pattern);
                    ui.mode = ScreenMode::Pattern;
                    ui.flash_message = Some("SAVED");
                }
            }
        }
        ControlEvent::Back => {
            let back_mode = match ui.name_entry_context {
                NameEntryContext::Preset => ScreenMode::Rand,
                NameEntryContext::Pattern => ScreenMode::Pattern,
            };
            ui.mode = back_mode;
        }
        _ => {}
    }
}

// ── CLR Button ───────────────────────────────────────────────────────

fn dispatch_clr(ui: &mut UiState, engine: &mut SequencerState, system_tick: u32) {
    // Variation-edit with transform selected: single press deletes
    if ui.mode == ScreenMode::VariationEdit && ui.var_selected_bar >= 0 {
        let t = ui.selected_track as usize;
        let bar = ui.var_selected_bar as usize;
        if bar < engine.variation_patterns[t].slots.len() {
            let slot = &engine.variation_patterns[t].slots[bar];
            if (ui.var_cursor as usize) < slot.transforms.len() {
                dispatch_clr_variation_transform(ui, engine);
                return;
            }
        }
    }

    // Double-press logic
    if ui.clr_pending {
        ui.clr_pending = false;
        ui.clr_pending_tick = 0;
        execute_clr(ui, engine);
        return;
    }

    // First press: enter pending state
    ui.clr_pending = true;
    ui.clr_pending_tick = system_tick;
}

fn execute_clr(ui: &mut UiState, engine: &mut SequencerState) {
    let t = ui.selected_track as usize;
    match ui.mode {
        ScreenMode::Home => engine.clear_track_to_defaults(t),
        ScreenMode::GateEdit => engine.clear_gate_steps_on_page(t, ui.current_page as usize),
        ScreenMode::PitchEdit => engine.clear_pitch_steps_on_page(t, ui.current_page as usize),
        ScreenMode::VelEdit => engine.clear_vel_steps_on_page(t, ui.current_page as usize),
        ScreenMode::ModEdit => engine.clear_mod_steps_on_page(t, ui.current_page as usize),
        ScreenMode::MuteEdit => engine.clear_mute_steps_on_page(t, ui.current_page as usize),
        ScreenMode::MutateEdit => {
            engine.mutate_configs[t] = crate::types::MutateConfig::default();
        }
        ScreenMode::Route => {
            // Reset routing to identity
            for i in 0..4 {
                engine.routing[i] = crate::types::OutputRouting::identity(i as u8);
            }
        }
        ScreenMode::TransposeEdit => {
            engine.transpose_configs[t] = crate::types::TransposeConfig::default();
        }
        ScreenMode::VariationEdit => {
            if ui.var_selected_bar >= 0 {
                // Clear transforms from selected bar
                let bar = ui.var_selected_bar as usize;
                if bar < engine.variation_patterns[t].slots.len() {
                    engine.variation_patterns[t].slots[bar].transforms.clear();
                }
                ui.var_cursor = 0;
                ui.var_catalog_open = false;
            } else {
                // Reset entire variation pattern
                engine.variation_patterns[t] = crate::types::VariationPattern::default();
                ui.var_selected_bar = -1;
                ui.var_cursor = 0;
                ui.var_catalog_open = false;
            }
        }
        ScreenMode::Settings => {
            // Reset current settings param to default
            let param = settings_param_at(ui.settings_param);
            match param {
                SettingsParamId::Bpm => engine.transport.bpm = 135,
                SettingsParamId::ClockSource => engine.transport.clock_source = ClockSource::Internal,
                SettingsParamId::ClockOut => engine.midi_clock_out = false,
                SettingsParamId::MidiEnabled => engine.midi_enabled = false,
                SettingsParamId::MidiCh0 => engine.midi_configs[0].channel = 1,
                SettingsParamId::MidiCh1 => engine.midi_configs[1].channel = 2,
                SettingsParamId::MidiCh2 => engine.midi_configs[2].channel = 3,
                SettingsParamId::MidiCh3 => engine.midi_configs[3].channel = 4,
            }
        }
        ScreenMode::Pattern => {
            // Delete selected pattern
            if ui.pattern_param > 0 {
                let idx = ui.pattern_param as usize - 1;
                if idx < engine.saved_patterns.len() {
                    engine.saved_patterns.remove(idx);
                    let max = engine.saved_patterns.len() as u8;
                    if ui.pattern_param > max {
                        ui.pattern_param = max;
                    }
                    ui.flash_message = Some("DELETED");
                }
            }
        }
        ScreenMode::Rand => {
            // Reset current rand param to default
            // Simplified: reset entire config for the track
            engine.random_configs[t] = crate::types::RandomConfig::default();
        }
        _ => {}
    }
}

fn dispatch_clr_variation_transform(ui: &mut UiState, engine: &mut SequencerState) {
    let t = ui.selected_track as usize;
    let bar = ui.var_selected_bar as usize;
    let cursor = ui.var_cursor as usize;

    if bar < engine.variation_patterns[t].slots.len() {
        let slot = &mut engine.variation_patterns[t].slots[bar];
        if cursor < slot.transforms.len() {
            slot.transforms.remove(cursor);
            let new_len = slot.transforms.len();
            if cursor >= new_len && new_len > 0 {
                ui.var_cursor = (new_len - 1) as u8;
            } else if new_len == 0 {
                ui.var_cursor = 0;
            }
        }
    }
    ui.var_catalog_open = false;
    ui.clr_pending = false;
    ui.clr_pending_tick = 0;
}

// ── Hold Combos ──────────────────────────────────────────────────────

fn dispatch_step_hold_combo(ui: &mut UiState, engine: &mut SequencerState, event: &ControlEvent, delta: i32) {
    let step = match ui.held_button {
        Some(HeldButton::Step(s)) => s,
        _ => return,
    };
    let t = ui.selected_track as usize;
    let idx = ui.current_page as usize * 16 + step as usize;

    match event {
        ControlEvent::EncoderATurn { .. } => {
            // Gate length (0.05 - 1.0 in 0.05 steps)
            if idx >= engine.tracks[t].gate.length as usize { return; }
            let cur = engine.tracks[t].gate.steps[idx].length;
            let next = clamp_round(cur + delta as f32 * 0.05, 0.05, 1.0);
            engine.set_gate_length(t, idx, next);
            ui.hold_encoder_used = true;
        }
        ControlEvent::EncoderBTurn { .. } => {
            // Ratchet count (1-4)
            if idx >= engine.tracks[t].gate.length as usize { return; }
            let cur = engine.tracks[t].gate.steps[idx].ratchet;
            engine.set_gate_ratchet(t, idx, clamp_u8(cur as i32 + delta, 1, 4));
            ui.hold_encoder_used = true;
        }
        _ => {}
    }
}

fn dispatch_step_tie(ui: &mut UiState, engine: &mut SequencerState, step: u8) {
    let from_step = match ui.held_button {
        Some(HeldButton::Step(s)) => ui.current_page as usize * 16 + s as usize,
        _ => return,
    };
    let to_step = ui.current_page as usize * 16 + step as usize;
    let t = ui.selected_track as usize;

    if from_step == to_step {
        // Same step — fall through to normal gate toggle
        dispatch_gate_edit(ui, engine, ControlEvent::StepPress { step });
        return;
    }

    if from_step < to_step {
        engine.set_tie_range(t, from_step, to_step);
    } else {
        // Clear ties from to_step to from_step
        for i in to_step..=from_step {
            engine.set_gate_tie(t, i, false);
        }
    }
    ui.hold_encoder_used = true;
}

fn dispatch_hold_combo(ui: &mut UiState, engine: &mut SequencerState, event: &ControlEvent, delta: i32) {
    let held = match ui.held_button {
        Some(h) => h,
        None => return,
    };

    let track_idx = match held {
        HeldButton::Track(t) => t as usize,
        _ => ui.selected_track as usize,
    };
    ui.hold_encoder_used = true;

    match held {
        HeldButton::Track(_) => {
            match event {
                ControlEvent::EncoderATurn { .. } => {
                    // Hold track + enc A = change all subtrack lengths together
                    let base = engine.tracks[track_idx].gate.length;
                    let new_len = (base as i32 + delta).clamp(1, MAX_STEPS as i32) as u8;
                    engine.set_subtrack_length(track_idx, SubtrackId::Gate, new_len);
                    engine.set_subtrack_length(track_idx, SubtrackId::Pitch, new_len);
                    engine.set_subtrack_length(track_idx, SubtrackId::Velocity, new_len);
                    engine.set_subtrack_length(track_idx, SubtrackId::Mod, new_len);
                }
                ControlEvent::EncoderBTurn { .. } => {
                    // Hold track + enc B = track clock divider
                    let cur = engine.tracks[track_idx].clock_divider;
                    engine.set_track_clock_divider(track_idx, (cur as i32 + delta).clamp(1, 32) as u8);
                }
                _ => {}
            }
        }
        HeldButton::Subtrack(sub) => {
            let sid = subtrack_to_id(sub);
            match event {
                ControlEvent::EncoderATurn { .. } => {
                    let cur = match sub {
                        UiSubtrack::Gate => engine.tracks[track_idx].gate.length,
                        UiSubtrack::Pitch => engine.tracks[track_idx].pitch.length,
                        UiSubtrack::Velocity => engine.tracks[track_idx].velocity.length,
                        UiSubtrack::Mod => engine.tracks[track_idx].modulation.length,
                    };
                    let new_len = (cur as i32 + delta).clamp(1, MAX_STEPS as i32) as u8;
                    engine.set_subtrack_length(track_idx, sid, new_len);
                }
                ControlEvent::EncoderBTurn { .. } => {
                    let cur = match sub {
                        UiSubtrack::Gate => engine.tracks[track_idx].gate.clock_divider,
                        UiSubtrack::Pitch => engine.tracks[track_idx].pitch.clock_divider,
                        UiSubtrack::Velocity => engine.tracks[track_idx].velocity.clock_divider,
                        UiSubtrack::Mod => engine.tracks[track_idx].modulation.clock_divider,
                    };
                    engine.set_subtrack_clock_divider(track_idx, sid, (cur as i32 + delta).clamp(1, 32) as u8);
                }
                _ => {}
            }
        }
        HeldButton::Feature(Feature::Mute) => {
            match event {
                ControlEvent::EncoderATurn { .. } => {
                    let cur = engine.mute_patterns[track_idx].length;
                    engine.set_mute_length(track_idx, (cur as i32 + delta).clamp(1, MAX_STEPS as i32) as u8);
                }
                ControlEvent::EncoderBTurn { .. } => {
                    let cur = engine.mute_patterns[track_idx].clock_divider;
                    engine.set_mute_clock_divider(track_idx, (cur as i32 + delta).clamp(1, 32) as u8);
                }
                _ => {}
            }
        }
        HeldButton::Feature(Feature::Variation) => {
            match event {
                ControlEvent::EncoderATurn { .. } => {
                    // Hold VAR + enc A = variation phrase length (1-16)
                    let vp = &mut engine.variation_patterns[track_idx];
                    let new_len = (vp.length as i32 + delta).clamp(1, 16) as u8;
                    if new_len != vp.length {
                        vp.length = new_len;
                        // Ensure enough slots
                        while vp.slots.len() < new_len as usize {
                            let _ = vp.slots.push(VariationSlot::default());
                        }
                        vp.loop_mode = false;
                        if ui.var_selected_bar >= new_len as i8 {
                            ui.var_selected_bar = -1;
                            ui.var_cursor = 0;
                            ui.var_catalog_open = false;
                        }
                        if vp.current_bar >= new_len {
                            vp.current_bar %= new_len;
                        }
                    }
                }
                ControlEvent::EncoderBTurn { .. } => {
                    // Hold VAR + enc B = toggle loop mode
                    let new_loop = delta > 0;
                    let vp = &mut engine.variation_patterns[track_idx];
                    if new_loop != vp.loop_mode {
                        vp.loop_mode = new_loop;
                        if new_loop {
                            let gate_len = engine.tracks[track_idx].gate.length;
                            vp.length = gate_len;
                            while vp.slots.len() < gate_len as usize {
                                let _ = vp.slots.push(VariationSlot::default());
                            }
                            if ui.var_selected_bar >= gate_len as i8 {
                                ui.var_selected_bar = -1;
                                ui.var_cursor = 0;
                                ui.var_catalog_open = false;
                            }
                            vp.current_bar %= gate_len;
                        }
                    }
                }
                _ => {}
            }
        }
        _ => {}
    }
}

fn dispatch_hold_reset(ui: &mut UiState, engine: &mut SequencerState) {
    let held = match ui.held_button {
        Some(h) => h,
        None => return,
    };

    match held {
        HeldButton::Track(t) => {
            engine.reset_track_playheads(t as usize);
            ui.hold_encoder_used = true;
        }
        HeldButton::Subtrack(sub) => {
            let sid = subtrack_to_id(sub);
            engine.reset_subtrack_playhead(ui.selected_track as usize, sid);
            ui.hold_encoder_used = true;
        }
        _ => {}
    }
}

fn dispatch_hold_rand(ui: &mut UiState, engine: &mut SequencerState, system_tick: u32) {
    let held = match ui.held_button {
        Some(h) => h,
        None => return,
    };

    let track_idx = match held {
        HeldButton::Track(t) => t as usize,
        _ => ui.selected_track as usize,
    };

    match held {
        HeldButton::Track(_) => {
            engine.randomize_full_track(track_idx, system_tick);
            ui.hold_encoder_used = true;
        }
        HeldButton::Subtrack(sub) => {
            match sub {
                UiSubtrack::Gate => engine.randomize_gate(track_idx, system_tick),
                UiSubtrack::Pitch => engine.randomize_pitch(track_idx, system_tick),
                UiSubtrack::Velocity => engine.randomize_velocity(track_idx, system_tick),
                UiSubtrack::Mod => engine.randomize_mod(track_idx, system_tick),
            }
            ui.hold_encoder_used = true;
        }
        _ => {}
    }
}

// ── LED State ────────────────────────────────────────────────────────

/// Compute LED state for hardware buttons based on current UI and engine state.
pub fn get_led_state(ui: &UiState, engine: &SequencerState) -> LedState {
    let play = if engine.transport.playing { LedMode::Flash } else { LedMode::Off };

    // Track LEDs
    let active_track = if ui.mode == ScreenMode::PatternLoad {
        ui.pattern_load_target
    } else {
        ui.selected_track
    };
    let mut tracks = [false; 4];
    tracks[active_track as usize] = true;

    // Step LEDs
    let steps = get_step_leds(ui, engine);

    LedState { steps, tracks, play }
}

fn get_step_leds(ui: &UiState, engine: &SequencerState) -> [LedMode; 16] {
    let mut leds = [LedMode::Off; 16];
    let t = ui.selected_track as usize;
    let page_offset = ui.current_page as usize * 16;

    match ui.mode {
        ScreenMode::GateEdit => {
            let track = &engine.tracks[t];
            let len = track.gate.length as usize;
            for (i, led) in leds.iter_mut().enumerate() {
                let idx = page_offset + i;
                if idx >= len {
                    *led = LedMode::Off;
                } else if idx == track.gate.current_step as usize {
                    *led = LedMode::Flash;
                } else if track.gate.steps[idx].on || track.gate.steps[idx].tie {
                    *led = LedMode::On;
                } else {
                    *led = LedMode::Dim;
                }
            }
        }
        ScreenMode::PitchEdit => {
            let track = &engine.tracks[t];
            let len = track.pitch.length as usize;
            for (i, led) in leds.iter_mut().enumerate() {
                let idx = page_offset + i;
                if idx >= len {
                    *led = LedMode::Off;
                } else if idx == track.pitch.current_step as usize {
                    *led = LedMode::Flash;
                } else if i == ui.selected_step.max(0) as usize {
                    *led = LedMode::On;
                } else {
                    *led = LedMode::Dim;
                }
            }
        }
        ScreenMode::VelEdit => {
            let track = &engine.tracks[t];
            let len = track.velocity.length as usize;
            for (i, led) in leds.iter_mut().enumerate() {
                let idx = page_offset + i;
                if idx >= len {
                    *led = LedMode::Off;
                } else if idx == track.velocity.current_step as usize {
                    *led = LedMode::Flash;
                } else if i == ui.selected_step.max(0) as usize {
                    *led = LedMode::On;
                } else {
                    *led = LedMode::Dim;
                }
            }
        }
        ScreenMode::MuteEdit => {
            let mute = &engine.mute_patterns[t];
            let len = mute.length as usize;
            for (i, led) in leds.iter_mut().enumerate() {
                let idx = page_offset + i;
                if idx >= len {
                    *led = LedMode::Off;
                } else if idx == mute.current_step as usize {
                    *led = LedMode::Flash;
                } else if mute.steps[idx] {
                    *led = LedMode::On;
                } else {
                    *led = LedMode::Dim;
                }
            }
        }
        ScreenMode::VariationEdit => {
            let vp = &engine.variation_patterns[t];
            for (i, led) in leds.iter_mut().enumerate() {
                if i >= vp.length as usize {
                    *led = LedMode::Off;
                } else if i == ui.var_selected_bar as usize && ui.var_selected_bar >= 0 {
                    *led = LedMode::Flash;
                } else if i < vp.slots.len() && !vp.slots[i].transforms.is_empty() {
                    *led = LedMode::On;
                } else {
                    *led = LedMode::Dim;
                }
            }
        }
        _ => {
            // Home and other modes: show gate pattern overview
            let track = &engine.tracks[t];
            let len = track.gate.length as usize;
            for (i, led) in leds.iter_mut().enumerate() {
                if i >= len {
                    *led = LedMode::Off;
                } else if i == track.gate.current_step as usize {
                    *led = LedMode::Flash;
                } else if track.gate.steps[i].on || track.gate.steps[i].tie {
                    *led = LedMode::On;
                } else {
                    *led = LedMode::Off;
                }
            }
        }
    }

    leds
}

// ── CLR timeout check ────────────────────────────────────────────────

/// Call this periodically (e.g. each frame) to cancel CLR pending after 2 seconds.
pub fn check_clr_timeout(ui: &mut UiState, system_tick: u32) {
    if ui.clr_pending && system_tick.wrapping_sub(ui.clr_pending_tick) > 2000 {
        ui.clr_pending = false;
        ui.clr_pending_tick = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::SequencerState;

    fn default_state() -> (UiState, SequencerState) {
        (UiState::default(), SequencerState::new())
    }

    fn d(ui: &mut UiState, engine: &mut SequencerState, event: ControlEvent) {
        dispatch(ui, engine, event, 0);
    }

    // ── Cross-modal navigation ───────────────────────────────────────

    #[test]
    fn track_select_changes_selected_track() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::TrackSelect { track: 2 });
        assert_eq!(ui.selected_track, 2);
    }

    #[test]
    fn track_select_resets_page_and_step() {
        let (mut ui, mut eng) = default_state();
        ui.current_page = 1;
        ui.selected_step = 5;
        d(&mut ui, &mut eng, ControlEvent::TrackSelect { track: 1 });
        assert_eq!(ui.current_page, 0);
        assert_eq!(ui.selected_step, 0);
    }

    #[test]
    fn subtrack_select_enters_edit_mode() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Pitch });
        assert_eq!(ui.mode, ScreenMode::PitchEdit);
        assert_eq!(ui.selected_step, 0);
    }

    #[test]
    fn gate_subtrack_select_sets_step_negative() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Gate });
        assert_eq!(ui.mode, ScreenMode::GateEdit);
        assert_eq!(ui.selected_step, -1);
    }

    #[test]
    fn feature_press_enters_feature_screen() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::FeaturePress { feature: Feature::Rand });
        assert_eq!(ui.mode, ScreenMode::Rand);
    }

    #[test]
    fn back_returns_to_home() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::PitchEdit;
        d(&mut ui, &mut eng, ControlEvent::Back);
        assert_eq!(ui.mode, ScreenMode::Home);
    }

    #[test]
    fn play_stop_toggles_transport() {
        let (mut ui, mut eng) = default_state();
        assert!(!eng.transport.playing);
        d(&mut ui, &mut eng, ControlEvent::PlayStop);
        assert!(eng.transport.playing);
        d(&mut ui, &mut eng, ControlEvent::PlayStop);
        assert!(!eng.transport.playing);
    }

    #[test]
    fn reset_resets_playheads() {
        let (mut ui, mut eng) = default_state();
        eng.transport.master_tick = 100;
        d(&mut ui, &mut eng, ControlEvent::Reset);
        assert_eq!(eng.transport.master_tick, 0);
    }

    #[test]
    fn settings_press_enters_settings() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::SettingsPress);
        assert_eq!(ui.mode, ScreenMode::Settings);
        assert_eq!(ui.settings_param, 0);
    }

    #[test]
    fn pattern_press_enters_pattern() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::PatternPress);
        assert_eq!(ui.mode, ScreenMode::Pattern);
    }

    // ── Home Screen ──────────────────────────────────────────────────

    #[test]
    fn home_encoder_a_selects_track() {
        let (mut ui, mut eng) = default_state();
        assert_eq!(ui.selected_track, 0);
        // Delta -1 should wrap to track 3 (encoder A inverted in home)
        d(&mut ui, &mut eng, ControlEvent::EncoderATurn { delta: 1 });
        assert_eq!(ui.selected_track, 3);
    }

    #[test]
    fn home_encoder_a_push_enters_gate_edit() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::EncoderAPush);
        assert_eq!(ui.mode, ScreenMode::GateEdit);
    }

    // ── Gate Edit ────────────────────────────────────────────────────

    #[test]
    fn gate_edit_step_toggles_gate() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::GateEdit;
        assert!(!eng.tracks[0].gate.steps[3].on);
        d(&mut ui, &mut eng, ControlEvent::StepPress { step: 3 });
        assert!(eng.tracks[0].gate.steps[3].on);
        d(&mut ui, &mut eng, ControlEvent::StepPress { step: 3 });
        assert!(!eng.tracks[0].gate.steps[3].on);
    }

    #[test]
    fn gate_edit_encoder_b_changes_page() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::GateEdit;
        assert_eq!(ui.current_page, 0);
        // Can't go below 0
        d(&mut ui, &mut eng, ControlEvent::EncoderBTurn { delta: -1 });
        assert_eq!(ui.current_page, 0);
    }

    // ── Pitch Edit ───────────────────────────────────────────────────

    #[test]
    fn pitch_edit_encoder_a_adjusts_note() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::PitchEdit;
        ui.selected_step = 0;
        assert_eq!(eng.tracks[0].pitch.steps[0].note, 60);
        d(&mut ui, &mut eng, ControlEvent::EncoderATurn { delta: 5 });
        assert_eq!(eng.tracks[0].pitch.steps[0].note, 65);
    }

    #[test]
    fn pitch_edit_step_selects_step() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::PitchEdit;
        d(&mut ui, &mut eng, ControlEvent::StepPress { step: 7 });
        assert_eq!(ui.selected_step, 7);
    }

    // ── Velocity Edit ────────────────────────────────────────────────

    #[test]
    fn vel_edit_encoder_a_adjusts_velocity() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::VelEdit;
        ui.selected_step = 0;
        assert_eq!(eng.tracks[0].velocity.steps[0], 100);
        d(&mut ui, &mut eng, ControlEvent::EncoderATurn { delta: 10 });
        assert_eq!(eng.tracks[0].velocity.steps[0], 110);
    }

    // ── Mute Edit ────────────────────────────────────────────────────

    #[test]
    fn mute_edit_step_toggles_mute() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::MuteEdit;
        assert!(!eng.mute_patterns[0].steps[5]);
        d(&mut ui, &mut eng, ControlEvent::StepPress { step: 5 });
        assert!(eng.mute_patterns[0].steps[5]);
    }

    // ── MOD Edit ─────────────────────────────────────────────────────

    #[test]
    fn mod_edit_encoder_a_push_toggles_lfo_view() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::ModEdit;
        assert!(!ui.mod_lfo_view);
        d(&mut ui, &mut eng, ControlEvent::EncoderAPush);
        assert!(ui.mod_lfo_view);
        d(&mut ui, &mut eng, ControlEvent::EncoderAPush);
        assert!(!ui.mod_lfo_view);
    }

    // ── Route ────────────────────────────────────────────────────────

    #[test]
    fn route_encoder_b_changes_source() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::Route;
        ui.route_param = 0; // gate routing
        assert_eq!(eng.routing[0].gate, 0);
        d(&mut ui, &mut eng, ControlEvent::EncoderBTurn { delta: 1 });
        assert_eq!(eng.routing[0].gate, 1);
    }

    // ── Mutate Edit ──────────────────────────────────────────────────

    #[test]
    fn mutate_edit_encoder_b_adjusts_rate() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::MutateEdit;
        ui.mutate_param = 0; // gate rate
        assert_eq!(eng.mutate_configs[0].gate, 0.0);
        d(&mut ui, &mut eng, ControlEvent::EncoderBTurn { delta: 5 });
        assert!(eng.mutate_configs[0].gate > 0.0);
    }

    // ── Transpose Edit ───────────────────────────────────────────────

    #[test]
    fn transpose_edit_encoder_b_adjusts_semitones() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::TransposeEdit;
        ui.xpose_param = 0; // semitones
        assert_eq!(eng.transpose_configs[0].semitones, 0);
        d(&mut ui, &mut eng, ControlEvent::EncoderBTurn { delta: 7 });
        assert_eq!(eng.transpose_configs[0].semitones, 7);
    }

    // ── Settings ─────────────────────────────────────────────────────

    #[test]
    fn settings_encoder_b_adjusts_bpm() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::Settings;
        ui.settings_param = 0; // BPM
        assert_eq!(eng.transport.bpm, 135);
        d(&mut ui, &mut eng, ControlEvent::EncoderBTurn { delta: 5 });
        assert_eq!(eng.transport.bpm, 140);
    }

    #[test]
    fn settings_bpm_clamps() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::Settings;
        ui.settings_param = 0;
        d(&mut ui, &mut eng, ControlEvent::EncoderBTurn { delta: -200 });
        assert_eq!(eng.transport.bpm, 20);
        d(&mut ui, &mut eng, ControlEvent::EncoderBTurn { delta: 500 });
        assert_eq!(eng.transport.bpm, 300);
    }

    // ── Hold Combos ──────────────────────────────────────────────────

    #[test]
    fn hold_track_encoder_a_changes_all_lengths() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::HoldStart { button: HeldButton::Track(0) });
        d(&mut ui, &mut eng, ControlEvent::EncoderATurn { delta: -2 });
        assert_eq!(eng.tracks[0].gate.length, 14);
        assert_eq!(eng.tracks[0].pitch.length, 14);
        assert_eq!(eng.tracks[0].velocity.length, 14);
        assert_eq!(eng.tracks[0].modulation.length, 14);
        assert!(ui.hold_encoder_used);
    }

    #[test]
    fn hold_subtrack_encoder_a_changes_subtrack_length() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::HoldStart { button: HeldButton::Subtrack(UiSubtrack::Gate) });
        d(&mut ui, &mut eng, ControlEvent::EncoderATurn { delta: -4 });
        assert_eq!(eng.tracks[0].gate.length, 12);
        // Other subtracks unchanged
        assert_eq!(eng.tracks[0].pitch.length, 16);
    }

    #[test]
    fn hold_step_gate_edit_encoder_a_adjusts_gate_length() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::GateEdit;
        eng.set_gate_on(0, 3, true);
        d(&mut ui, &mut eng, ControlEvent::HoldStart { button: HeldButton::Step(3) });
        assert_eq!(ui.selected_step, 3);
        let orig = eng.tracks[0].gate.steps[3].length;
        d(&mut ui, &mut eng, ControlEvent::EncoderATurn { delta: 2 });
        assert!(eng.tracks[0].gate.steps[3].length > orig);
        assert!(ui.hold_encoder_used);
    }

    #[test]
    fn hold_end_clears_hold_state() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::HoldStart { button: HeldButton::Track(0) });
        assert!(ui.held_button.is_some());
        d(&mut ui, &mut eng, ControlEvent::HoldEnd);
        assert!(ui.held_button.is_none());
    }

    #[test]
    fn hold_reset_resets_track_playheads() {
        let (mut ui, mut eng) = default_state();
        // Advance some ticks
        for _ in 0..30 {
            crate::sequencer::tick(&mut eng);
        }
        d(&mut ui, &mut eng, ControlEvent::HoldStart { button: HeldButton::Track(0) });
        d(&mut ui, &mut eng, ControlEvent::Reset);
        assert_eq!(eng.tracks[0].gate.current_step, 0);
    }

    // ── CLR ──────────────────────────────────────────────────────────

    #[test]
    fn clr_requires_double_press() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::GateEdit;
        eng.set_gate_on(0, 0, true);
        // First press: pending
        d(&mut ui, &mut eng, ControlEvent::ClrPress);
        assert!(ui.clr_pending);
        assert!(eng.tracks[0].gate.steps[0].on); // not cleared yet
        // Second press: execute
        d(&mut ui, &mut eng, ControlEvent::ClrPress);
        assert!(!ui.clr_pending);
        assert!(!eng.tracks[0].gate.steps[0].on); // cleared
    }

    #[test]
    fn clr_pending_cancelled_by_other_event() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::GateEdit;
        d(&mut ui, &mut eng, ControlEvent::ClrPress);
        assert!(ui.clr_pending);
        // Any other event cancels CLR pending
        d(&mut ui, &mut eng, ControlEvent::StepPress { step: 0 });
        assert!(!ui.clr_pending);
    }

    #[test]
    fn clr_timeout_cancels_pending() {
        let (mut ui, _eng) = default_state();
        ui.clr_pending = true;
        ui.clr_pending_tick = 1000;
        check_clr_timeout(&mut ui, 3001);
        assert!(!ui.clr_pending);
    }

    // ── Name Entry ───────────────────────────────────────────────────

    #[test]
    fn name_entry_encoder_a_cycles_chars() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::NameEntry;
        ui.name_chars = [0; 16]; // all 'A'
        ui.name_cursor = 0;
        d(&mut ui, &mut eng, ControlEvent::EncoderATurn { delta: 1 });
        assert_eq!(ui.name_chars[0], 1); // 'B'
    }

    #[test]
    fn name_entry_back_cancels() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::NameEntry;
        ui.name_entry_context = NameEntryContext::Preset;
        d(&mut ui, &mut eng, ControlEvent::Back);
        assert_eq!(ui.mode, ScreenMode::Rand);
    }

    // ── LED State ────────────────────────────────────────────────────

    #[test]
    fn led_state_gate_edit_shows_active_steps() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::GateEdit;
        eng.set_gate_on(0, 2, true);
        eng.set_gate_on(0, 5, true);
        let leds = get_led_state(&ui, &eng);
        // Step 0 = current_step = Flash (playhead)
        assert_eq!(leds.steps[0], LedMode::Flash);
        assert_eq!(leds.steps[1], LedMode::Dim);
        assert_eq!(leds.steps[2], LedMode::On);
        assert_eq!(leds.steps[5], LedMode::On);
    }

    #[test]
    fn led_state_track_leds_reflect_selection() {
        let (mut ui, eng) = default_state();
        ui.selected_track = 2;
        let leds = get_led_state(&ui, &eng);
        assert!(!leds.tracks[0]);
        assert!(leds.tracks[2]);
    }

    #[test]
    fn led_state_play_reflects_transport() {
        let (ui, mut eng) = default_state();
        let leds = get_led_state(&ui, &eng);
        assert_eq!(leds.play, LedMode::Off);
        eng.transport.playing = true;
        let leds = get_led_state(&ui, &eng);
        assert_eq!(leds.play, LedMode::Flash);
    }

    // ── Variation Edit ───────────────────────────────────────────────

    #[test]
    fn variation_step_press_selects_bar() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::VariationEdit;
        d(&mut ui, &mut eng, ControlEvent::StepPress { step: 2 });
        assert_eq!(ui.var_selected_bar, 2);
        // Press same step: deselects
        d(&mut ui, &mut eng, ControlEvent::StepPress { step: 2 });
        assert_eq!(ui.var_selected_bar, -1);
    }

    #[test]
    fn variation_encoder_a_push_toggles_enabled() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::VariationEdit;
        assert!(!eng.variation_patterns[0].enabled);
        d(&mut ui, &mut eng, ControlEvent::EncoderAPush);
        assert!(eng.variation_patterns[0].enabled);
    }

    // ── Pattern Load ─────────────────────────────────────────────────

    #[test]
    fn pattern_load_back_returns_to_pattern() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::PatternLoad;
        d(&mut ui, &mut eng, ControlEvent::Back);
        assert_eq!(ui.mode, ScreenMode::Pattern);
    }

    #[test]
    fn pattern_load_track_select_changes_target() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::PatternLoad;
        d(&mut ui, &mut eng, ControlEvent::TrackSelect { track: 3 });
        assert_eq!(ui.pattern_load_target, 3);
    }

    #[test]
    fn pattern_load_subtrack_toggles_layer() {
        let (mut ui, mut eng) = default_state();
        ui.mode = ScreenMode::PatternLoad;
        assert!(ui.pattern_layer_flags.gate);
        d(&mut ui, &mut eng, ControlEvent::SubtrackSelect { subtrack: UiSubtrack::Gate });
        assert!(!ui.pattern_layer_flags.gate);
    }

    // ── Hold + RAND ──────────────────────────────────────────────────

    #[test]
    fn hold_track_rand_randomizes_track() {
        let (mut ui, mut eng) = default_state();
        d(&mut ui, &mut eng, ControlEvent::HoldStart { button: HeldButton::Track(0) });
        d(&mut ui, &mut eng, ControlEvent::FeaturePress { feature: Feature::Rand });
        // After randomization, some gates should be active
        let has_active = eng.tracks[0].gate.steps.iter().any(|s| s.on || s.tie);
        assert!(has_active);
    }
}
