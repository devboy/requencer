/**
 * LCD Variation screen — per-track variation pattern editor.
 * Shows phrase length, current bar, transform stack for selected bar,
 * and transform catalog browser.
 *
 * Step buttons: select bar position (0 to phraseLength - 1)
 * Enc A turn: browse transform catalog
 * Enc A push (no bar): toggle enabled, (bar selected): add transform
 * Enc A hold (bar selected): remove last transform
 * Enc B turn: adjust param of last transform in selected bar
 * Hold VAR + Enc A: set phrase length
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'
import { TRANSFORM_CATALOG } from '../mode-machine'

const PAD = 8
const HEADER_H = 30
const ROW_H = 22
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 4

/** Format a transform param for display */
function formatParam(type: string, param: number): string {
  switch (type) {
    case 'rotate':       return `${param} step${param !== 1 ? 's' : ''}`
    case 'thin':         return `${Math.round(param * 100)}%`
    case 'transpose':    return `${param > 0 ? '+' : ''}${param} st`
    case 'invert':       return `C${Math.floor(param / 12) - 1}`
    case 'octave-shift': return `${param > 0 ? '+' : ''}${param} oct`
    case 'stutter':      return `${param} step${param !== 1 ? 's' : ''}`
    default:             return ''
  }
}

export function renderVariationEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const vp = engine.variationPatterns[ui.selectedTrack]

  // Header line: VAR — T1  Phrase: 4 bars  [ON/OFF]
  drawText(ctx, `VAR — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  const enabledText = vp.enabled ? 'ON' : 'OFF'
  const enabledColor = vp.enabled ? '#44ff66' : COLORS.textDim
  drawText(ctx, `${vp.length} bars  [${enabledText}]`, LCD_W - PAD, LCD_CONTENT_Y + 18, enabledColor, 14, 'right')

  if (ui.varSelectedBar < 0) {
    // --- Overview mode: show bar grid overview ---
    renderBarOverview(ctx, vp, ui, trackColor)
  } else {
    // --- Bar detail mode: show transform stack + catalog browser ---
    renderBarDetail(ctx, engine, ui, trackColor)
  }
}

function renderBarOverview(
  ctx: CanvasRenderingContext2D,
  vp: import('../../engine/types').VariationPattern,
  ui: UIState,
  trackColor: string,
): void {
  // Show a compact view of all bars and their transforms
  const barY = LIST_TOP

  drawText(ctx, 'BARS', PAD, barY + 8, COLORS.textDim, 14)

  for (let bar = 0; bar < vp.length; bar++) {
    const slot = vp.slots[bar]
    const x = PAD + 60 + bar * 50
    const y = barY

    // Bar number
    const isCurrentPlayback = bar === vp.currentBar && vp.enabled
    const numColor = isCurrentPlayback ? '#44ff66' : COLORS.text
    drawText(ctx, `${bar + 1}`, x + 20, y + 8, numColor, 14, 'center')

    // Transform count indicator
    const count = slot.transforms.length
    if (count > 0) {
      // Draw a small filled indicator
      fillRect(ctx, { x: x + 4, y: y + 20, w: 32, h: 12 }, `${trackColor}44`)
      drawText(ctx, `${count}`, x + 20, y + 26, trackColor, 12, 'center')
    } else {
      drawText(ctx, '—', x + 20, y + 26, COLORS.textDim, 12, 'center')
    }
  }

  // List all non-empty bars with their transforms
  let listY = barY + 48
  for (let bar = 0; bar < vp.length; bar++) {
    const slot = vp.slots[bar]
    if (slot.transforms.length === 0) continue
    if (listY > LCD_CONTENT_Y + LCD_CONTENT_H - 30) break

    const names = slot.transforms.map(t => {
      const entry = TRANSFORM_CATALOG.find(c => c.type === t.type)
      const label = entry?.label ?? t.type.toUpperCase()
      const p = formatParam(t.type, t.param)
      return p ? `${label}(${p})` : label
    }).join(' + ')

    const isCurrentPlayback = bar === vp.currentBar && vp.enabled
    const barColor = isCurrentPlayback ? '#44ff66' : trackColor
    drawText(ctx, `${bar + 1}:`, PAD, listY + ROW_H / 2, barColor, 14)
    drawText(ctx, names, PAD + 28, listY + ROW_H / 2, COLORS.text, 13)
    listY += ROW_H
  }

  // Bottom hint
  const hintY = LCD_CONTENT_Y + LCD_CONTENT_H - 12
  drawText(ctx, 'STEP:bar  PUSH:on/off  HOLD VAR+A:phrase', PAD, hintY, COLORS.textDim, 12)
}

function renderBarDetail(
  ctx: CanvasRenderingContext2D,
  engine: SequencerState,
  ui: UIState,
  trackColor: string,
): void {
  const vp = engine.variationPatterns[ui.selectedTrack]
  const bar = ui.varSelectedBar
  const slot = vp.slots[bar]

  // Bar header
  drawText(ctx, `Bar ${bar + 1} of ${vp.length}`, PAD, LIST_TOP + 8, COLORS.text, 16)

  // Transform stack
  if (slot.transforms.length === 0) {
    drawText(ctx, '(no transforms)', PAD + 12, LIST_TOP + ROW_H + 14, COLORS.textDim, 14)
  } else {
    for (let i = 0; i < slot.transforms.length; i++) {
      const t = slot.transforms[i]
      const y = LIST_TOP + ROW_H + i * ROW_H
      if (y > LCD_CONTENT_Y + LCD_CONTENT_H - 60) break

      const isLast = i === slot.transforms.length - 1
      const entry = TRANSFORM_CATALOG.find(c => c.type === t.type)
      const label = entry?.label ?? t.type.toUpperCase()
      const p = formatParam(t.type, t.param)

      const numColor = isLast ? trackColor : COLORS.textDim
      drawText(ctx, `${i + 1}.`, PAD, y + 12, numColor, 14)
      drawText(ctx, label, PAD + 24, y + 12, isLast ? COLORS.text : COLORS.textDim, 14)
      if (p) {
        drawText(ctx, p, LCD_W - PAD, y + 12, isLast ? trackColor : COLORS.textDim, 14, 'right')
      }
    }
  }

  // Catalog browser (bottom section)
  const catalogY = LCD_CONTENT_Y + LCD_CONTENT_H - 36
  fillRect(ctx, { x: 0, y: catalogY - 4, w: LCD_W, h: 32 }, '#12122a')
  const catalogEntry = TRANSFORM_CATALOG[ui.varParam]
  const pPreview = formatParam(catalogEntry.type, catalogEntry.defaultParam)
  const catalogText = pPreview ? `${catalogEntry.label}(${pPreview})` : catalogEntry.label
  drawText(ctx, '\u25B8', PAD, catalogY + 12, trackColor, 14)
  drawText(ctx, catalogText, PAD + 18, catalogY + 12, COLORS.text, 14)
  drawText(ctx, '[push to add]', LCD_W - PAD, catalogY + 12, COLORS.textDim, 12, 'right')
}
