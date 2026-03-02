/**
 * RAND screen row definitions — shared between renderer and mode-machine dispatch.
 * Defines the dynamic row layout with section headers, conditional visibility,
 * and paramId-based identity for dispatch mapping.
 */

import type { SequencerState, RandomConfig } from '../engine/types'
import type { UIState } from './hw-types'
import { PRESETS } from '../engine/presets'
import { midiToNoteName } from './colors'

export type RandRowType = 'header' | 'param' | 'subparam'

export interface RandRow {
  type: RandRowType
  paramId: string          // stable identity for dispatch mapping (e.g. 'pitch.scale')
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
      type: 'param', paramId: 'preset', label: 'PRESET',
      getValue: (e, ui) => getAllPresets(e)[ui.randPresetIndex]?.name ?? '—',
      visible: always,
    },

    // --- PITCH section ---
    {
      type: 'header', paramId: 'section.pitch', label: 'PITCH',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'pitch.scale', label: 'SCALE',
      getValue: (e, ui) => cfg(e, ui).pitch.scale.name,
      visible: always,
    },
    {
      type: 'param', paramId: 'pitch.root', label: 'ROOT',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).pitch.root),
      visible: always,
    },
    {
      type: 'param', paramId: 'pitch.low', label: 'LO',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).pitch.low),
      visible: always,
    },
    {
      type: 'param', paramId: 'pitch.high', label: 'HI',
      getValue: (e, ui) => midiToNoteName(cfg(e, ui).pitch.high),
      visible: always,
    },
    {
      type: 'param', paramId: 'pitch.maxNotes', label: 'MAX NOTES',
      getValue: (e, ui) => { const max = cfg(e, ui).pitch.maxNotes; return max === 0 ? 'ALL' : String(max) },
      visible: always,
    },
    {
      type: 'param', paramId: 'slide.probability', label: 'SLD %',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).slide.probability * 100)}%`,
      visible: always,
    },

    // --- ARP section ---
    {
      type: 'header', paramId: 'section.arp', label: 'ARP',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'arp.enabled', label: 'ARP',
      getValue: (e, ui) => e.arpConfigs[ui.selectedTrack].enabled ? 'ON' : 'OFF',
      visible: always,
    },
    {
      type: 'subparam', paramId: 'arp.direction', label: 'DIR',
      getValue: (e, ui) => e.arpConfigs[ui.selectedTrack].direction.toUpperCase(),
      visible: (e, ui) => e.arpConfigs[ui.selectedTrack].enabled,
    },
    {
      type: 'subparam', paramId: 'arp.octaveRange', label: 'OCT',
      getValue: (e, ui) => String(e.arpConfigs[ui.selectedTrack].octaveRange),
      visible: (e, ui) => e.arpConfigs[ui.selectedTrack].enabled,
    },

    // --- GATE section ---
    {
      type: 'header', paramId: 'section.gate', label: 'GATE',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'gate.fillMin', label: 'FILL MIN',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gate.fillMin * 100)}%`,
      visible: always,
    },
    {
      type: 'param', paramId: 'gate.fillMax', label: 'FILL MAX',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gate.fillMax * 100)}%`,
      visible: always,
    },
    {
      type: 'param', paramId: 'gate.mode', label: 'MODE',
      getValue: (e, ui) => cfg(e, ui).gate.mode.toUpperCase(),
      visible: always,
    },
    {
      type: 'subparam', paramId: 'gate.randomOffset', label: 'OFFSET',
      getValue: (e, ui) => cfg(e, ui).gate.randomOffset ? 'RANDOM' : 'NONE',
      visible: (e, ui) => cfg(e, ui).gate.mode === 'euclidean',
    },
    {
      type: 'param', paramId: 'gate.smartBars', label: 'BARS',
      getValue: (e, ui) => String(cfg(e, ui).gate.smartBars),
      visible: always,
    },
    {
      type: 'param', paramId: 'gate.smartDensity', label: 'PHRASE',
      getValue: (e, ui) => cfg(e, ui).gate.smartDensity.toUpperCase(),
      visible: always,
    },
    {
      type: 'param', paramId: 'gateLength.min', label: 'GL MIN',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gateLength.min * 100)}%`,
      visible: always,
    },
    {
      type: 'param', paramId: 'gateLength.max', label: 'GL MAX',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).gateLength.max * 100)}%`,
      visible: always,
    },
    {
      type: 'param', paramId: 'ratchet.maxRatchet', label: 'RATCH MAX',
      getValue: (e, ui) => `${cfg(e, ui).ratchet.maxRatchet}x`,
      visible: always,
    },
    {
      type: 'param', paramId: 'ratchet.probability', label: 'RATCH %',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).ratchet.probability * 100)}%`,
      visible: always,
    },

    // --- VEL section ---
    {
      type: 'header', paramId: 'section.vel', label: 'VEL',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'velocity.low', label: 'VEL LO',
      getValue: (e, ui) => String(cfg(e, ui).velocity.low),
      visible: always,
    },
    {
      type: 'param', paramId: 'velocity.high', label: 'VEL HI',
      getValue: (e, ui) => String(cfg(e, ui).velocity.high),
      visible: always,
    },

    // --- MOD section ---
    {
      type: 'header', paramId: 'section.mod', label: 'MOD',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'mod.low', label: 'MOD LO',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).mod.low * 100)}%`,
      visible: always,
    },
    {
      type: 'param', paramId: 'mod.high', label: 'MOD HI',
      getValue: (e, ui) => `${Math.round(cfg(e, ui).mod.high * 100)}%`,
      visible: always,
    },

    // --- LFO section ---
    {
      type: 'header', paramId: 'section.lfo', label: 'LFO',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'lfo.enabled', label: 'LFO',
      getValue: (e, ui) => e.lfoConfigs[ui.selectedTrack].enabled ? 'ON' : 'OFF',
      visible: always,
    },
    {
      type: 'subparam', paramId: 'lfo.waveform', label: 'WAVE',
      getValue: (e, ui) => e.lfoConfigs[ui.selectedTrack].waveform.toUpperCase(),
      visible: (e, ui) => e.lfoConfigs[ui.selectedTrack].enabled,
    },
    {
      type: 'subparam', paramId: 'lfo.rate', label: 'RATE',
      getValue: (e, ui) => String(e.lfoConfigs[ui.selectedTrack].rate),
      visible: (e, ui) => e.lfoConfigs[ui.selectedTrack].enabled,
    },
    {
      type: 'subparam', paramId: 'lfo.depth', label: 'DEPTH',
      getValue: (e, ui) => `${Math.round(e.lfoConfigs[ui.selectedTrack].depth * 100)}%`,
      visible: (e, ui) => e.lfoConfigs[ui.selectedTrack].enabled,
    },

    // --- SAVE (always last) ---
    {
      type: 'param', paramId: 'save', label: '[ SAVE ]',
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
  return ROW_DEFS.filter(row => row.visible(engine, ui))
}

/**
 * Section paramIds — used for section-level reset.
 * Maps section header paramId to list of param paramIds in that section.
 */
export const SECTION_PARAMS: Record<string, string[]> = {
  'section.pitch': ['pitch.scale', 'pitch.root', 'pitch.low', 'pitch.high', 'pitch.maxNotes', 'slide.probability'],
  'section.arp': ['arp.enabled', 'arp.direction', 'arp.octaveRange'],
  'section.gate': ['gate.fillMin', 'gate.fillMax', 'gate.mode', 'gate.randomOffset', 'gate.smartBars', 'gate.smartDensity', 'gateLength.min', 'gateLength.max', 'ratchet.maxRatchet', 'ratchet.probability'],
  'section.vel': ['velocity.low', 'velocity.high'],
  'section.mod': ['mod.low', 'mod.high'],
  'section.lfo': ['lfo.enabled', 'lfo.waveform', 'lfo.rate', 'lfo.depth'],
}
