/**
 * LCD Randomizer screen — sectioned parameter list with preset selector.
 * Enc A scrolls params, Enc B adjusts values, Enc A push applies preset.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 *
 * Sections: PITCH, ARP, GATE, VEL, MOD, LFO
 * Sub-params conditionally hidden when parent feature is off.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'
import { getVisibleRows } from '../rand-rows'

const PAD = 8
const HEADER_H = 30
const ROW_H = 24
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 2
const LABEL_X = PAD + 18  // after cursor indicator
const SUBPARAM_X = PAD + 30  // indented sub-params
const VALUE_X = LCD_W - PAD

export function renderRand(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const visibleRows = getVisibleRows(engine, ui)

  // Header
  drawText(ctx, `RAND — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'ENC A:\u25B2\u25BC  ENC B:val  PUSH:apply', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  // Visible rows — fit as many as content area allows
  const maxVisible = Math.floor((LCD_CONTENT_H - HEADER_H - 4) / ROW_H)
  // Scroll window: keep selected param centered when possible
  const scrollOffset = Math.max(0, Math.min(ui.randParam - Math.floor(maxVisible / 2), visibleRows.length - maxVisible))

  for (let vi = 0; vi < maxVisible && scrollOffset + vi < visibleRows.length; vi++) {
    const paramIdx = scrollOffset + vi
    const row = visibleRows[paramIdx]
    const y = LIST_TOP + vi * ROW_H
    const isSelected = paramIdx === ui.randParam

    if (row.type === 'header') {
      // Section header: dimmed separator line with section name
      const lineY = y + ROW_H / 2
      const headerText = ` ${row.label} `
      // Draw dim line, then text on top
      ctx.strokeStyle = COLORS.textDim
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD, lineY)
      ctx.lineTo(LCD_W - PAD, lineY)
      ctx.stroke()
      // Section label over the line with background knockout
      const labelColor = isSelected ? trackColor : COLORS.textDim
      const labelW = row.label.length * 10 + 16  // approximate width for 16px font
      fillRect(ctx, { x: PAD, y: lineY - 10, w: labelW, h: 20 }, COLORS.bg)
      drawText(ctx, headerText, PAD + 4, lineY + 5, labelColor, 16)

      // Cursor on header row
      if (isSelected) {
        drawText(ctx, '\u25B8', PAD, lineY + 5, trackColor, 16)
      }
    } else {
      // Param or subparam row
      const isSubparam = row.type === 'subparam'
      const labelX = isSubparam ? SUBPARAM_X : LABEL_X

      // Highlight row background
      if (isSelected) {
        fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 2 }, `${trackColor}22`)
      }

      // Cursor indicator
      const cursorColor = isSelected ? trackColor : 'transparent'
      drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 2, cursorColor, 16)

      // Label
      const labelColor = isSelected ? COLORS.text : COLORS.textDim
      drawText(ctx, row.label, labelX, y + ROW_H / 2 - 2, labelColor, 16)

      // Value
      const value = row.getValue(engine, ui)
      const valueColor = isSelected ? '#ffffff' : COLORS.textDim
      drawText(ctx, value, VALUE_X, y + ROW_H / 2 - 2, valueColor, 16, 'right')
    }
  }

  // Scroll indicator if list is longer than visible area
  if (visibleRows.length > maxVisible) {
    const barH = LCD_CONTENT_H - HEADER_H - 8
    const thumbH = Math.max(12, (maxVisible / visibleRows.length) * barH)
    const thumbY = LIST_TOP + (scrollOffset / (visibleRows.length - maxVisible)) * (barH - thumbH)
    fillRect(ctx, { x: LCD_W - 3, y: thumbY, w: 2, h: thumbH }, `${trackColor}44`)
  }
}
