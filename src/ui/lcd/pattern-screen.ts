/**
 * LCD Pattern screen — scrollable list: SAVE action + individual saved patterns.
 * Enc A scrolls, Enc A push to save or load, CLR to delete.
 */

import type { SequencerState } from '../../engine/types'
import { COLORS } from '../colors'
import type { UIState } from '../hw-types'
import { getPatternRows } from '../pattern-rows'
import { drawText, fillRect, LCD_CONTENT_H, LCD_CONTENT_Y, LCD_W } from '../renderer'

const PAD = 8
const HEADER_H = 30
const ROW_H = 24
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 2
const LABEL_X = PAD + 18
const VALUE_X = LCD_W - PAD

export function renderPattern(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const rows = getPatternRows(engine)

  // Header
  drawText(ctx, `PATTERN — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'ENC A:\u25B2\u25BC  PUSH:act  CLR:del', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 11, 'right')

  const maxVisible = Math.floor((LCD_CONTENT_H - HEADER_H - 4) / ROW_H)
  const scrollOffset = Math.max(0, Math.min(ui.patternParam - Math.floor(maxVisible / 2), rows.length - maxVisible))

  for (let vi = 0; vi < maxVisible && scrollOffset + vi < rows.length; vi++) {
    const paramIdx = scrollOffset + vi
    const row = rows[paramIdx]
    const y = LIST_TOP + vi * ROW_H
    const isSelected = paramIdx === ui.patternParam

    if (row.type === 'header') {
      const lineY = y + ROW_H / 2
      ctx.strokeStyle = COLORS.textDim
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(PAD, lineY)
      ctx.lineTo(LCD_W - PAD, lineY)
      ctx.stroke()
      const labelW = row.label.length * 10 + 16
      fillRect(ctx, { x: PAD, y: lineY - 10, w: labelW, h: 20 }, COLORS.bg)
      drawText(ctx, ` ${row.label} `, PAD + 4, lineY + 5, COLORS.textDim, 16)
    } else if (row.type === 'pattern-item') {
      // Individual saved pattern row
      if (isSelected) {
        fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 2 }, `${trackColor}22`)
      }
      const cursorColor = isSelected ? trackColor : 'transparent'
      drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 2, cursorColor, 16)
      drawText(ctx, row.label, LABEL_X, y + ROW_H / 2 - 2, isSelected ? COLORS.text : COLORS.textDim, 16)
      drawText(ctx, `${row.patternIndex + 1}`, VALUE_X, y + ROW_H / 2 - 2, COLORS.textDim, 12, 'right')
    } else {
      // Action rows (save-track)
      if (isSelected) {
        fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 2 }, `${trackColor}22`)
      }
      const cursorColor = isSelected ? trackColor : 'transparent'
      drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 2, cursorColor, 16)

      const label = row.paramId === 'save-track' ? `[ SAVE T${ui.selectedTrack + 1} ]` : row.label
      drawText(ctx, label, LABEL_X, y + ROW_H / 2 - 2, isSelected ? COLORS.text : COLORS.textDim, 16)
    }
  }

  // Scroll indicator
  if (rows.length > maxVisible) {
    const barH = LCD_CONTENT_H - HEADER_H - 8
    const thumbH = Math.max(12, (maxVisible / rows.length) * barH)
    const thumbY = LIST_TOP + (scrollOffset / (rows.length - maxVisible)) * (barH - thumbH)
    fillRect(ctx, { x: LCD_W - 3, y: thumbY, w: 2, h: thumbH }, `${trackColor}44`)
  }
}
