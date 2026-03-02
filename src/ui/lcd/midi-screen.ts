/**
 * LCD MIDI screen — per-output MIDI config (on/off, channel).
 * Accessed via Route screen Enc A push to toggle between pages.
 * All text >=16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const PAD = 8
const HEADER_H = 30
const ROW_H = Math.floor((LCD_CONTENT_H - HEADER_H - 8) / 2)
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 4
const LABEL_X = PAD + 18
const VALUE_X = LCD_W - PAD

export function renderMIDI(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const outputIdx = ui.selectedTrack
  const config = engine.midiConfigs[outputIdx]
  const trackColor = COLORS.track[outputIdx]

  // Header
  drawText(ctx, `MIDI — O${outputIdx + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'PUSH:route  ENC B:val', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  const rows = [
    { label: 'MIDI', value: config.enabled ? 'ON' : 'OFF' },
    { label: 'CHANNEL', value: String(config.channel) },
  ]

  for (let i = 0; i < rows.length; i++) {
    const y = LIST_TOP + i * ROW_H
    const isSelected = i === ui.routeParam

    if (isSelected) {
      fillRect(ctx, { x: PAD, y, w: LCD_W - PAD * 2, h: ROW_H - 4 }, `${trackColor}22`)
    }

    const cursorColor = isSelected ? trackColor : 'transparent'
    drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 4, cursorColor, 16)

    const labelColor = isSelected ? COLORS.text : COLORS.textDim
    drawText(ctx, rows[i].label, LABEL_X, y + ROW_H / 2 - 4, labelColor, 18)

    const valueColor = isSelected ? '#ffffff' : COLORS.textDim
    drawText(ctx, rows[i].value, VALUE_X, y + ROW_H / 2 - 4, valueColor, 18, 'right')
  }

  // Device info at bottom
  if (ui.midiDevices.length > 0) {
    const deviceName = ui.midiDevices[ui.midiDeviceIndex]?.name ?? 'None'
    drawText(ctx, `DEV: ${deviceName}`, PAD, LCD_CONTENT_Y + LCD_CONTENT_H - 8, COLORS.textDim, 14)
  } else {
    drawText(ctx, 'No MIDI devices', PAD, LCD_CONTENT_Y + LCD_CONTENT_H - 8, COLORS.textDim, 14)
  }
}
