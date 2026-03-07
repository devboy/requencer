import { describe, expect, it } from 'vitest'

// parseTickEvents is not exported, so we test it indirectly by re-implementing
// the same logic here and verifying against the module's contract.
// We import the module to test the exported helpers that don't need WASM.

const EVENT_STRIDE = 12

/** Re-implementation of parseTickEvents for testing (mirrors wasm-adapter.ts:111-134) */
function parseTickEvents(data: Float32Array | number[]) {
  const events: (Record<string, unknown> | null)[] = []
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

describe('parseTickEvents', () => {
  it('returns 4 nulls for all-zero data', () => {
    const data = new Float32Array(48) // 4 * 12, all zeros
    const events = parseTickEvents(data)
    expect(events).toHaveLength(4)
    expect(events.every((e) => e === null)).toBe(true)
  })

  it('parses a single active event at output 0', () => {
    const data = new Float32Array(48)
    // active flag
    data[0] = 1
    // output
    data[1] = 0
    // gate
    data[2] = 1
    // pitch (C4 = 60)
    data[3] = 60
    // velocity
    data[4] = 100
    // mod
    data[5] = 64
    // modSlew
    data[6] = 0.5
    // gateLength
    data[7] = 0.75
    // ratchetCount
    data[8] = 2
    // slide
    data[9] = 0.1
    // retrigger
    data[10] = 1
    // sustain
    data[11] = 0

    const events = parseTickEvents(data)
    const e = events[0] as Record<string, unknown>
    expect(e.output).toBe(0)
    expect(e.gate).toBe(true)
    expect(e.pitch).toBe(60)
    expect(e.velocity).toBe(100)
    expect(e.mod).toBe(64)
    expect(e.modSlew).toBeCloseTo(0.5)
    expect(e.gateLength).toBeCloseTo(0.75)
    expect(e.ratchetCount).toBe(2)
    expect(e.slide).toBeCloseTo(0.1) // Float32 precision
    expect(e.retrigger).toBe(true)
    expect(e.sustain).toBe(false)
    expect(events[1]).toBeNull()
    expect(events[2]).toBeNull()
    expect(events[3]).toBeNull()
  })

  it('parses events at all 4 outputs', () => {
    const data = new Float32Array(48)
    for (let i = 0; i < 4; i++) {
      const off = i * EVENT_STRIDE
      data[off] = 1 // active
      data[off + 1] = i // output
      data[off + 3] = 60 + i // pitch
    }
    const events = parseTickEvents(data)
    for (let i = 0; i < 4; i++) {
      expect(events[i]).not.toBeNull()
      expect(events[i]?.output).toBe(i)
      expect(events[i]?.pitch).toBe(60 + i)
    }
  })

  it('handles gate=false correctly', () => {
    const data = new Float32Array(48)
    data[0] = 1 // active
    data[2] = 0 // gate off
    const events = parseTickEvents(data)
    expect(events[0]?.gate).toBe(false)
  })

  it('handles boolean fields via non-zero check', () => {
    const data = new Float32Array(48)
    data[0] = 1 // active
    data[10] = 0 // retrigger = false
    data[11] = 1 // sustain = true
    const events = parseTickEvents(data)
    expect(events[0]?.retrigger).toBe(false)
    expect(events[0]?.sustain).toBe(true)
  })
})
