/**
 * LCD Hold Overlay — thin 42px header strip shown when a button is held.
 * Displays the parameter being adjusted with large, readable values.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState } from '../../engine/types'
import { COLORS } from '../colors'
import type { UIState } from '../hw-types'
import { getEditingVariationPattern } from '../mode-machine'
import { drawText, fillRect, LCD_CONTENT_Y, LCD_W } from '../renderer'

const PAD = 16
const THIN_H = 42

export function renderHoldOverlay(
  ctx: CanvasRenderingContext2D,
  engine: SequencerState,
  ui: UIState,
  _thinMode: boolean = true,
): void {
  const held = ui.heldButton
  if (!held) return

  fillRect(ctx, { x: 0, y: LCD_CONTENT_Y, w: LCD_W, h: THIN_H }, 'rgba(8,8,20,0.92)')
  const trackIdx = held.kind === 'track' ? held.track : ui.selectedTrack

  if (held.kind === 'subtrack') {
    const sub = held.subtrack
    if (sub === 'gate' || sub === 'pitch' || sub === 'velocity' || sub === 'mod') {
      const subtrack = engine.tracks[trackIdx][sub]
      drawText(ctx, `LEN ${subtrack.length}`, PAD, LCD_CONTENT_Y + 22, COLORS.textBright, 22)
      drawText(ctx, `÷${subtrack.clockDivider}`, PAD + 140, LCD_CONTENT_Y + 22, COLORS.textBright, 22)
    }
  } else if (held.kind === 'track') {
    const track = engine.tracks[trackIdx]
    drawText(
      ctx,
      `LEN G:${track.gate.length} P:${track.pitch.length} V:${track.velocity.length} M:${track.mod.length}`,
      PAD,
      LCD_CONTENT_Y + 22,
      COLORS.textBright,
      18,
    )
    drawText(ctx, `÷${track.clockDivider}`, LCD_W - PAD - 50, LCD_CONTENT_Y + 22, COLORS.textBright, 18)
  } else if (held.kind === 'feature' && held.feature === 'mute') {
    const mute = engine.mutePatterns[trackIdx]
    drawText(ctx, `MUTE LEN ${mute.length}`, PAD, LCD_CONTENT_Y + 22, COLORS.textBright, 22)
    drawText(ctx, `÷${mute.clockDivider}`, PAD + 200, LCD_CONTENT_Y + 22, COLORS.textBright, 22)
  } else if (held.kind === 'feature' && held.feature === 'variation') {
    const vp = getEditingVariationPattern(engine, ui)
    const loopText = vp.loopMode ? '  LOOP' : ''
    drawText(ctx, `VAR ${vp.length} bars${loopText}`, PAD, LCD_CONTENT_Y + 22, COLORS.textBright, 22)
  }
}
