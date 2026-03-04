import { describe, expect, it } from 'vitest'
import { computeDropdownLayout } from '../dropdown-popup'

// LCD constants: LCD_CONTENT_Y = 24, LCD_H = 320, ROW_H = 24
// Available content area: 24 to 320 = 296px

describe('computeDropdownLayout', () => {
  describe('small lists (all items visible)', () => {
    it('shows all 4 items for gate mode', () => {
      const layout = computeDropdownLayout(4, 0, 160)
      expect(layout.visibleCount).toBe(4)
      expect(layout.scrollStart).toBe(0)
    })

    it('shows all 7 items when exactly at max', () => {
      const layout = computeDropdownLayout(7, 3, 160)
      expect(layout.visibleCount).toBe(7)
      expect(layout.scrollStart).toBe(0)
    })
  })

  describe('scrolling lists (more items than maxVisible)', () => {
    it('caps at 7 visible for 10-item list', () => {
      const layout = computeDropdownLayout(10, 5, 160)
      expect(layout.visibleCount).toBe(7)
    })

    it('caps at 7 visible for 24-item list (transform catalog)', () => {
      const layout = computeDropdownLayout(24, 12, 160)
      expect(layout.visibleCount).toBe(7)
    })

    it('centers selected item in scroll window', () => {
      // 10 items, selected = 5, centerIdx = 3
      // scrollStart = 5 - 3 = 2
      const layout = computeDropdownLayout(10, 5, 160)
      expect(layout.scrollStart).toBe(2)
    })

    it('clamps scrollStart to 0 when selected is near beginning', () => {
      const layout = computeDropdownLayout(10, 1, 160)
      expect(layout.scrollStart).toBe(0)
    })

    it('clamps scrollStart to totalItems - visibleCount when selected is near end', () => {
      const layout = computeDropdownLayout(10, 9, 160)
      expect(layout.scrollStart).toBe(3) // 10 - 7 = 3
    })
  })

  describe('vertical position clamping', () => {
    it('clamps popup to LCD top when anchor is near top', () => {
      // anchorY = 30, which is near the top (LCD_CONTENT_Y = 24)
      const layout = computeDropdownLayout(4, 0, 30)
      expect(layout.popupTop).toBeGreaterThanOrEqual(24) // LCD_CONTENT_Y
    })

    it('clamps popup to LCD bottom when anchor is near bottom', () => {
      // anchorY = 310, near the bottom (LCD_H = 320)
      const layout = computeDropdownLayout(7, 0, 310)
      const popupBottom = layout.popupTop + layout.visibleCount * 24
      expect(popupBottom).toBeLessThanOrEqual(320) // LCD_H
    })

    it('positions popup in middle of screen when anchor is centered', () => {
      const layout = computeDropdownLayout(4, 2, 160)
      // Popup should be somewhere reasonable in the middle area
      expect(layout.popupTop).toBeGreaterThan(60)
      expect(layout.popupTop).toBeLessThan(250)
    })
  })

  describe('edge detection — reducing visible count', () => {
    it('reduces visible count when near bottom edge with large list', () => {
      // anchorY very close to bottom, only a few rows fit
      const layout = computeDropdownLayout(10, 0, 310)
      const popupBottom = layout.popupTop + layout.visibleCount * 24
      expect(popupBottom).toBeLessThanOrEqual(320)
      // Must show at least 1 item
      expect(layout.visibleCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('custom maxVisible', () => {
    it('respects maxVisible override', () => {
      const layout = computeDropdownLayout(24, 12, 160, 5)
      expect(layout.visibleCount).toBe(5)
    })

    it('does not exceed item count even with higher maxVisible', () => {
      const layout = computeDropdownLayout(3, 1, 160, 7)
      expect(layout.visibleCount).toBe(3)
    })
  })
})
