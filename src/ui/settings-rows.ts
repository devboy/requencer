/**
 * Settings screen row definitions — shared between renderer and mode-machine dispatch.
 * Defines the dynamic row layout with section headers and paramId-based identity.
 * Sections: CLOCK, MIDI
 */

import type { SequencerState } from '../engine/types'
import type { UIState } from './hw-types'

export type SettingsRowType = 'header' | 'param'

export interface SettingsRow {
  type: SettingsRowType
  paramId: string
  label: string
  getValue: (engine: SequencerState, ui: UIState) => string
  visible: (engine: SequencerState, ui: UIState) => boolean
}

function buildSettingsRowDefs(): SettingsRow[] {
  const always = () => true
  const clockSourceMap: Record<string, string> = { internal: 'INT', midi: 'MIDI', external: 'EXT' }

  return [
    // --- CLOCK section ---
    {
      type: 'header', paramId: 'section.clock', label: 'CLOCK',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'clock.bpm', label: 'BPM',
      getValue: (e) => String(e.transport.bpm),
      visible: always,
    },
    {
      type: 'param', paramId: 'clock.source', label: 'SOURCE',
      getValue: (e) => clockSourceMap[e.transport.clockSource] ?? 'INT',
      visible: always,
    },

    // --- MIDI section ---
    {
      type: 'header', paramId: 'section.midi', label: 'MIDI',
      getValue: () => '', visible: always,
    },
    {
      type: 'param', paramId: 'midi.enabled', label: 'MIDI',
      getValue: (e) => e.midiEnabled ? 'ON' : 'OFF',
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.device', label: 'DEVICE',
      getValue: (_e, ui) => ui.midiDevices[ui.midiDeviceIndex]?.name ?? 'None',
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.ch.0', label: 'OUT 1 CH',
      getValue: (e) => String(e.midiConfigs[0].channel),
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.ch.1', label: 'OUT 2 CH',
      getValue: (e) => String(e.midiConfigs[1].channel),
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.ch.2', label: 'OUT 3 CH',
      getValue: (e) => String(e.midiConfigs[2].channel),
      visible: always,
    },
    {
      type: 'param', paramId: 'midi.ch.3', label: 'OUT 4 CH',
      getValue: (e) => String(e.midiConfigs[3].channel),
      visible: always,
    },
  ]
}

const SETTINGS_ROW_DEFS = buildSettingsRowDefs()

export function getSettingsRows(engine: SequencerState, ui: UIState): SettingsRow[] {
  return SETTINGS_ROW_DEFS.filter(row => row.visible(engine, ui))
}

export const SETTINGS_SECTION_PARAMS: Record<string, string[]> = {
  'section.clock': ['clock.bpm', 'clock.source'],
  'section.midi': ['midi.enabled', 'midi.device', 'midi.ch.0', 'midi.ch.1', 'midi.ch.2', 'midi.ch.3'],
}
