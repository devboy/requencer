import { describe, expect, it } from 'vitest'
import { maybeAutoOpenManual, shouldAutoOpenManual } from '../help-buttons'

function fakeStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

describe('shouldAutoOpenManual', () => {
  it('returns true on first visit and marks the store', () => {
    const store = fakeStore()
    expect(shouldAutoOpenManual(store)).toBe(true)
    expect(store.getItem('requencer-manual-seen')).toBe('1')
  })

  it('returns false on subsequent visits', () => {
    const store = fakeStore({ 'requencer-manual-seen': '1' })
    expect(shouldAutoOpenManual(store)).toBe(false)
  })
})

describe('maybeAutoOpenManual', () => {
  it('does not throw when the store setItem throws (privacy mode / storage full)', () => {
    const store = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    expect(() => maybeAutoOpenManual(store)).not.toThrow()
  })
})
