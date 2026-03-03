/**
 * LCD Gate Edit screen — gate pattern with step toggle via 16 buttons.
 * 2×8 grid layout matching the physical step button grid.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import { COLORS } from '../colors'
import type { UIState } from '../hw-types'
import { drawText, fillRect, LCD_CONTENT_H, LCD_CONTENT_Y, LCD_W, strokeRect } from '../renderer'

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

  const selectedStepIdx = ui.selectedStep >= 0 ? ui.currentPage * 16 + ui.selectedStep : -1

  // Title
  drawText(ctx, `GATE — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)

  // Right side info: show gate length + ratchet when a step is selected
  let infoText = ''
  if (selectedStepIdx >= 0 && selectedStepIdx < track.gate.length) {
    const step = track.gate.steps[selectedStepIdx]
    const gl = Math.round(step.length * 100)
    const rc = step.ratchet
    infoText = `GL:${gl}%`
    if (rc > 1) infoText += ` R:${rc}x`
  }
  if (track.gate.clockDivider > 1) infoText += `  ÷${track.gate.clockDivider}`
  if (maxPage > 0) infoText += `  P${ui.currentPage + 1}/${maxPage + 1}`
  if (!infoText) infoText = `LEN ${track.gate.length}`
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
      } else if (track.gate.steps[stepIdx].tie) {
        // Tied step: filled with track color at reduced opacity
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: STEP_H }, COLORS.trackDim[ui.selectedTrack])
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: STEP_H }, `${trackColor}88`)

        // Draw connecting bridge from previous step
        if (col > 0) {
          // Horizontal bridge across the gap between this step and the previous
          const bridgeY = rowY + Math.round(STEP_H / 2) - 2
          fillRect(ctx, { x: x - COL_GAP, y: bridgeY, w: COL_GAP, h: 4 }, trackColor)
        } else if (row > 0) {
          // Row wrap: draw indicator at left edge of this row and right edge of previous row
          const bridgeY = rowY + Math.round(STEP_H / 2) - 2
          fillRect(ctx, { x: PAD, y: bridgeY, w: 3, h: 4 }, trackColor)
          // Previous row right edge indicator
          const prevRowY = STEP_AREA_TOP + (row - 1) * (STEP_H + ROW_GAP)
          const prevRowRight = PAD + (COLS - 1) * (STEP_W + COL_GAP) + STEP_W
          fillRect(ctx, { x: prevRowRight - 3, y: prevRowY + Math.round(STEP_H / 2) - 2, w: 3, h: 4 }, trackColor)
        }
      } else if (track.gate.steps[stepIdx].on) {
        // Gate ON: show gate length as filled portion of step cell
        const step = track.gate.steps[stepIdx]
        const barH = Math.round(STEP_H * step.length)
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: STEP_H }, COLORS.trackDim[ui.selectedTrack])
        fillRect(ctx, { x, y: rowY + (STEP_H - barH), w: STEP_W, h: barH }, trackColor)

        // Ratchet tick marks — horizontal lines dividing the bar
        if (step.ratchet > 1) {
          const rc = step.ratchet
          for (let r = 1; r < rc; r++) {
            const tickY = rowY + (STEP_H - barH) + Math.round((barH / rc) * r)
            fillRect(ctx, { x: x + 2, y: tickY, w: STEP_W - 4, h: 1 }, '#000000aa')
          }
        }

        // Draw bridge to next step if next is tied
        if (stepIdx + 1 < track.gate.length && track.gate.steps[stepIdx + 1].tie) {
          if (col < COLS - 1) {
            const bridgeY = rowY + Math.round(STEP_H / 2) - 2
            fillRect(ctx, { x: x + STEP_W, y: bridgeY, w: COL_GAP, h: 4 }, trackColor)
          }
        }
      } else {
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: STEP_H }, COLORS.trackDim[ui.selectedTrack])
      }

      // Selected step highlight
      if (i === ui.selectedStep && ui.selectedStep >= 0) {
        strokeRect(ctx, { x: x - 1, y: rowY - 1, w: STEP_W + 2, h: STEP_H + 2 }, '#ffffff', 2)
      }
      // Playhead indicator
      else if (stepIdx === track.gate.currentStep) {
        strokeRect(ctx, { x: x - 1, y: rowY - 1, w: STEP_W + 2, h: STEP_H + 2 }, '#ffffff88', 1)
      }
    }
  }
}
