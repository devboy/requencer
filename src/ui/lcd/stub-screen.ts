/**
 * Stub LCD screen — placeholder for modes not yet fully implemented.
 * Shows mode name and selected track.
 */

import type { SequencerState } from '../../engine/types'
import type { UIState, ScreenMode } from '../hw-types'
import { COLORS } from '../colors'
import { drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const MODE_LABELS: Record<ScreenMode, string> = {
  'home': 'HOME',
  'gate-edit': 'GATE EDIT',
  'pitch-edit': 'PITCH EDIT',
  'vel-edit': 'VELOCITY EDIT',
  'mute-edit': 'MUTE EDIT',
  'route': 'ROUTING',
  'rand': 'RANDOMIZER',
  'name-entry': 'NAME ENTRY',
}

export function renderStub(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const label = MODE_LABELS[ui.mode] || ui.mode.toUpperCase()

  const centerY = LCD_CONTENT_Y + LCD_CONTENT_H / 2

  drawText(ctx, label, LCD_W / 2, centerY - 20, trackColor, 24, 'center')
  drawText(ctx, `Track ${ui.selectedTrack + 1}`, LCD_W / 2, centerY + 14, COLORS.textDim, 16, 'center')
  drawText(ctx, '(not yet implemented)', LCD_W / 2, centerY + 40, COLORS.textDim, 12, 'center')

}
