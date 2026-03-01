# Hardware Prototype Options

Research notes for building a physical MIDI prototype of Requencer. Evaluated dedicated platforms, dev boards, and hybrid approaches.

## Platforms Evaluated

### Electra One

MkII (~$600) / Mini (~$300). Lua-programmable MIDI controller with 480x320 color screen, 12 encoders, 36 buttons.

**Pros:** Purpose-built MIDI controller with scripting support, nice screen.

**Cons:** Standard Lua extension can't take over the screen for custom UI. Standalone Lua mode exists but the graphics API is experimental — rectangles only, no text rendering or pixel-level drawing. Not ready for a custom sequencer interface.

**Verdict:** Blocked by immature graphics API.

---

### Monome Norns

~$200-400 prebuilt. Lua sound computer with full pixel-level screen drawing and a mature scripting ecosystem.

**Pros:** Complete creative coding environment, active community, full screen control.

**Cons:** Only 3 encoders + 3 buttons — far too few for Requencer's per-track UI without heavy menu navigation. Monochrome 128x64 OLED.

**Verdict:** Great platform, wrong form factor.

---

### Zynthian V5

~$300-400 kit. Python on Raspberry Pi with touchscreen and 4 encoders.

**Pros:** Full Linux power, touchscreen, built-in step sequencer, open source.

**Cons:** Heavy platform for what we need. More of a synth/effects host than a blank canvas.

**Verdict:** Overkill — we'd use 5% of the platform.

---

### Dev Boards (Teensy, Daisy, ESP32, Pico)

Full freedom — write firmware in C/C++, wire up any components you want.

| Board | CPU | Notable | Price |
|-------|-----|---------|-------|
| Teensy 4.1 | ARM Cortex-M7 600MHz | USB MIDI native, teensy-eurorack shield available | ~$30 |
| Daisy Seed | ARM Cortex-M7 480MHz | Built for audio, codec included | ~$30 |
| ESP32-S3 | Dual-core 240MHz | WiFi/BLE, cheap | ~$8 |
| Raspberry Pi Pico | ARM Cortex-M0+ 133MHz | PIO for precise timing | ~$4 |

Teensy 4.1 + the teensy-eurorack shield is the closest path to a eurorack-native prototype with direct CV output. But all dev board approaches require wiring/soldering physical components (encoders, buttons, display, jacks).

**Verdict:** Maximum flexibility, maximum effort. Good for a final product, heavy for prototyping.

---

## Recommended Approach: Phone/Tablet + MIDI Controller

The simplest viable prototype uses what already exists:

1. **Screen** — Phone or tablet running Chrome with the Requencer web app
2. **Physical input** — Off-the-shelf USB/BLE MIDI controller for knobs and buttons
3. **Output** — Web MIDI from the browser to synths/eurorack

### Why this works

- The Requencer web app already renders the full UI on Canvas 2D
- No Tone.js needed in MIDI-only mode — just engine + canvas + Web MIDI
- Performance is fine without audio synthesis (Canvas 2D + pure TS engine = lightweight)
- Web MIDI API supports both USB and BLE MIDI controllers
- Zero hardware assembly required

### Architecture

```
┌──────────────┐  USB/BLE MIDI  ┌──────────────────────┐  MIDI out
│ MIDI         │ ──────────────>│ Phone/Tablet         │ ────────> synths /
│ Controller   │  CC/Note msgs  │ Chrome + Requencer   │           eurorack
│ (knobs+btns) │                │ (engine+canvas+MIDI) │
└──────────────┘                └──────────────────────┘
```

---

## Controller Options

| Controller | Encoders/Knobs | Pads/Buttons | Price | Notes |
|-----------|---------------|-------------|-------|-------|
| Arturia BeatStep | 16 encoders | 16 pads | ~$60 | Closest to 4x4 grid layout |
| Novation Launch Control XL | 24 knobs | 16 buttons + 8 faders | ~$150 | Most controls per dollar |
| AKAI APC Key 25 Mk2 | 8 knobs | 40 pads | ~$80 | Large pad grid |
| Korg nanoKONTROL2 | 8 knobs | 32 buttons + 8 faders | ~$50 | Cheapest, has transport controls |

The Arturia BeatStep is the best starting point — 16 encoders map naturally to per-step editing across 4 tracks.

---

## MIDI Output Feasibility

The engine already does the hard work. `NoteEvent` (`src/engine/types.ts:69`) carries gate, pitch, velocity, and mod per output — everything needed for MIDI Note On/Off messages.

`ToneOutput` (`src/io/tone-output.ts`) consumes these merged events for audio. A `MidiOutput` class would be a near-copy:

- `gate: true` + pitch + velocity → MIDI Note On
- `gate: false` → MIDI Note Off
- Subtrack independence (polyrhythmic lengths) is resolved by the engine before output — `MidiOutput` just sees flat `NoteEvent` arrays per tick

The 4 outputs map to 4 MIDI channels (or configurable channel assignments).

---

## Eurorack CV: The Last Mile

Standard MIDI-to-CV modules handle the conversion from MIDI back to analog CV:

- **Expert Sleepers FH-2** — 8 outputs, very configurable
- **Mutable Instruments Yarns** — 4 voices, built-in arpeggiator
- **Doepfer A-190 series** — simple 1-voice MIDI-to-CV

These split MIDI note messages into gate + pitch + velocity CV outputs — this is well-solved hardware.

**Limitation:** Continuous independent CV (e.g., MOD subtrack as free-running LFO, pitch modulation between gates) can't be represented as MIDI notes. This would need CC messages or direct CV output on future hardware. For Tier 1-2 roadmap features, MIDI output is sufficient.

---

## Summary

| Approach | Cost | Effort | Flexibility |
|----------|------|--------|-------------|
| Phone + MIDI controller | $50-150 | Low (software only) | Medium |
| Electra One | $300-600 | Medium | Low (API limitations) |
| Norns | $200-400 | Medium | Low (too few controls) |
| Dev board (Teensy) | $100-200 | High (hardware build) | High |

**Decision:** Start with phone/tablet + BeatStep. Build `MidiOutput` class, add Web MIDI input mapping. Graduate to Teensy/custom hardware only if the prototype validates the interaction design.
