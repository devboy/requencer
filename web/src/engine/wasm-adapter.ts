/**
 * WASM Engine Adapter — wraps the Rust WasmSequencer.
 * WASM is the single source of truth for engine, renderer, and mode machine.
 * TS only handles I/O glue (clock, audio, MIDI, keyboard, panel).
 */

import type { NoteEvent } from './types'
import type { ClockSource } from './types'

// biome-ignore lint/suspicious/noExplicitAny: WASM module types not available at compile time
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
    // biome-ignore lint/suspicious/noExplicitAny: wasm-bindgen internals
    wasmMemory = (mod as any).__wbg_get_memory?.() ?? null
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

/** Reset the WasmSequencer instance (e.g. after a panic poisons the RefCell). */
export function resetWasmSequencer(): void {
  if (!wasmModule) return
  wasmSeq = new wasmModule.WasmSequencer()
  console.log('[WASM] Sequencer reset (fresh instance)')
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
      // biome-ignore lint/suspicious/noExplicitAny: wasm-bindgen internals
      const bg = (wasmModule as any).__wbg_get_imports?.() ?? wasmModule
      // biome-ignore lint/suspicious/noExplicitAny: wasm-bindgen internals
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

// ── Tick ─────────────────────────────────────────────────────────

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

/** Tick the WASM engine. */
export function wasmTick(): (NoteEvent | null)[] {
  if (!wasmSeq) return [null, null, null, null]
  const data = wasmSeq.tick()
  return parseTickEvents(data)
}

/**
 * Read playhead positions and master tick from the WASM engine
 * back into a thin transport object for drum machine sync.
 */
// biome-ignore lint/suspicious/noExplicitAny: thin transport object
export function syncPlayheadsFromWasm(transport: any): void {
  if (!wasmSeq) return
  transport.masterTick = wasmSeq.get_master_tick()
}

// ── Mode Machine Event Forwarding ────────────────────────────────

const SUBTRACK_MAP: Record<string, number> = { gate: 0, pitch: 1, velocity: 2, mod: 3 }
const FEATURE_MAP: Record<string, number> = {
  mute: 0, route: 1, rand: 2, mutate: 3, transpose: 4, variation: 5,
}

/** Forward a TS ControlEvent to the Rust mode machine via WASM. */
export function forwardEvent(event: import('../ui/hw-types').ControlEvent): void {
  if (!wasmSeq) return
  const seq = wasmSeq

  // Update system tick for CLR timeout
  seq.set_system_tick(Math.floor(performance.now()) & 0xFFFFFFFF)

  switch (event.type) {
    case 'encoder-a-turn':
      seq.handle_event(0, event.delta, 0)
      break
    case 'encoder-a-push':
      seq.handle_event(1, 0, 0)
      break
    case 'encoder-b-turn':
      seq.handle_event(2, event.delta, 0)
      break
    case 'encoder-b-push':
      seq.handle_event(3, 0, 0)
      break
    case 'back':
      seq.handle_event(4, 0, 0)
      break
    case 'play-stop':
      seq.handle_event(5, 0, 0)
      break
    case 'reset':
      seq.handle_event(6, 0, 0)
      break
    case 'track-select':
      seq.handle_event(7, event.track, 0)
      break
    case 'subtrack-select':
      seq.handle_event(8, SUBTRACK_MAP[event.subtrack] ?? 0, 0)
      break
    case 'feature-press':
      seq.handle_event(9, FEATURE_MAP[event.feature] ?? 0, 0)
      break
    case 'step-press':
      seq.handle_event(10, event.step, 0)
      break
    case 'hold-start': {
      const btn = event.button
      switch (btn.kind) {
        case 'track':
          seq.handle_event(11, 0, btn.track)
          break
        case 'subtrack':
          seq.handle_event(11, 1, SUBTRACK_MAP[btn.subtrack] ?? 0)
          break
        case 'feature':
          seq.handle_event(11, 2, FEATURE_MAP[btn.feature] ?? 0)
          break
        case 'step':
          seq.handle_event(11, 3, btn.step)
          break
      }
      break
    }
    case 'hold-end':
      seq.handle_event(12, 0, 0)
      break
    case 'settings-press':
      seq.handle_event(13, 0, 0)
      break
    case 'clr-press':
      seq.handle_event(14, 0, 0)
      break
    case 'pattern-press':
      seq.handle_event(15, 0, 0)
      break
    default:
      break
  }
}

export type WasmLedMode = 'off' | 'on' | 'dim' | 'flash'
export interface WasmLEDState {
  steps: WasmLedMode[]
  tracks: Array<'off' | 'on'>
  play: WasmLedMode
}

const LED_MODES: WasmLedMode[] = ['off', 'on', 'dim', 'flash']

/** Read LED state from the Rust mode machine. */
export function getWasmLedState(): WasmLEDState | null {
  if (!wasmSeq) return null
  const data: Uint8Array = wasmSeq.get_led_state()
  if (!data || data.length < 21) return null

  const steps: WasmLedMode[] = []
  for (let i = 0; i < 16; i++) {
    steps.push(LED_MODES[data[i]] ?? 'off')
  }

  const tracks: Array<'off' | 'on'> = []
  for (let i = 16; i < 20; i++) {
    tracks.push(data[i] ? 'on' : 'off')
  }

  const play = LED_MODES[data[20]] ?? 'off'

  return { steps, tracks, play }
}

/** Get the current screen mode from the Rust mode machine. */
export function getWasmScreenMode(): number {
  if (!wasmSeq) return 0
  return wasmSeq.get_mode()
}

/** Check and cancel CLR timeout in WASM mode. */
export function checkWasmClrTimeout(): void {
  if (!wasmSeq) return
  wasmSeq.set_system_tick(Math.floor(performance.now()) & 0xFFFFFFFF)
  wasmSeq.check_clr_timeout()
}

/** Read BPM from the Rust engine. */
export function getWasmBpm(): number {
  if (!wasmSeq) return 120
  return wasmSeq.get_bpm()
}

/** Read clock source from the Rust engine. */
export function getWasmClockSource(): ClockSource {
  if (!wasmSeq) return 'internal'
  const src = wasmSeq.get_clock_source()
  if (src === 1) return 'midi'
  if (src === 2) return 'external'
  return 'internal'
}

/** Whether CLR confirm is pending. */
export function getWasmClrPending(): boolean {
  if (!wasmSeq) return false
  return wasmSeq.get_clr_pending()
}

/** Read MIDI enabled state from Rust. */
export function getWasmMidiEnabled(): boolean {
  if (!wasmSeq) return false
  return wasmSeq.get_midi_enabled()
}

/** Read MIDI clock out state from Rust. */
export function getWasmMidiClockOut(): boolean {
  if (!wasmSeq) return false
  return wasmSeq.get_midi_clock_out()
}

/** Read MIDI channel for an output (1-16). */
export function getWasmMidiChannel(output: number): number {
  if (!wasmSeq) return output + 1
  return wasmSeq.get_midi_channel(output)
}

/** Export full sequencer state as serialized bytes. */
export function exportWasmState(): Uint8Array {
  if (!wasmSeq) return new Uint8Array(0)
  return wasmSeq.export_state()
}

/** Import sequencer state from serialized bytes. Returns true on success. */
export function importWasmState(data: Uint8Array): boolean {
  if (!wasmSeq) return false
  try {
    return wasmSeq.import_state(data)
  } catch (e) {
    console.warn('[WASM] import_state failed (corrupt data?):', e)
    return false
  }
}

/** Export saved patterns and user presets as serialized bytes. */
export function exportWasmLibrary(): Uint8Array {
  if (!wasmSeq) return new Uint8Array(0)
  return wasmSeq.export_library()
}

/** Import saved patterns and user presets from serialized bytes. Returns true on success. */
export function importWasmLibrary(data: Uint8Array): boolean {
  if (!wasmSeq) return false
  try {
    return wasmSeq.import_library(data)
  } catch (e) {
    console.warn('[WASM] import_library failed (corrupt data?):', e)
    return false
  }
}
