/**
 * PATTERN screen row definitions — shared between renderer and mode-machine dispatch.
 * Layout: SAVE action, then one row per saved pattern.
 */

import type { SequencerState } from '../engine/types'

export type PatternRowType = 'action' | 'header' | 'pattern-item'

export interface PatternRow {
  type: PatternRowType
  paramId: string
  /** For pattern-item rows, index into engine.savedPatterns */
  patternIndex?: number
  label: string
}

export function getPatternRows(engine: SequencerState): PatternRow[] {
  const rows: PatternRow[] = [
    {
      type: 'action',
      paramId: 'save-track',
      label: '[ SAVE TRACK ]',
    },
  ]

  if (engine.savedPatterns.length > 0) {
    rows.push({
      type: 'header',
      paramId: 'section.patterns',
      label: 'PATTERNS',
    })

    for (let i = 0; i < engine.savedPatterns.length; i++) {
      rows.push({
        type: 'pattern-item',
        paramId: 'pattern-item',
        patternIndex: i,
        label: engine.savedPatterns[i].name || `Pattern ${i + 1}`,
      })
    }
  }

  return rows
}
