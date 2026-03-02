/**
 * LCD Hold Overlay — shown when a button is held for length/division combos.
 * Displays the parameter being adjusted with large, readable values.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState, HeldButtonTarget } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const PAD = 16

export function renderHoldOverlay(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const held = ui.heldButton
  if (!held) return

  // Semi-transparent background over content area
  fillRect(ctx, { x: 0, y: LCD_CONTENT_Y, w: LCD_W, h: LCD_CONTENT_H }, 'rgba(8,8,20,0.92)')

  const centerY = LCD_CONTENT_Y + LCD_CONTENT_H / 2
  const trackIdx = held.kind === 'track' ? held.track : ui.selectedTrack
  const trackColor = COLORS.track[trackIdx]

  if (held.kind === 'track') {
    const track = engine.tracks[held.track]
    drawText(ctx, `TRACK ${held.track + 1}`, PAD, LCD_CONTENT_Y + 30, trackColor, 18)

    // Show all subtrack lengths
    const y = centerY - 20
    drawText(ctx, `LEN  G:${track.gate.length}  P:${track.pitch.length}  V:${track.velocity.length}  M:${track.mod.length}`, PAD, y, COLORS.textBright, 18)

    // Track clock divider
    drawText(ctx, `DIV  ÷${track.clockDivider}`, PAD, y + 26, COLORS.textBright, 18)

    // Hint
    drawText(ctx, 'ENC A: length  ENC B: divider', PAD, LCD_CONTENT_Y + LCD_CONTENT_H - 20, COLORS.textDim, 16)
  }

  if (held.kind === 'subtrack') {
    const sub = held.subtrack
    if (sub === 'gate' || sub === 'pitch' || sub === 'velocity' || sub === 'mod') {
      const subtrack = engine.tracks[trackIdx][sub]
      const label = sub.toUpperCase()
      drawText(ctx, `${label} — T${trackIdx + 1}`, PAD, LCD_CONTENT_Y + 30, trackColor, 18)

      const y = centerY - 10
      drawText(ctx, `LEN ${subtrack.length}`, PAD, y, COLORS.textBright, 24)
      drawText(ctx, `÷${subtrack.clockDivider}`, PAD + 200, y, COLORS.textBright, 24)

      drawText(ctx, 'ENC A: length  ENC B: divider', PAD, LCD_CONTENT_Y + LCD_CONTENT_H - 20, COLORS.textDim, 16)
    }
  }

  if (held.kind === 'feature' && held.feature === 'mute') {
    const mute = engine.mutePatterns[trackIdx]
    drawText(ctx, `MUTE — T${trackIdx + 1}`, PAD, LCD_CONTENT_Y + 30, trackColor, 18)

    const y = centerY - 10
    drawText(ctx, `LEN ${mute.length}`, PAD, y, COLORS.textBright, 24)
    drawText(ctx, `÷${mute.clockDivider}`, PAD + 200, y, COLORS.textBright, 24)

    drawText(ctx, 'ENC A: length  ENC B: divider', PAD, LCD_CONTENT_Y + LCD_CONTENT_H - 20, COLORS.textDim, 16)
  }

}
