/**
 * LCD Name-entry screen — encoder-based character picker for preset naming.
 * Enc A cycles characters at cursor. Enc B moves cursor left/right.
 * Enc A push saves. Enc B push cancels.
 * All text >=16px for readability.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'
import { NAME_CHARSET } from '../mode-machine'

const PAD = 8
const CHAR_W = 28
const CHAR_H = 36
const CHAR_GAP = 4

export function renderNameEntry(ctx: CanvasRenderingContext2D, _engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]

  // Header
  drawText(ctx, 'SAVE PRESET', PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, 'ENC A:char  ENC B:cursor  PUSH:save', LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 12, 'right')

  // Center the character grid
  const totalW = ui.nameChars.length * (CHAR_W + CHAR_GAP) - CHAR_GAP
  const startX = Math.floor((LCD_W - totalW) / 2)
  const centerY = LCD_CONTENT_Y + LCD_CONTENT_H / 2

  // Draw each character box
  for (let i = 0; i < ui.nameChars.length; i++) {
    const x = startX + i * (CHAR_W + CHAR_GAP)
    const y = centerY - CHAR_H / 2
    const isCursor = i === ui.nameCursor

    // Background box
    const bgColor = isCursor ? `${trackColor}44` : `${COLORS.textDim}11`
    fillRect(ctx, { x, y, w: CHAR_W, h: CHAR_H }, bgColor)

    // Character
    const ch = NAME_CHARSET[ui.nameChars[i]] ?? ' '
    const charColor = isCursor ? '#ffffff' : COLORS.text
    drawText(ctx, ch, x + CHAR_W / 2, y + CHAR_H / 2 - 2, charColor, 20, 'center')

    // Cursor underline
    if (isCursor) {
      fillRect(ctx, { x: x + 2, y: y + CHAR_H - 3, w: CHAR_W - 4, h: 2 }, trackColor)
    }
  }

  // Preview of full name below
  const name = ui.nameChars.map(ci => NAME_CHARSET[ci] ?? ' ').join('')
  drawText(ctx, name.trim() || '(empty)', LCD_W / 2, centerY + CHAR_H / 2 + 24, COLORS.textDim, 16, 'center')

  // Hint
  drawText(ctx, 'ESC: cancel', LCD_W / 2, LCD_CONTENT_Y + LCD_CONTENT_H - 12, COLORS.textDim, 12, 'center')
}
