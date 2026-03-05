/**
 * Reusable dropdown popup — canvas-based scrollable item list.
 * Used by RAND screen (preset/scale/mode selectors) and variation screen (transform catalog).
 */

import { COLORS } from '../colors'
import { drawText, fillRect, LCD_CONTENT_Y, LCD_H, strokeRect } from '../renderer'

const ROW_H = 24
const POPUP_BG = '#0c0c20'
const DEFAULT_MAX_VISIBLE = 7

export interface DropdownLayout {
  popupTop: number
  visibleCount: number
  scrollStart: number
}

/**
 * Compute popup position, visible item count, and scroll offset.
 * Pure function — no canvas dependency, fully testable.
 */
export function computeDropdownLayout(
  totalItems: number,
  selected: number,
  anchorY: number,
  maxVisible?: number,
): DropdownLayout {
  const lcdTop = LCD_CONTENT_Y
  const lcdBottom = LCD_H

  let visibleCount = Math.min(totalItems, maxVisible ?? DEFAULT_MAX_VISIBLE)
  let popupH = visibleCount * ROW_H
  const centerIdx = Math.floor(visibleCount / 2)

  // Position popup so selected item aligns with anchorY, clamped to LCD bounds
  const idealTop = anchorY - centerIdx * ROW_H
  const popupTop = Math.max(lcdTop, Math.min(idealTop, lcdBottom - popupH))

  // Edge detection: reduce visible count if popup still doesn't fit
  const availableH = lcdBottom - popupTop
  if (availableH < popupH) {
    visibleCount = Math.max(1, Math.floor(availableH / ROW_H))
    popupH = visibleCount * ROW_H
  }

  // Scroll window centered on selection
  let scrollStart = selected - Math.floor(visibleCount / 2)
  scrollStart = Math.max(0, Math.min(scrollStart, totalItems - visibleCount))

  return { popupTop, visibleCount, scrollStart }
}

export interface DropdownConfig {
  items: string[]
  selected: number
  anchorY: number
  trackColor: string
  popupX: number
  popupW: number
  maxVisible?: number
}

/**
 * Render a dropdown popup overlay on the LCD canvas.
 */
export function renderDropdownPopup(ctx: CanvasRenderingContext2D, config: DropdownConfig): void {
  const { items, selected, anchorY, trackColor, popupX, popupW, maxVisible } = config
  const { popupTop, visibleCount, scrollStart } = computeDropdownLayout(items.length, selected, anchorY, maxVisible)

  const popupH = visibleCount * ROW_H

  // Background + border
  const popupRect = { x: popupX - 4, y: popupTop - 2, w: popupW + 8, h: popupH + 4 }
  fillRect(ctx, popupRect, POPUP_BG)
  strokeRect(ctx, popupRect, `${trackColor}66`, 1)

  // Draw items
  for (let vi = 0; vi < visibleCount; vi++) {
    const itemIdx = scrollStart + vi
    if (itemIdx < 0 || itemIdx >= items.length) continue

    const y = popupTop + vi * ROW_H
    const isSelected = itemIdx === selected

    if (isSelected) {
      fillRect(ctx, { x: popupX - 4, y, w: popupW + 8, h: ROW_H }, `${trackColor}33`)
      drawText(ctx, '\u25B8', popupX, y + ROW_H / 2 - 2, trackColor, 16)
      drawText(ctx, items[itemIdx], popupX + 20, y + ROW_H / 2 - 2, COLORS.text, 16)
    } else {
      drawText(ctx, items[itemIdx], popupX + 20, y + ROW_H / 2 - 2, COLORS.textDim, 16)
    }
  }
}
