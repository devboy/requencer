import { describe, expect, it } from 'vitest'
import { hitTest, type Rect } from '../renderer'

describe('hitTest', () => {
  const rect: Rect = { x: 10, y: 20, w: 100, h: 50 }

  it('returns true for point inside rect', () => {
    expect(hitTest(rect, 50, 40)).toBe(true)
  })

  it('returns true for point at top-left corner (inclusive)', () => {
    expect(hitTest(rect, 10, 20)).toBe(true)
  })

  it('returns false for point at bottom-right edge (exclusive)', () => {
    expect(hitTest(rect, 110, 70)).toBe(false)
  })

  it('returns false for point above rect', () => {
    expect(hitTest(rect, 50, 19)).toBe(false)
  })

  it('returns false for point below rect', () => {
    expect(hitTest(rect, 50, 70)).toBe(false)
  })

  it('returns false for point left of rect', () => {
    expect(hitTest(rect, 9, 40)).toBe(false)
  })

  it('returns false for point right of rect', () => {
    expect(hitTest(rect, 110, 40)).toBe(false)
  })

  it('returns true for point at last valid pixel', () => {
    expect(hitTest(rect, 109, 69)).toBe(true)
  })

  it('works with zero-origin rect', () => {
    const r: Rect = { x: 0, y: 0, w: 10, h: 10 }
    expect(hitTest(r, 0, 0)).toBe(true)
    expect(hitTest(r, 9, 9)).toBe(true)
    expect(hitTest(r, 10, 10)).toBe(false)
  })
})
