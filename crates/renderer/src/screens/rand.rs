use embedded_graphics::{pixelcolor::Rgb565, prelude::*};
use requencer_engine::presets;
use requencer_engine::types::{
    GateAlgo, ModMode, PitchMode, PitchArpDirection, SequencerState, VelocityMode,
};

use crate::{colors, draw, layout, types::UiState};

/// Render the randomizer parameter screen.
pub fn render<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    state: &SequencerState,
    ui: &UiState,
) {
    let track_idx = ui.selected_track as usize;
    let cfg = &state.random_configs[track_idx];
    let color = colors::TRACK[track_idx];

    // Header
    draw::fill_rect(
        display,
        0,
        layout::CONTENT_Y as i32,
        layout::LCD_W,
        layout::EDIT_HEADER_H,
        colors::STATUS_BAR,
    );
    draw::text(
        display,
        layout::PAD as i32,
        layout::CONTENT_Y as i32 + 7,
        "RAND",
        color,
    );

    // Build visible row list (matches TS getVisibleRows)
    let mut rows: heapless::Vec<Row, 40> = heapless::Vec::new();
    let mut buf = [0u8; 16];

    // PRESET — show factory or user preset name
    let factory = presets::get_presets();
    let preset_idx = ui.rand_preset_index as usize;
    let preset_name = if preset_idx < factory.len() {
        factory[preset_idx].name
    } else {
        let user_idx = preset_idx - factory.len();
        if user_idx < state.user_presets.len() {
            &state.user_presets[user_idx].name
        } else {
            "—"
        }
    };
    let _ = rows.push(Row::param("PRESET", preset_name, 0));

    // --- PITCH ---
    let _ = rows.push(Row::header("PITCH"));
    let _ = rows.push(Row::param("MODE", pitch_mode_name(cfg.pitch.mode), 1));
    let _ = rows.push(Row::param("SCALE", cfg.pitch.scale.name, 2));
    let _ = rows.push(Row::param_buf("ROOT", note_name(cfg.pitch.root, &mut buf), 3));
    let _ = rows.push(Row::param_buf("LO", note_name(cfg.pitch.low, &mut buf), 4));
    let _ = rows.push(Row::param_buf("HI", note_name(cfg.pitch.high, &mut buf), 5));
    let _ = rows.push(Row::param_buf("MAX NOTES", {
        if cfg.pitch.max_notes == 0 { "ALL" } else { draw::format_u16(cfg.pitch.max_notes as u16, &mut buf) }
    }, 6));
    if cfg.pitch.mode == PitchMode::Arp {
        let _ = rows.push(Row::subparam("DIR", arp_dir_name(cfg.pitch.arp_direction), 7));
    }
    let _ = rows.push(Row::param_buf("SLD %", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.slide.probability * 100.0) as u16)), 8));

    // --- GATE ---
    let _ = rows.push(Row::header("GATE"));
    let _ = rows.push(Row::param("MODE", gate_mode_name(cfg.gate.mode), 12));
    let _ = rows.push(Row::param_buf("FILL MIN", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate.fill_min * 100.0) as u16)), 13));
    let _ = rows.push(Row::param_buf("FILL MAX", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate.fill_max * 100.0) as u16)), 14));
    if cfg.gate.mode == GateAlgo::Euclidean {
        let _ = rows.push(Row::subparam("OFFSET", if cfg.gate.random_offset { "RANDOM" } else { "NONE" }, 15));
    }
    if cfg.gate.mode == GateAlgo::Cluster {
        let _ = rows.push(Row::subparam_buf("CLST %", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate.cluster_continuation * 100.0) as u16)), 16));
    }
    let _ = rows.push(Row::param_buf("GL MIN", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate_length.min * 100.0) as u16)), 17));
    let _ = rows.push(Row::param_buf("GL MAX", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.gate_length.max * 100.0) as u16)), 18));
    let _ = rows.push(Row::param_buf("RATCH MAX", draw::fmt_buf(&mut buf, format_args!("{}x", cfg.ratchet.max_ratchet)), 19));
    let _ = rows.push(Row::param_buf("RATCH %", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.ratchet.probability * 100.0) as u16)), 20));
    let _ = rows.push(Row::param_buf("TIE %", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.tie.probability * 100.0) as u16)), 21));
    let _ = rows.push(Row::param_buf("TIE MAX", draw::format_u16(cfg.tie.max_length as u16, &mut buf), 22));

    // --- VEL ---
    let _ = rows.push(Row::header("VEL"));
    let _ = rows.push(Row::param("MODE", vel_mode_name(cfg.velocity.mode), 23));
    let _ = rows.push(Row::param_buf("VEL LO", draw::format_u16(cfg.velocity.low as u16, &mut buf), 24));
    let _ = rows.push(Row::param_buf("VEL HI", draw::format_u16(cfg.velocity.high as u16, &mut buf), 25));

    // --- MOD ---
    let _ = rows.push(Row::header("MOD"));
    let _ = rows.push(Row::param("MODE", mod_mode_name(cfg.modulation.mode), 26));
    if cfg.modulation.mode == ModMode::Walk {
        let _ = rows.push(Row::subparam_buf("WALK D", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.modulation.walk_step_size * 100.0) as u16)), 29));
    }
    if cfg.modulation.mode == ModMode::Sync {
        let _ = rows.push(Row::subparam_buf("BIAS", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.modulation.sync_bias * 100.0) as u16)), 30));
    }
    let _ = rows.push(Row::param_buf("MOD LO", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.modulation.low * 100.0) as u16)), 27));
    let _ = rows.push(Row::param_buf("MOD HI", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.modulation.high * 100.0) as u16)), 28));
    let _ = rows.push(Row::param_buf("SLEW", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.modulation.slew * 100.0) as u16)), 31));
    let _ = rows.push(Row::param_buf("SLEW %", draw::fmt_buf(&mut buf, format_args!("{}%", (cfg.modulation.slew_probability * 100.0) as u16)), 32));

    // --- SAVE ---
    let _ = rows.push(Row::param("[ SAVE ]", "PUSH to name", 33));

    // Find the visual row index that corresponds to ui.rand_param
    // If exact match not found (param became invisible), find nearest param row
    let selected_visual = rows.iter().position(|r| r.param_idx == Some(ui.rand_param))
        .unwrap_or_else(|| {
            // Find closest param row with idx <= rand_param
            rows.iter().enumerate()
                .filter(|(_, r)| r.param_idx.is_some())
                .min_by_key(|(_, r)| {
                    let idx = r.param_idx.unwrap_or(0) as i32;
                    (idx - ui.rand_param as i32).abs()
                })
                .map(|(i, _)| i)
                .unwrap_or(0)
        });

    // Render the visible rows
    let total_rows = rows.len();
    let list_y = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
    let row_h = layout::ROW_H as i32;
    let max_visible =
        ((layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H) / layout::ROW_H)
            as usize;

    let scroll = if selected_visual >= max_visible {
        selected_visual - max_visible + 1
    } else {
        0
    };

    for i in scroll..(scroll + max_visible).min(total_rows) {
        let y = list_y + (i - scroll) as i32 * row_h;
        let is_sel = i == selected_visual;
        let row = &rows[i];

        match row.kind {
            RowKind::Header => draw_section(display, y, row.label),
            RowKind::Param | RowKind::Subparam => {
                draw_row(display, y, row.label, &row.value, color, is_sel);
            }
        }
    }

    // Scroll indicator
    let bar_h = layout::CONTENT_H - layout::EDIT_HEADER_H - layout::EDIT_FOOTER_H;
    draw::scroll_bar(display, list_y, bar_h, scroll, total_rows, max_visible, color);

    // Footer
    let footer_y = layout::LCD_H as i32 - layout::EDIT_FOOTER_H as i32;
    draw::fill_rect(
        display,
        0,
        footer_y,
        layout::LCD_W,
        layout::EDIT_FOOTER_H,
        colors::STATUS_BAR,
    );

    // Dropdown overlay — drawn after footer so it renders on top
    if ui.rand_dropdown_open {
        let vi = selected_visual.saturating_sub(scroll);
        let anchor_y = list_y + vi as i32 * row_h;
        let mut dd = crate::types::DropdownState {
            open: true,
            items: heapless::Vec::new(),
            selected: 0,
        };
        build_rand_dropdown(state, ui, &mut dd);
        let bounds_top = layout::CONTENT_Y as i32 + layout::EDIT_HEADER_H as i32;
        let bounds_bottom = footer_y;
        draw::dropdown_bounded(display, &dd, anchor_y, color, bounds_top, bounds_bottom);
    }
}

// ── Row model ──────────────────────────────────────────────────────

#[derive(Clone, Copy)]
enum RowKind {
    Header,
    Param,
    Subparam,
}

#[derive(Clone)]
struct Row {
    kind: RowKind,
    label: &'static str,
    value: heapless::String<20>,
    param_idx: Option<u8>, // mode machine param index (None for headers)
}

impl Row {
    fn header(label: &'static str) -> Self {
        Self { kind: RowKind::Header, label, value: heapless::String::new(), param_idx: None }
    }

    fn param(label: &'static str, value: &str, idx: u8) -> Self {
        let mut s = heapless::String::new();
        for c in value.chars() {
            if s.push(c).is_err() { break; }
        }
        Self { kind: RowKind::Param, label, value: s, param_idx: Some(idx) }
    }

    fn param_buf(label: &'static str, value: &str, idx: u8) -> Self {
        Self::param(label, value, idx)
    }

    fn subparam(label: &'static str, value: &str, idx: u8) -> Self {
        let mut s = heapless::String::new();
        for c in value.chars() {
            if s.push(c).is_err() { break; }
        }
        Self { kind: RowKind::Subparam, label, value: s, param_idx: Some(idx) }
    }

    fn subparam_buf(label: &'static str, value: &str, idx: u8) -> Self {
        Self::subparam(label, value, idx)
    }
}

// ── Draw helpers ───────────────────────────────────────────────────

fn draw_section<D: DrawTarget<Color = Rgb565>>(display: &mut D, y: i32, label: &str) {
    let row_h = layout::ROW_H as i32;
    let center_x = layout::LCD_W as i32 / 2;
    let text_w = label.len() as i32 * layout::CHAR_W as i32;
    let gap = 6; // padding around text
    // Left line segment
    draw::fill_rect(display, layout::PAD as i32, y + row_h / 2, (center_x - text_w / 2 - gap - layout::PAD as i32) as u32, 1, colors::TEXT_DIM);
    // Right line segment
    let right_start = center_x + text_w / 2 + gap;
    draw::fill_rect(display, right_start, y + row_h / 2, (layout::LCD_W as i32 - layout::PAD as i32 - right_start) as u32, 1, colors::TEXT_DIM);
    // Text (no line behind it)
    draw::text_center(display, center_x, y + 5, label, colors::TEXT_DIM);
}

fn draw_row<D: DrawTarget<Color = Rgb565>>(
    display: &mut D,
    y: i32,
    label: &str,
    value: &str,
    color: Rgb565,
    selected: bool,
) {
    if selected {
        draw::fill_rect(display, 0, y, layout::LCD_W, layout::ROW_H, colors::SELECTED_ROW);
        draw::text(display, layout::PAD as i32, y + 5, ">", colors::TEXT_BRIGHT);
    }
    let label_color = if selected { colors::TEXT } else { colors::TEXT_DIM };
    draw::text(display, layout::PAD as i32 + 16, y + 5, label, label_color);
    let val_color = if selected { colors::TEXT_BRIGHT } else { color };
    draw::text_right(
        display,
        layout::LCD_W as i32 - layout::PAD as i32 - 6,
        y + 5,
        value,
        val_color,
    );
}

// ── Dropdown builder ──────────────────────────────────────────────

fn build_rand_dropdown(
    state: &SequencerState,
    ui: &UiState,
    dd: &mut crate::types::DropdownState,
) {
    use requencer_engine::mode_machine::rand_param_at;

    let param = rand_param_at(ui.rand_param);
    let t = ui.selected_track as usize;
    let cfg = &state.random_configs[t];

    match param {
        requencer_engine::mode_machine::RandParamId::Preset => {
            let factory = presets::get_presets();
            for p in &factory {
                let mut s = heapless::String::new();
                for c in p.name.chars() { if s.push(c).is_err() { break; } }
                let _ = dd.items.push(s);
            }
            for p in &state.user_presets {
                let mut s = heapless::String::new();
                for c in p.name.chars() { if s.push(c).is_err() { break; } }
                let _ = dd.items.push(s);
            }
            dd.selected = ui.rand_preset_index;
        }
        requencer_engine::mode_machine::RandParamId::PitchMode => {
            for name in &["RAND", "ARP", "WALK", "RISE", "FALL"] {
                let mut s = heapless::String::new();
                let _ = s.push_str(name);
                let _ = dd.items.push(s);
            }
            dd.selected = match cfg.pitch.mode {
                PitchMode::Random => 0, PitchMode::Arp => 1,
                PitchMode::Walk => 2, PitchMode::Rise => 3, PitchMode::Fall => 4,
            };
        }
        requencer_engine::mode_machine::RandParamId::PitchScale => {
            let scales = requencer_engine::scales::Scales::ALL;
            for sc in scales {
                let mut s = heapless::String::new();
                for c in sc.name.chars() { if s.push(c).is_err() { break; } }
                let _ = dd.items.push(s);
            }
            let cur = scales.iter().position(|s| *s == cfg.pitch.scale).unwrap_or(0);
            dd.selected = cur as u8;
        }
        requencer_engine::mode_machine::RandParamId::GateMode => {
            for name in &["RAND", "EUCL", "SYNC", "CLST"] {
                let mut s = heapless::String::new();
                let _ = s.push_str(name);
                let _ = dd.items.push(s);
            }
            dd.selected = match cfg.gate.mode {
                GateAlgo::Random => 0, GateAlgo::Euclidean => 1,
                GateAlgo::Sync => 2, GateAlgo::Cluster => 3,
            };
        }
        requencer_engine::mode_machine::RandParamId::VelocityMode => {
            for name in &["RAND", "ACNT", "SYNC", "RISE", "FALL", "WALK"] {
                let mut s = heapless::String::new();
                let _ = s.push_str(name);
                let _ = dd.items.push(s);
            }
            dd.selected = match cfg.velocity.mode {
                VelocityMode::Random => 0, VelocityMode::Accent => 1,
                VelocityMode::Sync => 2, VelocityMode::Rise => 3,
                VelocityMode::Fall => 4, VelocityMode::Walk => 5,
            };
        }
        requencer_engine::mode_machine::RandParamId::ModMode => {
            for name in &["RAND", "RISE", "FALL", "VEE", "HILL", "SYNC", "WALK"] {
                let mut s = heapless::String::new();
                let _ = s.push_str(name);
                let _ = dd.items.push(s);
            }
            dd.selected = match cfg.modulation.mode {
                ModMode::Random => 0, ModMode::Rise => 1, ModMode::Fall => 2,
                ModMode::Vee => 3, ModMode::Hill => 4, ModMode::Sync => 5,
                ModMode::Walk => 6,
            };
        }
        _ => {
            // No dropdown for non-discrete params
            dd.open = false;
        }
    }
}

// ── Name helpers ───────────────────────────────────────────────────

fn note_name(midi: u8, buf: &mut [u8; 16]) -> &str {
    let (name, octave) = colors::midi_note_name(midi);
    draw::fmt_buf(buf, format_args!("{}{}", name, octave))
}

fn pitch_mode_name(m: PitchMode) -> &'static str {
    match m {
        PitchMode::Random => "RAND",
        PitchMode::Arp => "ARP",
        PitchMode::Walk => "WALK",
        PitchMode::Rise => "RISE",
        PitchMode::Fall => "FALL",
    }
}

fn arp_dir_name(d: PitchArpDirection) -> &'static str {
    match d {
        PitchArpDirection::Up => "UP",
        PitchArpDirection::Down => "DOWN",
        PitchArpDirection::UpDown => "UP/DOWN",
        PitchArpDirection::Random => "RANDOM",
    }
}

fn gate_mode_name(m: GateAlgo) -> &'static str {
    match m {
        GateAlgo::Random => "RAND",
        GateAlgo::Euclidean => "EUCL",
        GateAlgo::Sync => "SYNC",
        GateAlgo::Cluster => "CLST",
    }
}

fn vel_mode_name(m: VelocityMode) -> &'static str {
    match m {
        VelocityMode::Random => "RAND",
        VelocityMode::Accent => "ACNT",
        VelocityMode::Sync => "SYNC",
        VelocityMode::Rise => "RISE",
        VelocityMode::Fall => "FALL",
        VelocityMode::Walk => "WALK",
    }
}

fn mod_mode_name(m: ModMode) -> &'static str {
    match m {
        ModMode::Random => "RAND",
        ModMode::Rise => "RISE",
        ModMode::Fall => "FALL",
        ModMode::Vee => "VEE",
        ModMode::Hill => "HILL",
        ModMode::Sync => "SYNC",
        ModMode::Walk => "WALK",
    }
}
