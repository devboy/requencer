/**
 * LCD Route screen — per-output param source mapping.
 * T1-T4 selects output. Enc A scrolls params. Enc B cycles source track.
 * 4 rows: GATE, PITCH, VEL, MOD — no scrolling needed.
 * All text >=16px for readability.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'
import { renderMIDI } from './midi-screen'

const PAD = 8
const HEADER_H = 30
const ROW_H = Math.floor((LCD_CONTENT_H - HEADER_H - 8) / 4)
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 4
const LABEL_X = PAD + 18
const ARROW_X = LCD_W / 2 + 20
const SOURCE_X = ARROW_X + 30

const PARAM_LABELS = ['GATE', 'PITCH', 'VEL', 'MOD']
const PARAM_KEYS: Array<'gate' | 'pitch' | 'velocity' | 'mod'> = ['gate', 'pitch', 'velocity', 'mod']

export function renderRoute(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  if (ui.routePage === 1) return renderMIDI(ctx, engine, ui)

  const outputIdx = ui.selectedTrack
  const outputRouting = engine.routing[outputIdx]

  // Header
  drawText(ctx, `ROUTE — O${outputIdx + 1}`, PAD, LCD_CONTENT_Y + 18, COLORS.track[outputIdx], 18)
  drawText(ctx, 'PUSH:midi  ENC B:source', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  // 4 param rows
  for (let i = 0; i < 4; i++) {
    const y = LIST_TOP + i * ROW_H
    const isSelected = i === ui.routeParam
    const sourceTrack = outputRouting[PARAM_KEYS[i]]
    const sourceColor = COLORS.track[sourceTrack]

    // Highlight row background
    if (isSelected) {
      fillRect(ctx, { x: PAD, y, w: LCD_W - PAD * 2, h: ROW_H - 4 }, `${COLORS.track[outputIdx]}22`)
    }

    // Cursor indicator
    const cursorColor = isSelected ? COLORS.track[outputIdx] : 'transparent'
    drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 4, cursorColor, 16)

    // Param label
    const labelColor = isSelected ? COLORS.text : COLORS.textDim
    drawText(ctx, PARAM_LABELS[i], LABEL_X, y + ROW_H / 2 - 4, labelColor, 18)

    // Arrow
    drawText(ctx, '\u2190', ARROW_X, y + ROW_H / 2 - 4, COLORS.textDim, 16)

    // Source track label (colored)
    drawText(ctx, `T${sourceTrack + 1}`, SOURCE_X, y + ROW_H / 2 - 4, sourceColor, 18)
  }
}
