/**
 * LCD Drift screen — per-track mutation settings.
 * 6 rows: GATE, PITCH, VEL, MOD (each with rate %), TRIGGER, EVERY (N bars/loops).
 * Matches RAND screen layout (ROW_H=24, 16px fonts).
 *
 * Enc A turn: scroll params
 * Enc B turn: adjust rate (OFF → 1%-100%) / trigger / bars
 * Enc B push: back to home
 * T1-T4 (step buttons 0-3): switch track
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const PAD = 8
const HEADER_H = 30
const ROW_H = 24
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 2
const LABEL_X = PAD + 18
const VALUE_X = LCD_W - PAD

const SUBTRACK_LABELS = ['GATE', 'PITCH', 'VEL', 'MOD']
const SUBTRACK_KEYS = ['gate', 'pitch', 'velocity', 'mod'] as const

export function renderMutateEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const mc = engine.mutateConfigs[ui.selectedTrack]

  // Header
  drawText(ctx, `DRIFT — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  const unit = mc.trigger === 'bars' ? 'bar' : 'loop'
  drawText(ctx, `${mc.trigger.toUpperCase()}  ${mc.bars}${unit}`, LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 14, 'right')

  // 6 rows: 4 subtracks + trigger + bars
  for (let row = 0; row < 6; row++) {
    const y = LIST_TOP + row * ROW_H
    const isSelected = row === ui.mutateParam

    // Highlight selected row
    if (isSelected) {
      fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 2 }, `${trackColor}22`)
    }

    // Cursor
    const cursorColor = isSelected ? trackColor : 'transparent'
    drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 2, cursorColor, 16)

    if (row < 4) {
      // Subtrack row: label + rate bar + percentage
      const key = SUBTRACK_KEYS[row]
      const rate = mc[key]
      const label = SUBTRACK_LABELS[row]
      const labelColor = isSelected ? COLORS.text : COLORS.textDim

      drawText(ctx, label, LABEL_X, y + ROW_H / 2 - 2, labelColor, 16)

      // Rate bar
      const barX = PAD + 90
      const barW = 100
      const barH = 10
      const barY = y + ROW_H / 2 - 7
      fillRect(ctx, { x: barX, y: barY, w: barW, h: barH }, '#222233')
      const fillW = Math.round(barW * rate)
      if (fillW > 0) {
        fillRect(ctx, { x: barX, y: barY, w: fillW, h: barH }, rate > 0 ? trackColor : COLORS.textDim)
      }

      // Value text
      const valueText = rate === 0 ? 'OFF' : `${Math.round(rate * 100)}%`
      const valueColor = rate > 0 ? (isSelected ? '#ffffff' : trackColor) : COLORS.textDim
      drawText(ctx, valueText, VALUE_X, y + ROW_H / 2 - 2, valueColor, 16, 'right')
    } else if (row === 4) {
      // Trigger mode
      const labelColor = isSelected ? COLORS.text : COLORS.textDim
      drawText(ctx, 'TRIGGER', LABEL_X, y + ROW_H / 2 - 2, labelColor, 16)
      drawText(ctx, mc.trigger.toUpperCase(), VALUE_X, y + ROW_H / 2 - 2, isSelected ? '#ffaa00' : COLORS.textDim, 16, 'right')
    } else {
      // Every-N count (applies to both bars and loop modes)
      const labelColor = isSelected ? COLORS.text : COLORS.textDim
      drawText(ctx, 'EVERY', LABEL_X, y + ROW_H / 2 - 2, labelColor, 16)
      const unit = mc.trigger === 'bars' ? 'bar' : 'loop'
      const valueText = mc.bars === 1 ? `1 ${unit}` : `${mc.bars} ${unit}s`
      drawText(ctx, valueText, VALUE_X, y + ROW_H / 2 - 2, isSelected ? '#ffaa00' : COLORS.textDim, 16, 'right')
    }
  }

  // Bottom hint
  const hintY = LCD_CONTENT_Y + LCD_CONTENT_H - 12
  drawText(ctx, 'ENC A:▲▼ PUSH:all off  ENC B:rate  1-4:trk', PAD, hintY, COLORS.textDim, 12)
}
