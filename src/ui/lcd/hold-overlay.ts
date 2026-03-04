/**
 * LCD Hold Overlay — shown when a button is held for length/division combos.
 * Displays the parameter being adjusted with large, readable values.
 * All text ≥16px for readability on 3.5" TFT at 50cm.
 *
 * Thin mode: 42px header strip overlay (used in step-edit screens)
 * Full mode: semi-transparent overlay covering entire content area
 *
 * Layout conventions:
 *   Thin: values at 22px (or 18px for track with 4 subtracks)
 *   Full: title at 18px, values at 24px, no hint text
 */

import type { SequencerState } from '../../engine/types'
import { COLORS } from '../colors'
import type { UIState } from '../hw-types'
import { getEditingVariationPattern } from '../mode-machine'
import { drawText, fillRect, LCD_CONTENT_H, LCD_CONTENT_Y, LCD_W } from '../renderer'

const PAD = 16

export function renderHoldOverlay(
  ctx: CanvasRenderingContext2D,
  engine: SequencerState,
  ui: UIState,
  thinMode: boolean = false,
): void {
  const held = ui.heldButton
  if (!held) return

  const THIN_H = 42 // matches gate-edit header height

  if (thinMode) {
    // Thin overlay — only covers header area, step grid stays visible
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
    return // skip full overlay
  }

  // Semi-transparent background over content area
  fillRect(ctx, { x: 0, y: LCD_CONTENT_Y, w: LCD_W, h: LCD_CONTENT_H }, 'rgba(8,8,20,0.92)')

  const centerY = LCD_CONTENT_Y + LCD_CONTENT_H / 2
  const trackIdx = held.kind === 'track' ? held.track : ui.selectedTrack
  const trackColor = COLORS.track[trackIdx]

  if (held.kind === 'track') {
    const track = engine.tracks[held.track]
    drawText(ctx, `TRACK ${held.track + 1}`, PAD, LCD_CONTENT_Y + 30, trackColor, 18)

    const y = centerY - 10
    drawText(
      ctx,
      `G:${track.gate.length} P:${track.pitch.length} V:${track.velocity.length} M:${track.mod.length}`,
      PAD,
      y,
      COLORS.textBright,
      24,
    )
    drawText(ctx, `÷${track.clockDivider}`, PAD, y + 30, COLORS.textBright, 24)
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
    }
  }

  if (held.kind === 'feature' && held.feature === 'mute') {
    const mute = engine.mutePatterns[trackIdx]
    drawText(ctx, `MUTE — T${trackIdx + 1}`, PAD, LCD_CONTENT_Y + 30, trackColor, 18)

    const y = centerY - 10
    drawText(ctx, `LEN ${mute.length}`, PAD, y, COLORS.textBright, 24)
    drawText(ctx, `÷${mute.clockDivider}`, PAD + 200, y, COLORS.textBright, 24)
  }

  if (held.kind === 'feature' && held.feature === 'variation') {
    const vp = getEditingVariationPattern(engine, ui)
    drawText(ctx, `VAR — T${trackIdx + 1}`, PAD, LCD_CONTENT_Y + 30, trackColor, 18)

    const y = centerY - 10
    drawText(ctx, `LEN ${vp.length}`, PAD, y, COLORS.textBright, 24)
    const loopText = vp.loopMode ? 'LOOP' : 'FIXED'
    drawText(ctx, loopText, PAD + 200, y, COLORS.textBright, 24)
  }
}
