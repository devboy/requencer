/**
 * LCD Variation screen — per-track variation pattern editor.
 * Shows phrase length, current bar, transform stack for selected bar,
 * and transform catalog browser.
 *
 * Overview (no bar selected):
 *   Enc A push: toggle enabled (track-level) or cycle override (subtrack)
 *   Step buttons: select bar
 *   Hold VAR + Enc A: change phrase length (1-16)
 *   Hold VAR + Enc B: toggle loop mode (length follows gate subtrack)
 *
 * Bar detail (bar selected):
 *   Enc A turn: move cursor through transform stack + "add" slot
 *   Enc B turn: on existing → adjust param, on "add" → browse catalog
 *   Enc B push: on "add" → add transform
 *   Enc B hold: delete transform at cursor
 *   Step buttons: select different bar / deselect
 *
 * Subtrack sub-screen:
 *   Tap subtrack button → enter sub-screen
 *   Enc A push: cycle override state (INHERIT/BYPASS/OVERRIDE)
 *   If OVERRIDE: same bar editing as track-level
 *   Back: return to track-level
 */

import type { SequencerState, VariationPattern } from '../../engine/types'
import { QUANTIZE_SCALE_NAMES } from '../../engine/variation'
import { COLORS } from '../colors'
import type { SubtrackId, UIState } from '../hw-types'
import { getEditingVariationPattern, TRANSFORM_CATALOG } from '../mode-machine'
import { drawText, fillRect, LCD_CONTENT_H, LCD_CONTENT_Y, LCD_W } from '../renderer'

const PAD = 8
const HEADER_H = 30
const ROW_H = 24
const LIST_TOP = LCD_CONTENT_Y + HEADER_H + 2

/** Category boundaries in TRANSFORM_CATALOG */
const CATALOG_CATEGORIES: Array<{ label: string; startIndex: number }> = [
  { label: 'PLAYHEAD', startIndex: 0 },
  { label: 'GATE', startIndex: 9 },
  { label: 'PITCH', startIndex: 17 },
  { label: 'VELOCITY', startIndex: 22 },
]

type CatalogDisplayRow = { kind: 'header'; label: string } | { kind: 'entry'; catalogIndex: number }

/** Precomputed display rows: category headers interleaved with catalog entries */
const CATALOG_DISPLAY_ROWS: CatalogDisplayRow[] = (() => {
  const rows: CatalogDisplayRow[] = []
  const catStarts = new Map(CATALOG_CATEGORIES.map((c) => [c.startIndex, c.label]))
  for (let i = 0; i < TRANSFORM_CATALOG.length; i++) {
    const label = catStarts.get(i)
    if (label) rows.push({ kind: 'header', label })
    rows.push({ kind: 'entry', catalogIndex: i })
  }
  return rows
})()

/** Reverse lookup: varParam (catalog index) → display row index */
const CATALOG_INDEX_TO_DISPLAY: number[] = (() => {
  const map: number[] = []
  for (let di = 0; di < CATALOG_DISPLAY_ROWS.length; di++) {
    const row = CATALOG_DISPLAY_ROWS[di]
    if (row.kind === 'entry') map[row.catalogIndex] = di
  }
  return map
})()

const SUBTRACK_LABELS: Record<SubtrackId, string> = {
  gate: 'GATE',
  pitch: 'PITCH',
  velocity: 'VEL',
  mod: 'MOD',
}

/** Format a transform param for display */
function formatParam(type: string, param: number): string {
  switch (type) {
    case 'rotate':
    case 'stutter':
      return `${param} step${param !== 1 ? 's' : ''}`
    case 'thin':
    case 'densify':
      return `${Math.round(param * 100)}%`
    case 'transpose':
      return `${param > 0 ? '+' : ''}${param} st`
    case 'invert':
      return `C${Math.floor(param / 12) - 1}`
    case 'octave-shift':
      return `${param > 0 ? '+' : ''}${param} oct`
    case 'skip':
    case 'drop':
    case 'accent':
      return `/${param}`
    case 'drunk-walk':
    case 'humanize':
      return `${Math.round(param * 100)}%`
    case 'ratchet':
      return `×${param}`
    case 'fold':
      return `${param} st`
    case 'quantize':
      return QUANTIZE_SCALE_NAMES[Math.floor(param)] ?? 'CHROM'
    default:
      return ''
  }
}

/** Get the override state label for a subtrack */
function overrideLabel(vp: VariationPattern, sub: SubtrackId): string {
  const override = vp.subtrackOverrides[sub]
  if (override === null) return 'INHERIT'
  if (override === 'bypass') return 'BYPASS'
  return 'OVERRIDE'
}

export function renderVariationEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const trackVP = engine.variationPatterns[ui.selectedTrack]

  // Subtrack sub-screen with non-OVERRIDE state → show override selector
  if (ui.varEditSubtrack) {
    const override = trackVP.subtrackOverrides[ui.varEditSubtrack]
    const isOverridePattern = override !== null && override !== 'bypass'
    if (!isOverridePattern) {
      renderSubtrackStateScreen(ctx, trackVP, ui, trackColor)
      return
    }
  }

  const vp = getEditingVariationPattern(engine, ui)

  // Header line: VAR — T1 [GATE]  4 bars  [ON/OFF]
  const subLabel = ui.varEditSubtrack ? ` ${SUBTRACK_LABELS[ui.varEditSubtrack]}` : ''
  drawText(ctx, `VAR \u2014 T${ui.selectedTrack + 1}${subLabel}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  const enabledText = vp.enabled ? 'ON' : 'OFF'
  const enabledColor = vp.enabled ? '#44ff66' : COLORS.textDim
  const lengthText = vp.loopMode ? `LOOP(${vp.length})` : `${vp.length} bars`
  drawText(ctx, `${lengthText}  [${enabledText}]`, LCD_W - PAD, LCD_CONTENT_Y + 18, enabledColor, 16, 'right')

  if (ui.varSelectedBar < 0) {
    renderBarOverview(ctx, vp, ui, trackColor)
  } else {
    renderBarDetail(ctx, vp, ui, trackColor)
  }
}

/** Subtrack sub-screen when override is INHERIT or BYPASS */
function renderSubtrackStateScreen(
  ctx: CanvasRenderingContext2D,
  trackVP: VariationPattern,
  ui: UIState,
  trackColor: string,
): void {
  if (!ui.varEditSubtrack) return
  const sub = ui.varEditSubtrack
  const label = SUBTRACK_LABELS[sub]
  const state = overrideLabel(trackVP, sub)

  // Header
  drawText(ctx, `VAR \u2014 T${ui.selectedTrack + 1} ${label}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)

  // Override state (large)
  const stateColor = state === 'INHERIT' ? COLORS.textDim : state === 'BYPASS' ? '#ff8844' : trackColor
  drawText(ctx, state, LCD_W / 2, LIST_TOP + 30, stateColor, 22, 'center')

  // State progression
  const states = ['INHERIT', 'BYPASS', 'OVERRIDE']
  const y = LIST_TOP + 64
  for (let i = 0; i < states.length; i++) {
    const s = states[i]
    const x = PAD + 12 + i * 130
    const isCurrent = s === state
    const color = isCurrent ? trackColor : COLORS.textDim
    drawText(ctx, s, x, y, color, 14)
    if (i < states.length - 1) {
      drawText(ctx, '\u2192', x + 95, y, COLORS.textDim, 14)
    }
  }
}

/** Overview mode — bar grid (2 rows of 8) and transform summaries */
function renderBarOverview(
  ctx: CanvasRenderingContext2D,
  vp: VariationPattern,
  _ui: UIState,
  trackColor: string,
): void {
  const barY = LIST_TOP
  const COLS = 8
  const CELL_W = Math.floor((LCD_W - PAD * 2) / COLS)
  const GRID_ROW_H = 38
  const numRows = Math.ceil(vp.length / COLS)

  for (let bar = 0; bar < vp.length; bar++) {
    const slot = vp.slots[bar]
    const col = bar % COLS
    const row = Math.floor(bar / COLS)
    const x = PAD + col * CELL_W
    const y = barY + row * GRID_ROW_H

    // Bar number
    const isCurrentPlayback = bar === vp.currentBar && vp.enabled
    const numColor = isCurrentPlayback ? '#44ff66' : COLORS.text
    drawText(ctx, `${bar + 1}`, x + CELL_W / 2, y + 8, numColor, 16, 'center')

    // Transform count indicator
    const count = slot.transforms.length
    if (count > 0) {
      fillRect(ctx, { x: x + 4, y: y + 20, w: CELL_W - 8, h: 12 }, `${trackColor}44`)
      drawText(ctx, `${count}`, x + CELL_W / 2, y + 26, trackColor, 16, 'center')
    } else {
      drawText(ctx, '\u2014', x + CELL_W / 2, y + 26, COLORS.textDim, 16, 'center')
    }
  }

  // List all non-empty bars with their transforms below the grid
  let listY = barY + numRows * GRID_ROW_H + 8
  for (let bar = 0; bar < vp.length; bar++) {
    const slot = vp.slots[bar]
    if (slot.transforms.length === 0) continue
    if (listY > LCD_CONTENT_Y + LCD_CONTENT_H - 30) break

    const names = slot.transforms
      .map((t) => {
        const entry = TRANSFORM_CATALOG.find((c) => c.type === t.type)
        const label = entry?.label ?? t.type.toUpperCase()
        const p = formatParam(t.type, t.param)
        return p ? `${label}(${p})` : label
      })
      .join(' + ')

    const isCurrentPlayback = bar === vp.currentBar && vp.enabled
    const barColor = isCurrentPlayback ? '#44ff66' : trackColor
    drawText(ctx, `${bar + 1}:`, PAD, listY + ROW_H / 2, barColor, 16)
    drawText(ctx, names, PAD + 30, listY + ROW_H / 2, COLORS.text, 16)
    listY += ROW_H
  }
}

/** Bar detail mode — transform stack with cursor + catalog browser */
function renderBarDetail(ctx: CanvasRenderingContext2D, vp: VariationPattern, ui: UIState, trackColor: string): void {
  const bar = ui.varSelectedBar
  const slot = vp.slots[bar]
  const cursor = ui.varCursor

  // Bar header
  drawText(ctx, `Bar ${bar + 1} of ${vp.length}`, PAD, LIST_TOP + 8, COLORS.text, 16)

  // Transform stack — always rendered
  const stackTop = LIST_TOP + ROW_H + 4
  const maxVisible = Math.floor((LCD_CONTENT_Y + LCD_CONTENT_H - stackTop - 16) / ROW_H)
  const cursorOnAdd = cursor >= slot.transforms.length

  for (let i = 0; i <= slot.transforms.length; i++) {
    if (i >= maxVisible) break
    const y = stackTop + i * ROW_H
    const isCursor = i === cursor

    if (i < slot.transforms.length) {
      const t = slot.transforms[i]
      const entry = TRANSFORM_CATALOG.find((c) => c.type === t.type)
      const label = entry?.label ?? t.type.toUpperCase()
      const p = formatParam(t.type, t.param)

      const prefix = isCursor ? '\u25B8' : ' '
      const textColor = isCursor ? COLORS.text : COLORS.textDim
      const numColor = isCursor ? trackColor : COLORS.textDim

      drawText(ctx, prefix, PAD, y + ROW_H / 2 - 2, trackColor, 16)
      drawText(ctx, `${i + 1}.`, PAD + 16, y + ROW_H / 2 - 2, numColor, 16)
      drawText(ctx, label, PAD + 40, y + ROW_H / 2 - 2, textColor, 16)
      if (p) {
        drawText(ctx, p, LCD_W - PAD, y + ROW_H / 2 - 2, isCursor ? trackColor : COLORS.textDim, 16, 'right')
      }
    } else {
      renderAddSlot(ctx, ui, trackColor, y, isCursor)
    }
  }

  // Dropdown overlay — drawn on top when cursor is on "add" slot
  if (cursorOnAdd) {
    const addSlotY = stackTop + slot.transforms.length * ROW_H
    renderCatalogDropdown(ctx, ui, trackColor, addSlotY)
  }
}

/** Render the "add" slot at the bottom of the transform stack */
function renderAddSlot(
  ctx: CanvasRenderingContext2D,
  ui: UIState,
  trackColor: string,
  y: number,
  isCursor: boolean,
): void {
  const prefix = isCursor ? '\u25B8' : ' '
  const catalogEntry = TRANSFORM_CATALOG[ui.varParam]
  const pPreview = formatParam(catalogEntry.type, catalogEntry.defaultParam)
  const catalogText = pPreview ? `${catalogEntry.label}(${pPreview})` : catalogEntry.label

  if (isCursor) {
    fillRect(ctx, { x: 0, y: y - 2, w: LCD_W, h: ROW_H }, '#12122a')
  }
  drawText(ctx, prefix, PAD, y + ROW_H / 2 - 2, trackColor, 16)
  drawText(ctx, '+', PAD + 16, y + ROW_H / 2 - 2, isCursor ? trackColor : COLORS.textDim, 16)
  drawText(ctx, catalogText, PAD + 40, y + ROW_H / 2 - 2, isCursor ? COLORS.text : COLORS.textDim, 16)
}

/** Draw a category separator line with label */
function renderCategoryHeader(
  ctx: CanvasRenderingContext2D,
  label: string,
  y: number,
  bgColor: string = COLORS.lcdBg,
): void {
  const lineY = y + ROW_H / 2
  ctx.strokeStyle = COLORS.textDim
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(PAD, lineY)
  ctx.lineTo(LCD_W - PAD, lineY)
  ctx.stroke()
  const labelW = label.length * 8 + 12
  fillRect(ctx, { x: PAD, y: lineY - 8, w: labelW, h: 16 }, bgColor)
  drawText(ctx, label, PAD + 4, lineY + 4, COLORS.textDim, 14)
}

/** Draw a single catalog entry row */
function renderCatalogEntry(
  ctx: CanvasRenderingContext2D,
  catalogIndex: number,
  y: number,
  isSelected: boolean,
  trackColor: string,
): void {
  const entry = TRANSFORM_CATALOG[catalogIndex]
  if (isSelected) {
    fillRect(ctx, { x: 0, y: y - 2, w: LCD_W, h: ROW_H }, `${trackColor}22`)
    drawText(ctx, '\u25B8', PAD, y + ROW_H / 2 - 2, trackColor, 16)
  }
  drawText(ctx, entry.label, PAD + 20, y + ROW_H / 2 - 2, isSelected ? COLORS.text : COLORS.textDim, 16)
  const p = formatParam(entry.type, entry.defaultParam)
  if (p) {
    drawText(ctx, p, LCD_W - PAD, y + ROW_H / 2 - 2, isSelected ? trackColor : COLORS.textDim, 16, 'right')
  }
}

/** Dropdown catalog list drawn on top of the transform stack, anchored at the add slot row */
function renderCatalogDropdown(ctx: CanvasRenderingContext2D, ui: UIState, trackColor: string, anchorY: number): void {
  const selectedDisplayIdx = CATALOG_INDEX_TO_DISPLAY[ui.varParam]
  const totalRows = CATALOG_DISPLAY_ROWS.length
  const lcdBottom = LCD_CONTENT_Y + LCD_CONTENT_H

  // Use all space from the anchor row down to the LCD bottom
  const dropdownTop = anchorY
  const availableH = lcdBottom - dropdownTop
  const maxVisible = Math.min(totalRows, Math.floor(availableH / ROW_H))
  const dropdownH = maxVisible * ROW_H

  // Center selection in the visible window
  const scrollOffset = Math.max(0, Math.min(selectedDisplayIdx - Math.floor(maxVisible / 2), totalRows - maxVisible))

  // Dropdown background — opaque with subtle border
  fillRect(ctx, { x: 0, y: dropdownTop - 2, w: LCD_W, h: dropdownH + 4 }, '#0c0c20')

  for (let vi = 0; vi < maxVisible; vi++) {
    const displayIdx = scrollOffset + vi
    if (displayIdx >= totalRows) break
    const row = CATALOG_DISPLAY_ROWS[displayIdx]
    const y = dropdownTop + vi * ROW_H
    if (row.kind === 'header') {
      renderCategoryHeader(ctx, row.label, y, '#0c0c20')
    } else {
      renderCatalogEntry(ctx, row.catalogIndex, y, row.catalogIndex === ui.varParam, trackColor)
    }
  }

  // Scroll thumb
  if (totalRows > maxVisible) {
    const thumbH = Math.max(12, (maxVisible / totalRows) * dropdownH)
    const thumbY = dropdownTop + (scrollOffset / (totalRows - maxVisible)) * (dropdownH - thumbH)
    fillRect(ctx, { x: LCD_W - 3, y: thumbY, w: 2, h: thumbH }, `${trackColor}44`)
  }
}
