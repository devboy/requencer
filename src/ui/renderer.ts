/**
 * Low-level canvas drawing helpers for the step grid UI.
 */

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function fillRect(ctx: CanvasRenderingContext2D, rect: Rect, color: string): void {
  ctx.fillStyle = color
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
}

export function strokeRect(ctx: CanvasRenderingContext2D, rect: Rect, color: string, lineWidth: number = 1): void {
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1)
}

export function fillRoundRect(ctx: CanvasRenderingContext2D, rect: Rect, color: string, radius: number = 4): void {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.roundRect(rect.x, rect.y, rect.w, rect.h, radius)
  ctx.fill()
}

export function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  size: number = 12,
  align: CanvasTextAlign = 'left',
): void {
  ctx.fillStyle = color
  ctx.font = `${size}px "JetBrains Mono", "Fira Code", monospace`
  ctx.textAlign = align
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

/** Check if a point is inside a rect */
export function hitTest(rect: Rect, px: number, py: number): boolean {
  return px >= rect.x && px < rect.x + rect.w && py >= rect.y && py < rect.y + rect.h
}

/** Setup canvas for high-DPI displays */
export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  canvas.width = rect.width * dpr
  canvas.height = rect.height * dpr
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)
  return ctx
}

/** Get CSS pixel coordinates from a mouse/touch event on a canvas */
export function getCanvasPoint(canvas: HTMLCanvasElement, event: MouseEvent | TouchEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX
  const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  }
}

// --- LCD-specific helpers ---

/** LCD dimensions — 3.5" TFT (480×320 native, 330×220 CSS at 4.5px/mm) */
export const LCD_W = 480
export const LCD_H = 320
export const LCD_STATUS_H = 24
export const LCD_SOFT_H = 28
export const LCD_CONTENT_Y = LCD_STATUS_H
export const LCD_CONTENT_H = LCD_H - LCD_STATUS_H

/** Setup a fixed-size LCD canvas at native TFT resolution (480×320, no DPR scaling) */
export function setupLCDCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  canvas.width = LCD_W    // always 480 — true TFT pixel resolution
  canvas.height = LCD_H   // always 320
  // CSS sizing handled by faceplate styles (73.44mm × 48.96mm active area)
  // image-rendering: pixelated set in panel CSS for authentic TFT look
  const ctx = canvas.getContext('2d')!
  return ctx
}

/** Draw the LCD status bar (top 18px) */
export function drawStatusBar(
  ctx: CanvasRenderingContext2D,
  leftText: string,
  bpm: number,
  playing: boolean,
): void {
  // Background
  ctx.fillStyle = '#12122a'
  ctx.fillRect(0, 0, LCD_W, LCD_STATUS_H)

  // Left text (mode/track info)
  drawText(ctx, leftText, 6, LCD_STATUS_H / 2, '#6a6a8a', 16)

  // BPM
  drawText(ctx, `${bpm} BPM`, LCD_W - 100, LCD_STATUS_H / 2, '#6a6a8a', 16)

  // Transport indicator
  const symbol = playing ? '\u25B6' : '\u25A0'
  const color = playing ? '#44ff66' : '#6a6a8a'
  drawText(ctx, symbol, LCD_W - 18, LCD_STATUS_H / 2, color, 16)
}
