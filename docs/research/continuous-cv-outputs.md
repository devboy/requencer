# Continuous CV Outputs: LFO, Slew, Pitch Slides

## The Problem

The engine's `tick()` function fires at discrete step boundaries (PPQN=24, so every 6 ticks = 1 sixteenth note at tempo). This works for **discrete events**: gate triggers, note selection, velocity values.

But several output behaviors need **continuous or sub-tick resolution** when driving real CV jacks on hardware:

| Feature | Nature | Why tick-based breaks |
|---------|--------|----------------------|
| **LFO** | Continuous waveform | Needs smooth analog output, not staircase steps |
| **Pitch slides/portamento** | Smooth transition | Glide from note A to B over N milliseconds |
| **Mod slew** | Interpolation | CV smoothly transitions between mod step values |
| **Gate length** | Timed pulse | Gate goes high at tick, low at some fraction of step window |
| **Ratchets** | Sub-step triggers | Multiple gate pulses within a single step |
| **Envelope/ADSR** | Continuous shape | If we ever add envelopes to CV outs |

## Architecture Options

### Option 1: High-Rate Render Loop (Recommended for Hardware)

Separate the engine into two layers:

```
Engine (tick-based)          Render/Output (sample-rate or timer-rate)
┌──────────────────┐        ┌──────────────────────────────┐
│ tick() → events  │───────▶│ render(dt) → CV/gate values  │
│ (step boundaries)│        │ (called at 1-10kHz)          │
└──────────────────┘        └──────────────────────────────┘
```

- **Engine** stays tick-based, produces `NoteEvent` structs with parameters (target pitch, slide time, gate length, ratchet count, etc.)
- **Output renderer** runs at a high rate (timer interrupt on RP2350, requestAnimationFrame or audio worklet on web) and interpolates:
  - LFO: compute waveform phase based on elapsed time/ticks
  - Pitch slide: lerp from current to target pitch over slide duration
  - Gate length: set gate high on event, schedule low after `gate_length * step_duration`
  - Ratchets: subdivide gate window into N sub-pulses
  - Mod slew: lerp between consecutive mod values

**Hardware implementation**: RP2350 timer interrupt at ~1-10kHz driving DAC updates.
**Web implementation**: Tone.js Transport schedules events; LFO/slides use `linearRampToValueAtTime()` etc.

### Option 2: Event + Duration Model

Engine emits events with durations/curves attached:

```rust
pub struct CvEvent {
    pub start_tick: u64,
    pub channel: u8,
    pub shape: CvShape,
}

pub enum CvShape {
    Constant(f32),
    LinearRamp { from: f32, to: f32, duration_ms: f32 },
    Gate { length_fraction: f32, ratchets: u8 },
    LfoSegment { waveform: LfoWaveform, phase_start: f32, phase_end: f32, depth: f32 },
}
```

The output layer then "plays back" these shapes. This keeps the engine pure but pushes all timing math into the shapes.

### Option 3: Hybrid — Engine Owns CV State

Engine maintains a `CvOutputState` per output that is updated each tick and also queryable between ticks:

```rust
pub struct CvOutputState {
    // Current targets (set on tick)
    pub target_pitch: f32,      // target in Hz or MIDI note
    pub slide_rate: f32,        // semitones per second
    pub gate_on: bool,
    pub gate_off_at: u64,       // tick when gate should go low
    pub ratchet_remaining: u8,

    // Continuous state (updated by render loop)
    pub current_pitch: f32,     // actual current value (mid-slide)
    pub current_mod: f32,       // actual current value (mid-slew)
    pub lfo_phase: f32,         // LFO accumulator
}
```

The engine sets targets on `tick()`, the render loop calls `update(dt)` to advance continuous values.

## Recommendation

**Option 1 (two-layer)** is cleanest and matches how real hardware works:

1. **Sequencer core** fires at musical time (ticks/steps) — already built
2. **CV output processor** runs at a fixed sample rate, independent of tempo:
   - On hardware: timer ISR at ~4kHz (250μs) updating 4x DAC channels via SPI
   - On web: AudioWorklet or scheduled Tone.js events
   - Takes the latest `NoteEvent` + ongoing state, produces instantaneous CV values

This means the engine's `tick()` doesn't need to change — it stays discrete. We add a new module:

```rust
// crates/engine/src/cv_output.rs

pub struct CvOutput {
    pub current_pitch_v: f32,     // current voltage (0-10V mapped)
    pub current_gate: bool,
    pub current_mod_v: f32,
    pub current_velocity_v: f32,

    // Internal state for interpolation
    target_pitch_v: f32,
    slide_rate: f32,              // V/second
    gate_off_time: f32,           // seconds from gate-on
    gate_elapsed: f32,
    ratchet_count: u8,
    ratchet_phase: u8,
    mod_target: f32,
    mod_slew_rate: f32,
}

impl CvOutput {
    /// Called when a new step triggers (from tick/NoteEvent)
    pub fn trigger(&mut self, event: &NoteEvent, step_duration_s: f32) { ... }

    /// Called at render rate (1-10kHz). Advances interpolation.
    pub fn update(&mut self, dt: f32) { ... }
}
```

## LFO Specifically

LFOs are interesting because they can be:
- **Synced to track clock** — phase resets or advances per step tick
- **Free-running** — phase advances by wall-clock time

In both cases, the actual waveform computation is continuous. The engine's `compute_lfo_value()` already takes a phase and produces a value. The render loop just needs to:
1. Advance the LFO phase each `dt`
2. Call the waveform function
3. Apply depth/offset scaling
4. Write to the CV output

For synced mode, the phase increment is tied to step duration. For free mode, it's `dt * frequency`.

## Hardware Constraints (RP2350)

- **DAC update rate**: MCP4728 quad DAC over I2C at 400kHz ≈ max ~5kHz update rate for 4 channels. SPI DACs (MCP4922) can go much faster (~100kHz+).
- **Timer resolution**: RP2350 has μs-resolution timers, so 1-10kHz ISR is trivial
- **CPU budget**: At 150MHz with FPU, a lerp + waveform calc per channel at 4kHz is negligible (~0.1% CPU)
- **Gate timing precision**: At 4kHz, gate length resolution is 250μs which is more than sufficient for musical timing

## Web Constraints

- **Tone.js** already handles continuous parameters via Web Audio API's `AudioParam`:
  - `linearRampToValueAtTime()` for pitch slides
  - `setValueAtTime()` for step changes
  - LFO can use an `OscillatorNode` connected to a parameter
- The web doesn't need a manual render loop for audio — Web Audio handles interpolation natively
- For **visual display** of CV values (showing LFO waveform, slide animation), the UI render loop (requestAnimationFrame at 60fps) can query the `CvOutput` state

## Open Questions

1. **Should `CvOutput` live in `crates/engine/` or in platform crates?**
   - Engine has the interpolation math (platform-agnostic)
   - Platform crates have the actual DAC/audio driver
   - Probably: interpolation logic in engine, DAC/audio driver in platform

2. **What about when multiple outputs share a source track?**
   - Two CV outs could route pitch from the same track but with different transpose
   - Each `CvOutput` instance handles its own interpolation independently

3. **Gate timing: tick-relative or absolute time?**
   - Gate length is expressed as fraction of step window
   - Step window duration depends on BPM + clock dividers
   - Probably: engine computes `gate_duration_seconds` and passes to CvOutput

4. **Ratchet timing model?**
   - Split step window into N equal sub-gates
   - Each sub-gate has the same length fraction applied
   - CvOutput handles the subdivision timing in its update loop
