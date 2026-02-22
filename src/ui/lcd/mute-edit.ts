/**
 * LCD Mute Edit screen — shows all 4 tracks' mute patterns at once.
 * Selected track is highlighted; step buttons toggle mutes on the selected track.
 * Fixed 16-step view (no paging), all tracks visible for arrangement overview.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, strokeRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const PAD = 8
const LABEL_W = 28
const HEADER_H = 24
const TRACK_GAP = 4
const COLS = 16
const COL_GAP = 2
const GRID_LEFT = PAD + LABEL_W
const STEP_W = (LCD_W - GRID_LEFT - PAD - (COLS - 1) * COL_GAP) / COLS
const AVAIL_H = LCD_CONTENT_H - HEADER_H - 4
const ROW_H = (AVAIL_H - 3 * TRACK_GAP) / 4

const MUTE_COLOR = '#aa3344'

export function renderMuteEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  // Title
  drawText(ctx, 'MUTE', PAD, LCD_CONTENT_Y + 18, COLORS.textBright, 18)

  // Render all 4 tracks
  for (let t = 0; t < 4; t++) {
    const mute = engine.mutePatterns[t]
    const trackColor = COLORS.track[t]
    const dimColor = COLORS.trackDim[t]
    const isSelected = t === ui.selectedTrack
    const rowY = LCD_CONTENT_Y + HEADER_H + t * (ROW_H + TRACK_GAP)

    // Selected track background highlight
    if (isSelected) {
      fillRect(ctx, { x: PAD, y: rowY - 1, w: LCD_W - PAD * 2, h: ROW_H + 2 }, `${trackColor}20`)
    }

    // Track label
    drawText(ctx, `T${t + 1}`, PAD + 2, rowY + ROW_H / 2 + 1, isSelected ? trackColor : COLORS.textDim, 16)

    // Mute step cells
    for (let i = 0; i < COLS; i++) {
      const x = GRID_LEFT + i * (STEP_W + COL_GAP)

      if (i >= mute.length) {
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: ROW_H }, '#111118')
      } else if (mute.steps[i]) {
        // Muted
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: ROW_H }, isSelected ? MUTE_COLOR : `${MUTE_COLOR}88`)
      } else {
        // Not muted
        fillRect(ctx, { x, y: rowY, w: STEP_W, h: ROW_H }, isSelected ? dimColor : `${dimColor}60`)
      }

      // Playhead
      if (i === mute.currentStep) {
        strokeRect(ctx, { x: x - 1, y: rowY - 1, w: STEP_W + 2, h: ROW_H + 2 }, '#ffffff', isSelected ? 2 : 1)
      }
    }
  }
}
