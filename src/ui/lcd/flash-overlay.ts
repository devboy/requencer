/**
 * LCD flash overlay — brief confirmation message (SAVED, LOADED, DELETED).
 * Rendered as centered text over a semi-transparent background.
 */

import { COLORS } from '../colors'
import { drawText, fillRect, LCD_CONTENT_H, LCD_CONTENT_Y, LCD_W } from '../renderer'

export function renderFlashOverlay(ctx: CanvasRenderingContext2D, message: string): void {
  fillRect(ctx, { x: 0, y: LCD_CONTENT_Y, w: LCD_W, h: LCD_CONTENT_H }, 'rgba(8,8,20,0.82)')
  const centerX = LCD_W / 2
  const centerY = LCD_CONTENT_Y + LCD_CONTENT_H / 2
  drawText(ctx, message, centerX, centerY, COLORS.textBright, 28, 'center')
}
