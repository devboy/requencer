/**
 * WASM Engine Adapter — wraps the Rust WasmSequencer to match the TS engine API.
 *
 * This module provides a drop-in replacement for the TS sequencer's tick()
 * function and state management, backed by the Rust WASM engine.
 */

import type { NoteEvent, SequencerState } from './types'

// The WasmSequencer class from the Rust WASM build.
// Import path assumes wasm-pack output at web/pkg/.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let WasmSequencerClass: any = null

/** Dynamically import the WASM module (must be called once at startup). */
export async function initWasm(): Promise<void> {
  const mod = await import('../../pkg/requencer_web')
  await mod.default() // initialize WASM
  WasmSequencerClass = mod.WasmSequencer
}

/** Check if WASM engine is initialized. */
export function isWasmReady(): boolean {
  return WasmSequencerClass !== null
}

// Fields per event in the flat tick() result
const EVENT_STRIDE = 12

/**
 * Parse the flat f32 array from WasmSequencer.tick() into NoteEvent[] | null[].
 * Layout per event: [valid, output, gate, pitch, velocity, modulation,
 *   mod_slew, gate_length, ratchet_count, slide, retrigger, sustain]
 */
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

/**
 * WasmEngine wraps the Rust WasmSequencer and exposes a tick() method
 * compatible with the TS engine's handleEngineTick() expectations.
 *
 * Unlike the TS engine which returns a new state object on each tick,
 * WasmEngine mutates internal state. The TS SequencerState is lazily
 * synced only when needed (for UI rendering via the TS renderer).
 */
export class WasmEngine {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private seq: any

  constructor() {
    if (!WasmSequencerClass) {
      throw new Error('WASM not initialized. Call initWasm() first.')
    }
    this.seq = new WasmSequencerClass()
  }

  /** Get the underlying WasmSequencer for direct access. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get raw(): any {
    return this.seq
  }

  /** Advance engine by one tick. Returns events (Some or None per output). */
  tick(): (NoteEvent | null)[] {
    const data = this.seq.tick()
    return parseTickEvents(data)
  }

  /** Set BPM. */
  setBpm(bpm: number): void {
    this.seq.set_bpm(bpm)
  }

  /** Get BPM. */
  getBpm(): number {
    return this.seq.get_bpm()
  }

  /** Set playing state. */
  setPlaying(playing: boolean): void {
    this.seq.set_playing(playing)
  }

  /** Check if playing. */
  isPlaying(): boolean {
    return this.seq.is_playing()
  }

  /** Get master tick count. */
  getMasterTick(): number {
    return this.seq.get_master_tick()
  }

  /** Set clock source (0=internal, 1=midi, 2=external). */
  setClockSource(source: number): void {
    this.seq.set_clock_source(source)
  }

  /** Reset all playheads. */
  resetPlayheads(): void {
    this.seq.reset_playheads()
  }

  /** Randomize all subtracks of a track. */
  randomizeFullTrack(track: number, seed: number): void {
    this.seq.randomize_full_track(track, seed)
  }

  /** Randomize gate pattern. */
  randomizeGate(track: number, seed: number): void {
    this.seq.randomize_gate(track, seed)
  }

  /** Randomize pitch pattern. */
  randomizePitch(track: number, seed: number): void {
    this.seq.randomize_pitch(track, seed)
  }

  /** Randomize velocity pattern. */
  randomizeVelocity(track: number, seed: number): void {
    this.seq.randomize_velocity(track, seed)
  }

  /** Randomize mod pattern. */
  randomizeMod(track: number, seed: number): void {
    this.seq.randomize_mod(track, seed)
  }

  /** Clear track to defaults. */
  clearTrack(track: number): void {
    this.seq.clear_track_to_defaults(track)
  }

  /** Apply factory presets. */
  applyDefaultPresets(): void {
    this.seq.apply_default_presets()
  }

  /** Save pattern from track. */
  savePattern(track: number, name: string): void {
    this.seq.save_pattern(track, name)
  }

  /** Load pattern into track. */
  loadPattern(patternIndex: number, targetTrack: number): void {
    this.seq.load_pattern(patternIndex, targetTrack)
  }

  /** Delete pattern. */
  deletePattern(index: number): void {
    this.seq.delete_pattern(index)
  }

  // ── Rendering ─────────────────────────────────────────────────

  /** Get display dimensions. */
  getDisplaySize(): { width: number; height: number } {
    return { width: this.seq.width(), height: this.seq.height() }
  }

  /** Render to internal framebuffer and return pointer+length for zero-copy ImageData. */
  renderInPlace(): void {
    this.seq.render_in_place()
  }

  /** Get framebuffer pointer (for WASM memory direct access). */
  bufferPtr(): number {
    return this.seq.buffer_ptr()
  }

  /** Get framebuffer byte length. */
  bufferLen(): number {
    return this.seq.buffer_len()
  }

  // ── UI State sync ─────────────────────────────────────────────

  /** Set screen mode. */
  setScreen(mode: number): void {
    this.seq.set_screen(mode)
  }

  /** Set selected track. */
  setSelectedTrack(track: number): void {
    this.seq.set_selected_track(track)
  }

  /** Set selected step. */
  setSelectedStep(step: number): void {
    this.seq.set_selected_step(step)
  }

  /** Set current page. */
  setCurrentPage(page: number): void {
    this.seq.set_current_page(page)
  }

  /** Toggle gate step. */
  toggleGate(track: number, step: number): void {
    this.seq.toggle_gate(track, step)
  }

  /** Set pitch note. */
  setPitchNote(track: number, step: number, note: number): void {
    this.seq.set_pitch_note(track, step, note)
  }

  /** Set velocity. */
  setVelocity(track: number, step: number, vel: number): void {
    this.seq.set_velocity(track, step, vel)
  }

  /** Set gate length. */
  setGateLength(track: number, step: number, length: number): void {
    this.seq.set_gate_length(track, step, length)
  }

  /** Set ratchet count. */
  setRatchet(track: number, step: number, count: number): void {
    this.seq.set_ratchet(track, step, count)
  }

  /** Toggle tie. */
  toggleTie(track: number, step: number): void {
    this.seq.toggle_tie(track, step)
  }

  /** Set slide. */
  setSlide(track: number, step: number, slide: number): void {
    this.seq.set_slide(track, step, slide)
  }

  /** Set mod value. */
  setModValue(track: number, step: number, value: number): void {
    this.seq.set_mod_value(track, step, value)
  }

  /** Set mod slew. */
  setModSlew(track: number, step: number, slew: number): void {
    this.seq.set_mod_slew(track, step, slew)
  }

  /** Toggle mute. */
  toggleMute(track: number, step: number): void {
    this.seq.toggle_mute(track, step)
  }
}

/**
 * Map TS ScreenMode string to u8 for WASM.
 */
export function screenModeToU8(mode: string): number {
  const map: Record<string, number> = {
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
  return map[mode] ?? 0
}
