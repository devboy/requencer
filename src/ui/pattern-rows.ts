/**
 * PATTERN screen row definitions — shared between renderer and mode-machine dispatch.
 * Dynamic layout: SAVE ALL, SAVE T{N}, then saved patterns + DELETE.
 */

import type { SequencerState } from '../engine/types'

export type PatternRowType = 'action' | 'header' | 'pattern-item'

export interface PatternRow {
  type: PatternRowType
  paramId: string
  label: string
  getValue: (engine: SequencerState) => string
}

export function getPatternRows(engine: SequencerState): PatternRow[] {
  const rows: PatternRow[] = [
    {
      type: 'action',
      paramId: 'save-track',
      label: '[ SAVE TRACK ]',
      getValue: () => '',
    },
  ]

  if (engine.savedPatterns.length > 0) {
    rows.push({
      type: 'header',
      paramId: 'section.patterns',
      label: 'PATTERNS',
      getValue: () => '',
    })

    rows.push({
      type: 'pattern-item',
      paramId: 'pattern-slot',
      label: 'PATTERN',
      getValue: () => '',
    })

    rows.push({
      type: 'action',
      paramId: 'delete',
      label: '[ DELETE ]',
      getValue: () => '',
    })
  }

  return rows
}
