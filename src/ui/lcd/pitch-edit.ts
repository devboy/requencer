/**
 * LCD Pitch Edit screen — pitch pattern with step select + encoder adjust.
 * 2×8 grid layout matching the physical step button grid.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS, midiToNoteName } from '../colors'
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

export function renderPitchEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const track = engine.tracks[ui.selectedTrack]
  const trackColor = COLORS.track[ui.selectedTrack]
  const pageOffset = ui.currentPage * 16
  const maxPage = Math.max(0, Math.ceil(track.pitch.length / 16) - 1)

  // Title
  drawText(ctx, `PITCH — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)

  // Selected step info — prominent display
  const selIdx = pageOffset + ui.selectedStep
  if (selIdx < track.pitch.length) {
    const step = track.pitch.steps[selIdx]
    const slideLabel = step.slide > 0 ? `  SLD:${Math.round(step.slide * 1000)}ms` : ''
    drawText(ctx, `${midiToNoteName(step.note)} (${step.note})${slideLabel}`, PAD, LCD_CONTENT_Y + 36, COLORS.textBright, 16)
  }

  // Right side info
  let infoText = `LEN ${track.pitch.length}`
  if (track.pitch.clockDivider > 1) infoText += `  ÷${track.pitch.clockDivider}`
  if (maxPage > 0) infoText += `  P${ui.currentPage + 1}/${maxPage + 1}`
  drawText(ctx, infoText, LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 16, 'right')

  // Use RandomConfig pitch range for stable normalization
  const config = engine.randomConfigs[ui.selectedTrack]
  const minNote = config.pitch.low
  const maxNote = config.pitch.high
  const range = maxNote - minNote || 1

  // Step bars — 2 rows of 8
  for (let row = 0; row < 2; row++) {
    const barBaseY = STEP_AREA_TOP + (row + 1) * BAR_MAX_H + row * ROW_GAP
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col
      const stepIdx = pageOffset + i
      const x = PAD + col * (STEP_W + COL_GAP)

      if (stepIdx >= track.pitch.length) {
        fillRect(ctx, { x, y: barBaseY - 2, w: STEP_W, h: 2 }, '#111118')
        continue
      }

      const pitchStep = track.pitch.steps[stepIdx]
      const normalized = Math.max(0, Math.min(1, (pitchStep.note - minNote) / range))
      const barH = Math.max(3, normalized * (BAR_MAX_H - 4))
      const barY = barBaseY - barH
      const isSelected = i === ui.selectedStep
      const color = isSelected ? COLORS.textBright : trackColor

      // Slide: tint bar orange when slide active
      const barColor = pitchStep.slide > 0 ? '#ff8800' : color

      fillRect(ctx, { x, y: barY, w: STEP_W, h: barH }, barColor)

      if (isSelected) {
        strokeRect(ctx, { x: x - 1, y: barY - 1, w: STEP_W + 2, h: barH + 2 }, '#ffffff', 1)
      }

      // Slide connector — diagonal line from this bar top to next bar top
      if (pitchStep.slide > 0) {
        const nextCol = col + 1
        const nextRow = nextCol >= COLS ? row + 1 : row
        const nextColWrapped = nextCol % COLS
        const nextStepIdx = pageOffset + (nextRow * COLS + nextColWrapped)
        if (nextRow < 2 && nextStepIdx < track.pitch.length) {
          const nextNorm = Math.max(0, Math.min(1, (track.pitch.steps[nextStepIdx].note - minNote) / range))
          const nextBarH = Math.max(3, nextNorm * (BAR_MAX_H - 4))
          const nextBarBaseY = STEP_AREA_TOP + (nextRow + 1) * BAR_MAX_H + nextRow * ROW_GAP
          const nextX = PAD + nextColWrapped * (STEP_W + COL_GAP)
          ctx.beginPath()
          ctx.moveTo(x + STEP_W, barY)
          ctx.lineTo(nextX, nextBarBaseY - nextBarH)
          ctx.strokeStyle = '#ff8800'
          ctx.lineWidth = 2
          ctx.stroke()
        }
      }

      // Playhead
      if (stepIdx === track.pitch.currentStep) {
        fillRect(ctx, { x, y: barBaseY + 2, w: STEP_W, h: 3 }, '#ffffff')
      }
    }
  }
}
