/**
 * Hardware UI types — screen modes, control events, UI state.
 * Pure types, no dependencies on DOM/audio.
 *
 * Navigation model:
 *   T1-T4 buttons: select track (cross-modal — works in any screen)
 *   GATE/PITCH/VEL/MOD buttons: enter subtrack edit screens
 *   MUTE/ROUTE/RAND buttons: enter feature screens
 *   16 step buttons: context-dependent (toggle/select based on mode)
 *   Encoder A (left): context-dependent (value edit, scroll)
 *   Encoder B (right): page navigation, secondary edit
 *   PLAY: transport toggle
 *   RESET: reset all playheads
 */

export type ScreenMode =
  | 'home'
  | 'gate-edit'
  | 'pitch-edit'
  | 'vel-edit'
  | 'mute-edit'
  | 'route'
  | 'rand'
  | 'name-entry'
  | 'mutate-edit'
  | 'mod-edit'
  | 'transpose-edit'

export type ControlEvent =
  | { type: 'encoder-a-turn'; delta: number }
  | { type: 'encoder-a-push' }
  | { type: 'encoder-a-hold' }
  | { type: 'encoder-b-turn'; delta: number }
  | { type: 'encoder-b-push' }
  | { type: 'back' }
  | { type: 'play-stop' }
  | { type: 'reset' }
  | { type: 'track-select'; track: number }      // T1-T4 (0-3)
  | { type: 'subtrack-select'; subtrack: SubtrackId }
  | { type: 'feature-press'; feature: FeatureId }
  | { type: 'step-press'; step: number }          // 0-15
  | { type: 'hold-start'; button: HeldButtonTarget }
  | { type: 'hold-end' }

export type SubtrackId = 'gate' | 'pitch' | 'velocity' | 'mod'
export type FeatureId = 'mute' | 'route' | 'rand' | 'mutate' | 'transpose'

/** Describes which button is being held for hold combos */
export type HeldButtonTarget =
  | { kind: 'track'; track: number }        // T1-T4 (0-3)
  | { kind: 'subtrack'; subtrack: SubtrackId }
  | { kind: 'feature'; feature: FeatureId }
  | { kind: 'step'; step: number }          // step 0-15

export interface UIState {
  mode: ScreenMode
  selectedTrack: number       // 0-3
  selectedStep: number        // 0-15 (for pitch/vel edit: which step is selected)
  currentPage: number         // 0-based page for >16 step sequences
  heldButton: HeldButtonTarget | null  // which button is held for hold combos
  holdEncoderUsed: boolean    // whether encoder was turned during current hold
  randParam: number           // 0-12: selected parameter row in RAND screen
  randPresetIndex: number     // which preset is highlighted (0 to total presets-1)
  nameChars: number[]         // character indices for name-entry mode (max 12)
  nameCursor: number          // cursor position in name-entry (0 to nameChars.length-1)
  mutateParam: number         // 0-8: selected row in DRIFT screen (7 subtracks + trigger + bars)
  routeParam: number          // 0-3: selected param row in ROUTE screen (gate/pitch/vel/mod)
  routePage: number           // 0=routing, 1=midi
  midiDevices: Array<{ id: string; name: string }>  // available MIDI output devices
  midiDeviceIndex: number     // selected MIDI device index per output (into midiDevices)
}

export interface LEDState {
  /** 16 step button LEDs */
  steps: Array<'off' | 'on' | 'dim' | 'flash'>
  /** 4 track button LEDs */
  tracks: Array<'off' | 'on'>
  /** Play button LED */
  play: 'off' | 'on' | 'pulse'
}
