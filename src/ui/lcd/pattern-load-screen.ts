/**
 * LCD Pattern Load screen — single screen with button-driven layer selection.
 * Physical buttons toggle layers, track buttons select destination, encoder push applies.
 */

import type { SequencerState } from '../../engine/types'
import { COLORS } from '../colors'
import type { UIState } from '../hw-types'
import { LAYER_LABELS } from '../mode-machine'
import { drawText, fillRect, LCD_CONTENT_H, LCD_CONTENT_Y, LCD_W } from '../renderer'

const PAD = 8

export function renderPatternLoad(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.patternLoadTarget]
  const pattern = engine.savedPatterns[ui.patternIndex]
  if (!pattern) return

  // Header: pattern name + destination
  drawText(ctx, `LOAD: ${pattern.name}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(
    ctx,
    `\u2192 T${ui.patternLoadTarget + 1}`,
    LCD_W - PAD,
    LCD_CONTENT_Y + 18,
    trackColor,
    14,
    'right',
  )

  // Layer flags summary — show which layers are selected
  const y1 = LCD_CONTENT_Y + 40
  const flags = ui.patternLayerFlags
  const keys = Object.keys(LAYER_LABELS) as (keyof typeof LAYER_LABELS)[]

  // Draw layer toggles in a compact grid (2 rows of 4)
  const colW = (LCD_W - PAD * 2) / 4
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const isOn = flags[key]
    const col = i % 4
    const row = Math.floor(i / 4)
    const x = PAD + col * colW + colW / 2
    const y = y1 + row * 24

    if (isOn) {
      fillRect(ctx, { x: x - colW / 2 + 2, y: y - 8, w: colW - 4, h: 20 }, `${trackColor}33`)
    }
    drawText(ctx, LAYER_LABELS[key], x, y + 5, isOn ? COLORS.text : COLORS.textDim, 14, 'center')
  }

  // Footer hint
  const footerY = LCD_CONTENT_Y + LCD_CONTENT_H - 12
  drawText(ctx, 'buttons: toggle   T1-4: dest   PUSH: apply', LCD_W / 2, footerY, COLORS.textDim, 11, 'center')
}
