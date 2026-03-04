/**
 * LCD Pattern Load screen — three-phase flow: mapping → layers → confirm.
 * Phase 'mapping': assign slots to target tracks.
 * Phase 'layers': toggle which layers to restore.
 * Phase 'confirm': summary + apply.
 */

import type { SequencerState } from '../../engine/types'
import { COLORS } from '../colors'
import type { UIState } from '../hw-types'
import { LAYER_LABELS } from '../mode-machine'
import { drawText, fillRect, LCD_CONTENT_H, LCD_CONTENT_Y, LCD_W } from '../renderer'

const PAD = 8
const HEADER_H = 30
const ROW_H = 24
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 2
const LABEL_X = PAD + 18
const VALUE_X = LCD_W - PAD

export function renderPatternLoad(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const pattern = engine.savedPatterns[ui.patternIndex]
  if (!pattern) return

  if (ui.patternLoadStep === 'mapping') {
    renderMapping(ctx, engine, ui, trackColor)
  } else if (ui.patternLoadStep === 'layers') {
    renderLayers(ctx, ui, trackColor)
  } else {
    renderConfirm(ctx, engine, ui, trackColor)
  }
}

function renderMapping(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState, trackColor: string): void {
  const pattern = engine.savedPatterns[ui.patternIndex]
  if (!pattern) return
  drawText(ctx, `LOAD: ${pattern.name}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'SLOT MAPPING', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  for (let i = 0; i < 4; i++) {
    const y = LIST_TOP + i * ROW_H
    const isSelected = i === ui.patternLoadSlot
    const slot = pattern.slots[i]

    if (isSelected) {
      fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 2 }, `${trackColor}22`)
    }

    const cursorColor = isSelected ? trackColor : 'transparent'
    drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 2, cursorColor, 16)

    if (slot) {
      drawText(ctx, `SLOT ${i + 1}`, LABEL_X, y + ROW_H / 2 - 2, isSelected ? COLORS.text : COLORS.textDim, 16)
      drawText(
        ctx,
        `\u2192 T${ui.patternSlotMapping[i] + 1}`,
        VALUE_X,
        y + ROW_H / 2 - 2,
        isSelected ? '#ffffff' : COLORS.textDim,
        16,
        'right',
      )
    } else {
      drawText(ctx, `SLOT ${i + 1}`, LABEL_X, y + ROW_H / 2 - 2, COLORS.textDim, 16)
      drawText(ctx, '(empty)', VALUE_X, y + ROW_H / 2 - 2, COLORS.textDim, 16, 'right')
    }
  }

  drawText(ctx, 'PUSH: next \u2192 layers', LCD_W / 2, LCD_CONTENT_Y + LCD_CONTENT_H - 12, COLORS.textDim, 12, 'center')
}

function renderLayers(ctx: CanvasRenderingContext2D, ui: UIState, trackColor: string): void {
  drawText(ctx, 'SELECT LAYERS', PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'ENC B: toggle', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  const keys = Object.keys(LAYER_LABELS) as (keyof typeof LAYER_LABELS)[]
  for (let i = 0; i < keys.length; i++) {
    const y = LIST_TOP + i * ROW_H
    const isSelected = i === ui.patternLoadSlot
    const key = keys[i]
    const isOn = ui.patternLayerFlags[key]

    if (isSelected) {
      fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 2 }, `${trackColor}22`)
    }

    const cursorColor = isSelected ? trackColor : 'transparent'
    drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 2, cursorColor, 16)
    drawText(ctx, LAYER_LABELS[key], LABEL_X, y + ROW_H / 2 - 2, isSelected ? COLORS.text : COLORS.textDim, 16)
    drawText(ctx, isOn ? 'ON' : 'OFF', VALUE_X, y + ROW_H / 2 - 2, isOn ? '#ffffff' : COLORS.textDim, 16, 'right')
  }

  drawText(
    ctx,
    'PUSH: next \u2192 confirm',
    LCD_W / 2,
    LCD_CONTENT_Y + LCD_CONTENT_H - 12,
    COLORS.textDim,
    12,
    'center',
  )
}

function renderConfirm(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState, trackColor: string): void {
  const pattern = engine.savedPatterns[ui.patternIndex]
  if (!pattern) return
  drawText(ctx, `APPLY: ${pattern.name}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)

  let y = LIST_TOP

  // Show mapping summary
  for (let i = 0; i < 4; i++) {
    const slot = pattern.slots[i]
    if (!slot) continue
    drawText(ctx, `SLOT ${i + 1} \u2192 T${ui.patternSlotMapping[i] + 1}`, LABEL_X, y + ROW_H / 2 - 2, COLORS.text, 16)
    y += ROW_H
  }

  // Show active layers
  y += 4
  const activeKeys = (Object.keys(LAYER_LABELS) as (keyof typeof LAYER_LABELS)[]).filter((k) => ui.patternLayerFlags[k])
  const layerStr = activeKeys.map((k) => LAYER_LABELS[k]).join(' ')
  drawText(ctx, layerStr, LABEL_X, y + ROW_H / 2 - 2, COLORS.textDim, 14)

  drawText(ctx, 'PUSH: apply  ESC: back', LCD_W / 2, LCD_CONTENT_Y + LCD_CONTENT_H - 12, COLORS.textDim, 12, 'center')
}
