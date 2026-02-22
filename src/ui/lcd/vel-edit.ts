/**
 * LCD Velocity Edit screen — velocity pattern with step select + encoder adjust.
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
const BAR_MAX_H = (AVAIL_H - ROW_GAP) / 2

export function renderVelEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const track = engine.tracks[ui.selectedTrack]
  const trackColor = COLORS.track[ui.selectedTrack]
  const pageOffset = ui.currentPage * 16
  const maxPage = Math.max(0, Math.ceil(track.velocity.length / 16) - 1)

  // Title
  drawText(ctx, `VEL — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)

  // Selected step info
  const selIdx = pageOffset + ui.selectedStep
  if (selIdx < track.velocity.length) {
    const vel = track.velocity.steps[selIdx]
    drawText(ctx, `${vel}`, PAD, LCD_CONTENT_Y + 36, COLORS.textBright, 16)
  }

  // Right side info
  let infoText = `LEN ${track.velocity.length}`
  if (track.velocity.clockDivider > 1) infoText += `  ÷${track.velocity.clockDivider}`
  if (maxPage > 0) infoText += `  P${ui.currentPage + 1}/${maxPage + 1}`
  drawText(ctx, infoText, LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 16, 'right')

  // Step bars — 2 rows of 8
  for (let row = 0; row < 2; row++) {
    const barBaseY = STEP_AREA_TOP + (row + 1) * BAR_MAX_H + row * ROW_GAP
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col
      const stepIdx = pageOffset + i
      const x = PAD + col * (STEP_W + COL_GAP)

      if (stepIdx >= track.velocity.length) {
        fillRect(ctx, { x, y: barBaseY - 2, w: STEP_W, h: 2 }, '#111118')
        continue
      }

      const normalized = track.velocity.steps[stepIdx] / 127
      const barH = Math.max(2, normalized * BAR_MAX_H)
      const barY = barBaseY - barH
      const isSelected = i === ui.selectedStep
      const color = isSelected ? COLORS.textBright : trackColor

      fillRect(ctx, { x, y: barY, w: STEP_W, h: barH }, color)

      if (isSelected) {
        strokeRect(ctx, { x: x - 1, y: barY - 1, w: STEP_W + 2, h: barH + 2 }, '#ffffff', 1)
      }

      // Playhead
      if (stepIdx === track.velocity.currentStep) {
        fillRect(ctx, { x, y: barBaseY + 2, w: STEP_W, h: 3 }, '#ffffff')
      }
    }
  }
}
