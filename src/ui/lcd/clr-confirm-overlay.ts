/**
 * LCD CLR Confirm Overlay — shown when CLR button is in pending state.
 * Semi-transparent overlay with "CLR?" centered over the LCD content area.
 */

import { COLORS } from '../colors'
import type { UIState } from '../hw-types'
import { drawText, fillRect, LCD_CONTENT_H, LCD_CONTENT_Y, LCD_W } from '../renderer'

export function renderClrConfirmOverlay(ctx: CanvasRenderingContext2D, _ui: UIState): void {
  // Semi-transparent background
  fillRect(ctx, { x: 0, y: LCD_CONTENT_Y, w: LCD_W, h: LCD_CONTENT_H }, 'rgba(8,8,20,0.85)')

  // Centered "CLR?" text
  const centerX = LCD_W / 2
  const centerY = LCD_CONTENT_Y + LCD_CONTENT_H / 2
  drawText(ctx, 'CLR?', centerX, centerY, COLORS.textBright, 32, 'center')
}
