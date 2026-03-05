/**
 * XPOSE screen row definitions — shared between renderer and mode-machine dispatch.
 * Defines the scrollable parameter list for the transpose screen.
 */

import type { SequencerState } from '../engine/types'
import { midiToNoteName } from './colors'
import type { UIState } from './hw-types'

export type XposeRowType = 'header' | 'param'

export interface XposeRow {
  type: XposeRowType
  paramId: string
  label: string
  getValue: (engine: SequencerState, ui: UIState) => string
}

/**
 * Build the static row definition list for XPOSE screen.
 */
function buildRowDefs(): XposeRow[] {
  const cfg = (e: SequencerState, ui: UIState) => e.transposeConfigs[ui.selectedTrack]

  return [
    // --- PITCH section ---
    {
      type: 'header',
      paramId: 'section.pitch',
      label: 'PITCH',
      getValue: () => '',
    },
    {
      type: 'param',
      paramId: 'xpose.semi',
      label: 'SEMI',
      getValue: (e, ui) => {
        const s = cfg(e, ui).semitones
        if (s > 0) return `+${s}`
        if (s < 0) return String(s)
        return '0'
      },
    },
    {
      type: 'param',
      paramId: 'xpose.noteLow',
      label: 'NOTE LO',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).noteLow),
    },
    {
      type: 'param',
      paramId: 'xpose.noteHigh',
      label: 'NOTE HI',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).noteHigh),
    },

    // --- DYNAMICS section ---
    {
      type: 'header',
      paramId: 'section.dynamics',
      label: 'DYNAMICS',
      getValue: () => '',
    },
    {
      type: 'param',
      paramId: 'xpose.glScale',
      label: 'GL SCALE',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).glScale * 100)}%`,
    },
    {
      type: 'param',
      paramId: 'xpose.velScale',
      label: 'VEL SCALE',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).velScale * 100)}%`,
    },
  ]
}

// Cache the row definitions (they're static closures)
const ROW_DEFS = buildRowDefs()

/**
 * Get all visible rows for current state. All XPOSE rows are always visible.
 * Used by both renderer and mode-machine dispatch.
 */
export function getXposeVisibleRows(_engine: SequencerState, _ui: UIState): XposeRow[] {
  return ROW_DEFS
}
