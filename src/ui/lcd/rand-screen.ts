/**
 * LCD Randomizer screen — parameter list with preset selector.
 * Enc A scrolls params, Enc B adjusts values, Enc A push applies preset.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS, midiToNoteName } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'
import { getAllPresets } from '../mode-machine'

const PAD = 8
const HEADER_H = 30
const ROW_H = 24
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 2
const LABEL_X = PAD + 18  // after cursor indicator
const VALUE_X = LCD_W - PAD

interface ParamRow {
  label: string
  getValue: (engine: SequencerState, ui: UIState) => string
}

const PARAM_ROWS: ParamRow[] = [
  {
    label: 'PRESET',
    getValue: (e, ui) => getAllPresets(e)[ui.randPresetIndex]?.name ?? '—',
  },
  {
    label: 'SCALE',
    getValue: (e, ui) => e.randomConfigs[ui.selectedTrack].pitch.scale.name,
  },
  {
    label: 'ROOT',
    getValue: (e, ui) => midiToNoteName(e.randomConfigs[ui.selectedTrack].pitch.root),
  },
  {
    label: 'PITCH LO',
    getValue: (e, ui) => midiToNoteName(e.randomConfigs[ui.selectedTrack].pitch.low),
  },
  {
    label: 'PITCH HI',
    getValue: (e, ui) => midiToNoteName(e.randomConfigs[ui.selectedTrack].pitch.high),
  },
  {
    label: 'MAX NOTES',
    getValue: (e, ui) => {
      const max = e.randomConfigs[ui.selectedTrack].pitch.maxNotes
      return max === 0 ? 'ALL' : String(max)
    },
  },
  {
    label: 'FILL MIN',
    getValue: (e, ui) => `${Math.round(e.randomConfigs[ui.selectedTrack].gate.fillMin * 100)}%`,
  },
  {
    label: 'FILL MAX',
    getValue: (e, ui) => `${Math.round(e.randomConfigs[ui.selectedTrack].gate.fillMax * 100)}%`,
  },
  {
    label: 'GATE',
    getValue: (e, ui) => e.randomConfigs[ui.selectedTrack].gate.mode.toUpperCase(),
  },
  {
    label: 'OFFSET',
    getValue: (e, ui) => e.randomConfigs[ui.selectedTrack].gate.randomOffset ? 'RANDOM' : 'NONE',
  },
  {
    label: 'VEL LO',
    getValue: (e, ui) => String(e.randomConfigs[ui.selectedTrack].velocity.low),
  },
  {
    label: 'VEL HI',
    getValue: (e, ui) => String(e.randomConfigs[ui.selectedTrack].velocity.high),
  },
  {
    label: '[ SAVE ]',
    getValue: () => 'PUSH to name',
  },
]

export function renderRand(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]

  // Header
  drawText(ctx, `RAND — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'ENC A:▲▼  ENC B:val  PUSH:apply', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  // Visible rows — fit as many as content area allows
  const maxVisible = Math.floor((LCD_CONTENT_H - HEADER_H - 4) / ROW_H)
  // Scroll window: keep selected param centered when possible
  const scrollOffset = Math.max(0, Math.min(ui.randParam - Math.floor(maxVisible / 2), PARAM_ROWS.length - maxVisible))

  for (let vi = 0; vi < maxVisible && scrollOffset + vi < PARAM_ROWS.length; vi++) {
    const paramIdx = scrollOffset + vi
    const row = PARAM_ROWS[paramIdx]
    const y = LIST_TOP + vi * ROW_H
    const isSelected = paramIdx === ui.randParam

    // Highlight row background
    if (isSelected) {
      fillRect(ctx, { x: PAD, y: y - 2, w: LCD_W - PAD * 2, h: ROW_H - 2 }, `${trackColor}22`)
    }

    // Cursor indicator
    const cursorColor = isSelected ? trackColor : 'transparent'
    drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 2, cursorColor, 16)

    // Label
    const labelColor = isSelected ? COLORS.text : COLORS.textDim
    drawText(ctx, row.label, LABEL_X, y + ROW_H / 2 - 2, labelColor, 16)

    // Value
    const value = row.getValue(engine, ui)
    const valueColor = isSelected ? '#ffffff' : COLORS.textDim
    drawText(ctx, value, VALUE_X, y + ROW_H / 2 - 2, valueColor, 16, 'right')
  }

  // Scroll indicator if list is longer than visible area
  if (PARAM_ROWS.length > maxVisible) {
    const barH = LCD_CONTENT_H - HEADER_H - 8
    const thumbH = Math.max(12, (maxVisible / PARAM_ROWS.length) * barH)
    const thumbY = LIST_TOP + (scrollOffset / (PARAM_ROWS.length - maxVisible)) * (barH - thumbH)
    fillRect(ctx, { x: LCD_W - 3, y: thumbY, w: 2, h: thumbH }, `${trackColor}44`)
  }
}
