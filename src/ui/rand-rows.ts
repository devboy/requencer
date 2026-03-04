/**
 * RAND screen row definitions — shared between renderer and mode-machine dispatch.
 * Defines the dynamic row layout with section headers, conditional visibility,
 * and paramId-based identity for dispatch mapping.
 */

import { PRESETS } from '../engine/presets'
import { SCALES } from '../engine/scales'
import type { RandomConfig, SequencerState } from '../engine/types'
import { midiToNoteName } from './colors'
import type { UIState } from './hw-types'

export type RandRowType = 'header' | 'param' | 'subparam'

export interface RandRow {
  type: RandRowType
  paramId: string // stable identity for dispatch mapping (e.g. 'pitch.scale')
  label: string
  getValue: (engine: SequencerState, ui: UIState) => string
  visible: (engine: SequencerState, ui: UIState) => boolean
}

export function getAllPresets(engine: SequencerState): Array<{ name: string; config: RandomConfig }> {
  return [...PRESETS, ...engine.userPresets]
}

/**
 * Build the full row definition list. Visibility predicates evaluated at render/dispatch time.
 */
function buildRowDefs(): RandRow[] {
  const always = () => true
  const cfg = (e: SequencerState, ui: UIState) => e.randomConfigs[ui.selectedTrack]

  return [
    // --- PRESET (always visible, not in a section) ---
    {
      type: 'param',
      paramId: 'preset',
      label: 'PRESET',
      getValue: (e, ui) => getAllPresets(e)[ui.randPresetIndex]?.name ?? '—',
      visible: always,
    },

    // --- PITCH section ---
    {
      type: 'header',
      paramId: 'section.pitch',
      label: 'PITCH',
      getValue: () => '',
      visible: always,
    },
    {
      type: 'param',
      paramId: 'pitch.scale',
      label: 'SCALE',
      getValue: (e, ui) => cfg(e, ui).pitch.scale.name,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'pitch.root',
      label: 'ROOT',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).pitch.root),
      visible: always,
    },
    {
      type: 'param',
      paramId: 'pitch.low',
      label: 'LO',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).pitch.low),
      visible: always,
    },
    {
      type: 'param',
      paramId: 'pitch.high',
      label: 'HI',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).pitch.high),
      visible: always,
    },
    {
      type: 'param',
      paramId: 'pitch.maxNotes',
      label: 'MAX NOTES',
      getValue: (e, ui) => {
        const max = cfg(e, ui).pitch.maxNotes
        return max === 0 ? 'ALL' : String(max)
      },
      visible: always,
    },
    {
      type: 'param',
      paramId: 'slide.probability',
      label: 'SLD %',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).slide.probability * 100)}%`,
      visible: always,
    },

    // --- ARP section ---
    {
      type: 'header',
      paramId: 'section.arp',
      label: 'ARP',
      getValue: () => '',
      visible: always,
    },
    {
      type: 'param',
      paramId: 'arp.enabled',
      label: 'ARP',
      getValue: (e, ui) => (e.arpConfigs[ui.selectedTrack].enabled ? 'ON' : 'OFF'),
      visible: always,
    },
    {
      type: 'subparam',
      paramId: 'arp.direction',
      label: 'DIR',
      getValue: (e, ui) => e.arpConfigs[ui.selectedTrack].direction.toUpperCase(),
      visible: (e, ui) => e.arpConfigs[ui.selectedTrack].enabled,
    },
    {
      type: 'subparam',
      paramId: 'arp.octaveRange',
      label: 'OCT',
      getValue: (e, ui) => String(e.arpConfigs[ui.selectedTrack].octaveRange),
      visible: (e, ui) => e.arpConfigs[ui.selectedTrack].enabled,
    },

    // --- GATE section ---
    {
      type: 'header',
      paramId: 'section.gate',
      label: 'GATE',
      getValue: () => '',
      visible: always,
    },
    {
      type: 'param',
      paramId: 'gate.fillMin',
      label: 'FILL MIN',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gate.fillMin * 100)}%`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'gate.fillMax',
      label: 'FILL MAX',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gate.fillMax * 100)}%`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'gate.mode',
      label: 'MODE',
      getValue: (e, ui) => {
        const map: Record<string, string> = { random: 'RAND', euclidean: 'EUCL', sync: 'SYNC', cluster: 'CLST' }
        return map[cfg(e, ui).gate.mode] ?? cfg(e, ui).gate.mode.toUpperCase()
      },
      visible: always,
    },
    {
      type: 'subparam',
      paramId: 'gate.randomOffset',
      label: 'OFFSET',
      getValue: (e, ui) => (cfg(e, ui).gate.randomOffset ? 'RANDOM' : 'NONE'),
      visible: (e, ui) => cfg(e, ui).gate.mode === 'euclidean',
    },
    {
      type: 'subparam',
      paramId: 'gate.clusterContinuation',
      label: 'CLST %',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gate.clusterContinuation * 100)}%`,
      visible: (e, ui) => cfg(e, ui).gate.mode === 'cluster',
    },
    {
      type: 'param',
      paramId: 'gateLength.min',
      label: 'GL MIN',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gateLength.min * 100)}%`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'gateLength.max',
      label: 'GL MAX',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gateLength.max * 100)}%`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'ratchet.maxRatchet',
      label: 'RATCH MAX',
      getValue: (e, ui) => `${cfg(e, ui).ratchet.maxRatchet}x`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'ratchet.probability',
      label: 'RATCH %',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).ratchet.probability * 100)}%`,
      visible: always,
    },

    // --- TIE section ---
    {
      type: 'header',
      paramId: 'section.tie',
      label: 'TIE',
      getValue: () => '',
      visible: always,
    },
    {
      type: 'param',
      paramId: 'tie.probability',
      label: 'TIE %',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).tie.probability * 100)}%`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'tie.maxLength',
      label: 'TIE MAX',
      getValue: (e, ui) => String(cfg(e, ui).tie.maxLength),
      visible: always,
    },

    // --- VEL section ---
    {
      type: 'header',
      paramId: 'section.vel',
      label: 'VEL',
      getValue: () => '',
      visible: always,
    },
    {
      type: 'param',
      paramId: 'velocity.low',
      label: 'VEL LO',
      getValue: (e, ui) => String(cfg(e, ui).velocity.low),
      visible: always,
    },
    {
      type: 'param',
      paramId: 'velocity.high',
      label: 'VEL HI',
      getValue: (e, ui) => String(cfg(e, ui).velocity.high),
      visible: always,
    },

    // --- MOD section ---
    {
      type: 'header',
      paramId: 'section.mod',
      label: 'MOD',
      getValue: () => '',
      visible: always,
    },
    {
      type: 'param',
      paramId: 'mod.low',
      label: 'MOD LO',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).mod.low * 100)}%`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'mod.high',
      label: 'MOD HI',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).mod.high * 100)}%`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'mod.mode',
      label: 'MODE',
      getValue: (e, ui) => {
        const map: Record<string, string> = {
          random: 'RAND',
          rise: 'RISE',
          fall: 'FALL',
          vee: 'VEE',
          hill: 'HILL',
          sync: 'SYNC',
          walk: 'WALK',
        }
        return map[cfg(e, ui).mod.mode] ?? cfg(e, ui).mod.mode.toUpperCase()
      },
      visible: always,
    },
    {
      type: 'subparam',
      paramId: 'mod.walkStepSize',
      label: 'WALK Δ',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).mod.walkStepSize * 100)}%`,
      visible: (e, ui) => cfg(e, ui).mod.mode === 'walk',
    },
    {
      type: 'subparam',
      paramId: 'mod.syncBias',
      label: 'BIAS',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).mod.syncBias * 100)}%`,
      visible: (e, ui) => cfg(e, ui).mod.mode === 'sync',
    },
    {
      type: 'param',
      paramId: 'mod.slew',
      label: 'SLEW',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).mod.slew * 100)}%`,
      visible: always,
    },
    {
      type: 'param',
      paramId: 'mod.slewProb',
      label: 'SLEW %',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).mod.slewProbability * 100)}%`,
      visible: always,
    },

    // --- SAVE (always last) ---
    {
      type: 'param',
      paramId: 'save',
      label: '[ SAVE ]',
      getValue: () => 'PUSH to name',
      visible: always,
    },
  ]
}

// Cache the row definitions (they're static closures)
const ROW_DEFS = buildRowDefs()

/**
 * Get visible rows for current state. Used by both renderer and mode-machine dispatch.
 */
export function getVisibleRows(engine: SequencerState, ui: UIState): RandRow[] {
  return ROW_DEFS.filter((row) => row.visible(engine, ui))
}

/**
 * Section paramIds — used for section-level reset.
 * Maps section header paramId to list of param paramIds in that section.
 */
export const SECTION_PARAMS: Record<string, string[]> = {
  'section.pitch': ['pitch.scale', 'pitch.root', 'pitch.low', 'pitch.high', 'pitch.maxNotes', 'slide.probability'],
  'section.arp': ['arp.enabled', 'arp.direction', 'arp.octaveRange'],
  'section.gate': [
    'gate.fillMin',
    'gate.fillMax',
    'gate.mode',
    'gate.randomOffset',
    'gate.clusterContinuation',
    'gateLength.min',
    'gateLength.max',
    'ratchet.maxRatchet',
    'ratchet.probability',
  ],
  'section.tie': ['tie.probability', 'tie.maxLength'],
  'section.vel': ['velocity.low', 'velocity.high'],
  'section.mod': ['mod.low', 'mod.high', 'mod.mode', 'mod.walkStepSize', 'mod.syncBias', 'mod.slew', 'mod.slewProb'],
}

/** ParamIds that use dropdown popups instead of inline value cycling */
export const DROPDOWN_PARAM_IDS = new Set(['preset', 'pitch.scale', 'gate.mode', 'mod.mode'])

const SCALE_LIST = Object.values(SCALES)

export interface DropdownInfo {
  items: string[]
  selectedIndex: number
}

/**
 * Get dropdown items and current selection for a dropdown-eligible paramId.
 * Returns null for non-dropdown params.
 */
export function getDropdownInfo(paramId: string, engine: SequencerState, ui: UIState): DropdownInfo | null {
  const cfg = engine.randomConfigs[ui.selectedTrack]

  switch (paramId) {
    case 'preset': {
      const allPresets = getAllPresets(engine)
      return {
        items: allPresets.map((p) => p.name),
        selectedIndex: ui.randPresetIndex,
      }
    }
    case 'pitch.scale': {
      const curIdx = SCALE_LIST.findIndex((s) => s.name === cfg.pitch.scale.name)
      return {
        items: SCALE_LIST.map((s) => s.name),
        selectedIndex: Math.max(0, curIdx),
      }
    }
    case 'gate.mode': {
      const modes = ['random', 'euclidean', 'sync', 'cluster']
      const labels = ['RAND', 'EUCL', 'SYNC', 'CLST']
      return {
        items: labels,
        selectedIndex: modes.indexOf(cfg.gate.mode),
      }
    }
    case 'mod.mode': {
      const modes = ['random', 'rise', 'fall', 'vee', 'hill', 'sync', 'walk']
      const labels = ['RAND', 'RISE', 'FALL', 'VEE', 'HILL', 'SYNC', 'WALK']
      return {
        items: labels,
        selectedIndex: modes.indexOf(cfg.mod.mode),
      }
    }
    default:
      return null
  }
}
