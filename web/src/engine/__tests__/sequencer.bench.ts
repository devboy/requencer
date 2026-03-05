import { bench, describe } from 'vitest'
import { createSequencer, tick } from '../sequencer'

describe('sequencer tick', () => {
  bench('tick() — empty sequencer', () => {
    const seq = createSequencer()
    tick({ ...seq, transport: { ...seq.transport, playing: true } })
  })

  bench('tick() — all features active', () => {
    let seq = createSequencer()
    // Enable gates on all tracks
    for (let t = 0; t < 4; t++) {
      for (let s = 0; s < 16; s++) {
        seq.tracks[t].gate.steps[s] = { on: true, tie: false, length: 0.75, ratchet: 1 }
        seq.tracks[t].pitch.steps[s] = { note: 48 + (s % 12), slide: s % 4 === 0 ? 0.5 : 0 }
        seq.tracks[t].mod.steps[s] = { value: s / 16, slew: 0.3 }
      }
    }
    // Enable LFOs with different waveforms
    seq.lfoConfigs[0] = { ...seq.lfoConfigs[0], waveform: 'sine', depth: 1.0 }
    seq.lfoConfigs[1] = { ...seq.lfoConfigs[1], waveform: 'saw', depth: 0.8 }
    seq.lfoConfigs[2] = { ...seq.lfoConfigs[2], waveform: 'triangle', depth: 0.6 }
    seq.lfoConfigs[3] = { ...seq.lfoConfigs[3], waveform: 's+h', depth: 1.0 }
    // Enable variations with transforms
    for (let t = 0; t < 4; t++) {
      seq.variationPatterns[t] = {
        ...seq.variationPatterns[t],
        enabled: true,
        slots: [
          { transforms: [{ type: 'reverse', param: 0 }] },
          {
            transforms: [
              { type: 'rotate', param: 3 },
              { type: 'thin', param: 2 },
            ],
          },
          { transforms: [{ type: 'ping-pong', param: 0 }] },
          { transforms: [{ type: 'transpose', param: 5 }] },
        ],
      }
    }
    // Enable mutate (non-zero rates activate mutation)
    for (let t = 0; t < 4; t++) {
      seq.mutateConfigs[t] = { ...seq.mutateConfigs[t], gate: 0.3, pitch: 0.3, velocity: 0.3, mod: 0.3 }
    }
    seq = { ...seq, transport: { ...seq.transport, playing: true } }
    tick(seq)
  })

  bench('1000 sequential ticks (~4 bars)', () => {
    let seq = createSequencer()
    // Enable gates
    for (let t = 0; t < 4; t++) {
      for (let s = 0; s < 16; s++) {
        seq.tracks[t].gate.steps[s] = { on: s % 2 === 0, tie: false, length: 0.5, ratchet: 1 }
      }
    }
    seq = { ...seq, transport: { ...seq.transport, playing: true } }
    for (let i = 0; i < 1000; i++) {
      const result = tick(seq)
      seq = result.state
    }
  })

  bench('createSequencer() init cost', () => {
    createSequencer()
  })
})
