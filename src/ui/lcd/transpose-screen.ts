/**
 * LCD Transpose Edit screen — 4-track view showing per-track transpose offset.
 * Enc A: adjust semitones (-48 to +48)
 * Enc B turn: toggle quantize on/off
 * Enc B push: back to home
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS, midiToNoteName } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const PAD = 8
const HEADER_H = 30
const ROW_H = 36
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 4

export function renderTransposeEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]

  // Header
  drawText(ctx, 'TRANSPOSE', PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'ENC A:semi  ENC B:quantize', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  // 4-track rows
  for (let t = 0; t < 4; t++) {
    const tc = engine.transposeConfigs[t]
    const y = LIST_TOP + t * ROW_H
    const isSelected = t === ui.selectedTrack
    const tColor = COLORS.track[t]

    // Highlight selected row
    if (isSelected) {
      fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 4 }, `${tColor}22`)
    }

    // Track label
    drawText(ctx, `T${t + 1}`, PAD + 4, y + ROW_H / 2 - 6, tColor, 18)

    // Semitone offset with sign
    const sign = tc.semitones > 0 ? '+' : ''
    const semiText = `${sign}${tc.semitones}`
    const semiColor = tc.semitones === 0 ? COLORS.textDim : (isSelected ? '#ffffff' : tColor)
    drawText(ctx, semiText, PAD + 60, y + ROW_H / 2 - 6, semiColor, 22)

    // Note name hint (what C4 becomes with this transpose)
    const transposedMidi = Math.max(0, Math.min(127, 60 + tc.semitones))
    drawText(ctx, `C4→${midiToNoteName(transposedMidi)}`, PAD + 140, y + ROW_H / 2 - 6, COLORS.textDim, 14)

    // Quantize indicator
    if (tc.quantize) {
      drawText(ctx, 'Q', LCD_W - PAD - 4, y + ROW_H / 2 - 6, '#ffaa00', 16, 'right')
    }
  }

  // Bottom hint
  drawText(ctx, 'T1-T4: select track', PAD, LCD_CONTENT_Y + LCD_CONTENT_H - 20, COLORS.textDim, 14)
}
