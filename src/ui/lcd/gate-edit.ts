/**
 * LCD Gate Edit screen — gate pattern with step toggle via 16 buttons.
 * 2×8 grid layout matching the physical step button grid.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, strokeRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const PAD = 8
const HEADER_H = 42
const STEP_AREA_TOP = LCD_CONTENT_Y + HEADER_H
const COLS = 8
const ROW_GAP = 8
const COL_GAP = 2
const STEP_W = (LCD_W - PAD * 2 - (COLS - 1) * COL_GAP) / COLS
const AVAIL_H = LCD_CONTENT_H - HEADER_H - 4
const STEP_H = (AVAIL_H - ROW_GAP) / 2

export function renderGateEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const track = engine.tracks[ui.selectedTrack]
  const trackColor = COLORS.track[ui.selectedTrack]
  const pageOffset = ui.currentPage * 16
  const maxPage = Math.max(0, Math.ceil(track.gate.length / 16) - 1)

  // Title
  drawText(ctx, `GATE — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)

  // Right side info
  let infoText = `LEN ${track.gate.length}`
  if (track.gate.clockDivider > 1) infoText += `  ÷${track.gate.clockDivider}`
  if (maxPage > 0) infoText += `  P${ui.currentPage + 1}/${maxPage + 1}`
  drawText(ctx, infoText, LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 16, 'right')

  // Step grid — 2 rows of 8
  for (let row = 0; row < 2; row++) {
    const rowY = STEP_AREA_TOP + row * (STEP_H + ROW_GAP)
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col
      const stepIdx = pageOffset + i
      const x = PAD + col * (STEP_W + COL_GAP)

      if (stepIdx >= track.gate.length) {
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: STEP_H }, '#111118')
      } else if (track.gate.steps[stepIdx]) {
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: STEP_H }, trackColor)
      } else {
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: STEP_H }, COLORS.trackDim[ui.selectedTrack])
      }

      // Playhead indicator
      if (stepIdx === track.gate.currentStep) {
        strokeRect(ctx, { x: x - 1, y: rowY - 1, w: STEP_W + 2, h: STEP_H + 2 }, '#ffffff', 2)
      }
    }
  }
}
