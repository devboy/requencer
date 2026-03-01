/**
 * Hardware UI types — screen modes, control events, UI state.
 * Pure types, no dependencies on DOM/audio.
 *
 * Navigation model:
 *   T1-T4 buttons: select track (cross-modal — works in any screen)
 *   GATE/PTCH/VEL/MOD buttons: enter subtrack edit screens
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

export type ControlEvent =
  | { type: 'encoder-a-turn'; delta: number }
  | { type: 'encoder-a-push' }
  | { type: 'encoder-b-turn'; delta: number }
  | { type: 'encoder-b-push' }
  | { type: 'play-stop' }
  | { type: 'reset' }
  | { type: 'track-select'; track: number }      // T1-T4 (0-3)
  | { type: 'subtrack-select'; subtrack: SubtrackId }
  | { type: 'feature-press'; feature: FeatureId }
  | { type: 'step-press'; step: number }          // 0-15
  | { type: 'hold-start'; button: HeldButtonTarget }
  | { type: 'hold-end' }

export type SubtrackId = 'gate' | 'pitch' | 'velocity' | 'mod'
export type FeatureId = 'mute' | 'route' | 'rand'

/** Describes which button is being held for hold combos */
export type HeldButtonTarget =
  | { kind: 'track'; track: number }        // T1-T4 (0-3)
  | { kind: 'subtrack'; subtrack: SubtrackId }
  | { kind: 'feature'; feature: FeatureId }

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
  routeParam: number          // 0-3: selected param row in ROUTE screen (gate/pitch/vel/mod)
}

export interface LEDState {
  /** 16 step button LEDs */
  steps: Array<'off' | 'on' | 'dim' | 'flash'>
  /** 4 track button LEDs */
  tracks: Array<'off' | 'on'>
  /** Play button LED */
  play: 'off' | 'on' | 'pulse'
}
