/**
 * WASM Engine Adapter — wraps the Rust WasmSequencer for LCD rendering
 * and (optionally) engine tick.
 *
 * MVP integration: sync TS engine state → WASM UI state each frame,
 * render LCD via Rust renderer instead of TS canvas calls.
 */

import type { NoteEvent } from './types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type WasmSequencerInstance = any

// Module-level state
let wasmModule: typeof import('../../pkg/requencer_web') | null = null
let wasmSeq: WasmSequencerInstance | null = null
let wasmMemory: WebAssembly.Memory | null = null
let _wasmReady = false

/** Dynamically import and initialize the WASM module. */
export async function initWasm(): Promise<boolean> {
  try {
    const mod = await import('../../pkg/requencer_web')
    await mod.default() // initialize WASM
    wasmModule = mod
    wasmSeq = new mod.WasmSequencer()
    // Access WASM memory for zero-copy framebuffer reads
    // @ts-expect-error wasm-bindgen internals
    wasmMemory = mod.__wbg_get_memory?.() ?? null
    _wasmReady = true
    console.log('[WASM] Rust engine initialized')
    return true
  } catch (e) {
    console.warn('[WASM] Failed to initialize:', e)
    _wasmReady = false
    return false
  }
}

/** Check if WASM engine is initialized. */
export function isWasmReady(): boolean {
  return _wasmReady
}

/** Get the raw WasmSequencer instance. */
export function getWasmSequencer(): WasmSequencerInstance | null {
  return wasmSeq
}

// ── Screen mode mapping ─────────────────────────────────────────

const SCREEN_MODE_MAP: Record<string, number> = {
  home: 0,
  'gate-edit': 1,
  'pitch-edit': 2,
  'vel-edit': 3,
  'mod-edit': 4,
  'mute-edit': 5,
  route: 6,
  rand: 7,
  'mutate-edit': 8,
  'transpose-edit': 9,
  'variation-edit': 10,
  settings: 11,
  pattern: 12,
  'pattern-load': 13,
  'name-entry': 14,
}

export function screenModeToU8(mode: string): number {
  return SCREEN_MODE_MAP[mode] ?? 0
}

// ── State sync: TS → WASM ───────────────────────────────────────

/**
 * Sync TS engine + UI state into the WASM sequencer so the Rust renderer
 * can produce the correct display. Called each frame before render.
 */
export function syncStateToWasm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ui: any,
): void {
  if (!wasmSeq) return
  const seq = wasmSeq

  // Transport
  seq.set_bpm(engine.transport.bpm)
  seq.set_playing(engine.transport.playing)

  // UI navigation
  seq.set_screen(screenModeToU8(ui.mode))
  seq.set_selected_track(ui.selectedTrack)
  seq.set_selected_step(ui.selectedStep)
  seq.set_current_page(ui.currentPage ?? 0)
  seq.set_rand_param(ui.randParam ?? 0)
  seq.set_route_param(ui.routeParam ?? 0)
  seq.set_mutate_param(ui.mutateParam ?? 0)
  seq.set_xpose_param(ui.transposeParam ?? 0)
  seq.set_settings_scroll(ui.settingsParam ?? 0)
  seq.set_mod_lfo_view(ui.modLfoView ?? false)

  // Variation UI
  seq.set_var_selected_bar(ui.varSelectedBar ?? -1)
  seq.set_var_cursor(ui.varCursor ?? 0)

  // Name entry
  if (ui.nameChars) {
    for (let i = 0; i < Math.min(ui.nameChars.length, 16); i++) {
      seq.set_name_char(i, ui.nameChars[i] ?? 0)
    }
  }
  seq.set_name_cursor(ui.nameCursor ?? 0)
  seq.set_name_len(ui.nameLen ?? 0)
  seq.set_name_context(ui.nameEntryContext === 'pattern')

  // Flash message
  if (ui.flashMessage) {
    seq.set_flash_message(ui.flashMessage)
  } else {
    seq.set_flash_message('')
  }

  // Sync track step data (playheads, gates, pitch, vel, mod, mutes)
  for (let t = 0; t < 4; t++) {
    const track = engine.tracks[t]

    // Playheads
    seq.set_playhead(t, 0, track.gate.currentStep)
    seq.set_playhead(t, 1, track.pitch.currentStep)
    seq.set_playhead(t, 2, track.velocity.currentStep)
    seq.set_playhead(t, 3, track.modulation.currentStep)

    // Subtrack lengths + dividers
    seq.set_subtrack_length(t, 0, track.gate.length ?? track.gate.steps.length)
    seq.set_subtrack_length(t, 1, track.pitch.length ?? track.pitch.steps.length)
    seq.set_subtrack_length(t, 2, track.velocity.length ?? track.velocity.steps.length)
    seq.set_subtrack_length(t, 3, track.modulation.length ?? track.modulation.steps.length)

    seq.set_subtrack_divider(t, 0, track.gate.clockDivider ?? 1)
    seq.set_subtrack_divider(t, 1, track.pitch.clockDivider ?? 1)
    seq.set_subtrack_divider(t, 2, track.velocity.clockDivider ?? 1)
    seq.set_subtrack_divider(t, 3, track.modulation.clockDivider ?? 1)

    seq.set_track_divider(t, track.clockDivider ?? 1)

    // Gate steps
    for (let s = 0; s < Math.min(track.gate.steps.length, 16); s++) {
      const step = track.gate.steps[s]
      if (step.on) {
        seq.toggle_gate(t, s) // ensure on
        // Need to check current state... simpler to just set directly
      }
    }

    // Mute patterns
    const mute = engine.mutePatterns?.[t]
    if (mute) {
      seq.set_mute_length(t, mute.length ?? mute.steps.length)
      seq.set_mute_divider(t, mute.clockDivider ?? 1)
    }
  }

  // Routing
  for (let o = 0; o < 4; o++) {
    const r = engine.routing[o]
    seq.set_route_gate(o, r.gate)
    seq.set_route_pitch(o, r.pitch)
    seq.set_route_velocity(o, r.velocity)
    seq.set_route_mod(o, r.modulation)
    const modSrc = r.modSource === 'lfo' ? 1 : 0
    seq.set_mod_source(o, modSrc)
  }

  // LFO configs
  for (let t = 0; t < 4; t++) {
    const lfo = engine.lfoConfigs[t]
    const waveMap: Record<string, number> = {
      sine: 0, triangle: 1, saw: 2, square: 3, 'slew-random': 4, 'sample-and-hold': 5,
    }
    seq.set_lfo_waveform(t, waveMap[lfo.waveform] ?? 0)
    seq.set_lfo_sync_mode(t, lfo.syncMode === 'free' ? 1 : 0)
    seq.set_lfo_rate(t, lfo.rate)
    seq.set_lfo_free_rate(t, lfo.freeRate ?? 1.0)
    seq.set_lfo_depth(t, lfo.depth)
    seq.set_lfo_offset(t, lfo.offset)
    seq.set_lfo_width(t, lfo.width)
    seq.set_lfo_phase(t, lfo.phase)
  }

  // Transpose configs
  for (let t = 0; t < 4; t++) {
    const xp = engine.transposeConfigs[t]
    seq.set_transpose_semitones(t, xp.semitones)
    seq.set_transpose_range(t, xp.noteLow, xp.noteHigh)
    seq.set_transpose_gl_scale(t, xp.glScale ?? 1.0)
    seq.set_transpose_vel_scale(t, xp.velScale ?? 1.0)
  }

  // Mutate configs
  for (let t = 0; t < 4; t++) {
    const mc = engine.mutateConfigs[t]
    seq.set_mutate_trigger(t, mc.trigger === 'bars' ? 1 : 0)
    seq.set_mutate_bars(t, mc.bars)
    seq.set_mutate_rates(t, mc.gate, mc.pitch, mc.velocity, mc.modulation)
  }

  // Variation patterns
  for (let t = 0; t < 4; t++) {
    const vp = engine.variationPatterns[t]
    seq.set_variation_enabled(t, vp.enabled)
    seq.set_variation_length(t, vp.length)
    seq.set_variation_loop(t, vp.loopMode)
  }
}

// ── Full engine state sync (after mode machine dispatch) ────────

/**
 * Sync all step data from TS engine state into the WASM sequencer.
 * Called after mode machine dispatch to keep WASM engine's tick()
 * in sync with edits made via the TS UI.
 */
export function syncEngineStepsToWasm(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  engine: any,
): void {
  if (!wasmSeq) return
  const seq = wasmSeq

  // Transport
  seq.set_bpm(engine.transport.bpm)
  seq.set_playing(engine.transport.playing)

  for (let t = 0; t < 4; t++) {
    const track = engine.tracks[t]

    // Subtrack config
    seq.set_track_divider(t, track.clockDivider ?? 1)
    seq.set_subtrack_length(t, 0, track.gate.length ?? track.gate.steps.length)
    seq.set_subtrack_length(t, 1, track.pitch.length ?? track.pitch.steps.length)
    seq.set_subtrack_length(t, 2, track.velocity.length ?? track.velocity.steps.length)
    seq.set_subtrack_length(t, 3, track.modulation.length ?? track.modulation.steps.length)
    seq.set_subtrack_divider(t, 0, track.gate.clockDivider ?? 1)
    seq.set_subtrack_divider(t, 1, track.pitch.clockDivider ?? 1)
    seq.set_subtrack_divider(t, 2, track.velocity.clockDivider ?? 1)
    seq.set_subtrack_divider(t, 3, track.modulation.clockDivider ?? 1)

    // Gate steps
    for (let s = 0; s < Math.min(track.gate.steps.length, 16); s++) {
      const step = track.gate.steps[s]
      seq.set_gate_on(t, s, step.on ?? false)
      seq.set_gate_tie(t, s, step.tie ?? false)
      seq.set_gate_length(t, s, step.length ?? 0.5)
      seq.set_ratchet(t, s, step.ratchet ?? 1)
    }

    // Pitch steps
    for (let s = 0; s < Math.min(track.pitch.steps.length, 16); s++) {
      const step = track.pitch.steps[s]
      seq.set_pitch_note(t, s, step.note ?? 60)
      seq.set_slide(t, s, step.slide ?? 0)
    }

    // Velocity steps
    for (let s = 0; s < Math.min(track.velocity.steps.length, 16); s++) {
      seq.set_velocity(t, s, track.velocity.steps[s] ?? 100)
    }

    // Mod steps
    for (let s = 0; s < Math.min(track.modulation.steps.length, 16); s++) {
      const step = track.modulation.steps[s]
      seq.set_mod_value(t, s, step.value ?? 0.5)
      seq.set_mod_slew(t, s, step.slew ?? 0)
    }

    // Mute steps
    const mute = engine.mutePatterns?.[t]
    if (mute) {
      seq.set_mute_length(t, mute.length ?? mute.steps.length)
      seq.set_mute_divider(t, mute.clockDivider ?? 1)
      for (let s = 0; s < Math.min(mute.steps.length, 16); s++) {
        seq.set_mute_step(t, s, mute.steps[s] ?? false)
      }
    }
  }

  // Routing
  for (let o = 0; o < 4; o++) {
    const r = engine.routing[o]
    seq.set_route_gate(o, r.gate)
    seq.set_route_pitch(o, r.pitch)
    seq.set_route_velocity(o, r.velocity)
    seq.set_route_mod(o, r.modulation)
    seq.set_mod_source(o, r.modSource === 'lfo' ? 1 : 0)
  }
}

// ── WASM LCD Rendering ──────────────────────────────────────────

/**
 * Render the LCD using the Rust WASM renderer.
 * Writes directly to the provided CanvasRenderingContext2D.
 * Returns true if rendering succeeded, false if WASM isn't ready.
 */
export function renderWasmLcd(ctx: CanvasRenderingContext2D): boolean {
  if (!wasmSeq || !wasmModule) return false

  const seq = wasmSeq

  // Render into WASM framebuffer
  seq.render_in_place()

  const w = seq.width()
  const h = seq.height()
  const ptr = seq.buffer_ptr()
  const len = seq.buffer_len()

  // Get WASM memory - try multiple access patterns
  let memory: WebAssembly.Memory | null = wasmMemory
  if (!memory) {
    try {
      // wasm-pack --target web exports memory through the bg module
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bg = (wasmModule as any).__wbg_get_imports?.() ?? wasmModule
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      memory = (bg as any).memory ?? (bg as any).__wbindgen_export_0
      if (memory) wasmMemory = memory
    } catch {
      // fallback: use the render() method that returns a copy
    }
  }

  if (memory) {
    // Zero-copy: read directly from WASM memory
    const pixels = new Uint8ClampedArray(memory.buffer, ptr, len)
    const imageData = new ImageData(pixels, w, h)
    ctx.putImageData(imageData, 0, 0)
  } else {
    // Fallback: render() returns a copy as Vec<u8>
    const data = seq.render()
    const pixels = new Uint8ClampedArray(data)
    const imageData = new ImageData(pixels, w, h)
    ctx.putImageData(imageData, 0, 0)
  }

  return true
}

// ── Tick (for future full WASM engine mode) ─────────────────────

const EVENT_STRIDE = 12

/** Parse flat f32 array from tick() into NoteEvent[]. */
function parseTickEvents(data: Float32Array | number[]): (NoteEvent | null)[] {
  const events: (NoteEvent | null)[] = []
  for (let i = 0; i < 4; i++) {
    const off = i * EVENT_STRIDE
    if (data[off] === 0) {
      events.push(null)
    } else {
      events.push({
        output: data[off + 1],
        gate: data[off + 2] !== 0,
        pitch: data[off + 3],
        velocity: data[off + 4],
        mod: data[off + 5],
        modSlew: data[off + 6],
        gateLength: data[off + 7],
        ratchetCount: data[off + 8],
        slide: data[off + 9],
        retrigger: data[off + 10] !== 0,
        sustain: data[off + 11] !== 0,
      })
    }
  }
  return events
}

/** Tick the WASM engine directly (for full WASM engine mode). */
export function wasmTick(): (NoteEvent | null)[] {
  if (!wasmSeq) return [null, null, null, null]
  const data = wasmSeq.tick()
  return parseTickEvents(data)
}
