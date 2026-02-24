/**
 * Debug menu — always-visible panel for BPM control and drum backing track.
 */

import type { DrumMachine } from '../io/drum-machine'
import { toggleHelp } from './help-modal'
import { toggleInstructions } from './instructions-modal'

export interface DebugActions {
  getBpm(): number
  setBpm(bpm: number): void
  togglePlay(): void
  clearTrack(): void
  drums: DrumMachine
}

const BTN_CSS = `
  display: block; width: 100%; padding: 6px; margin-bottom: 6px;
  background: #2a2a4e; border: 1px solid #555; color: #fff;
  font: 13px monospace; border-radius: 3px; cursor: pointer;
`

export function createDebugMenu(actions: DebugActions): void {
  const el = document.createElement('div')
  el.id = 'debug-menu'
  el.style.cssText = `
    position: fixed; top: 12px; right: 12px; z-index: 9999;
    background: #1a1a2e; border: 1px solid #444; border-radius: 6px;
    padding: 12px 16px; color: #ccc; font: 13px monospace;
    min-width: 180px;
  `

  // BPM row
  const bpmRow = document.createElement('div')
  bpmRow.style.cssText = 'margin-bottom: 8px; display: flex; align-items: center; gap: 8px;'
  const bpmLabel = document.createElement('span')
  bpmLabel.textContent = 'BPM'
  const bpmInput = document.createElement('input')
  bpmInput.type = 'number'
  bpmInput.min = '20'
  bpmInput.max = '300'
  bpmInput.value = String(actions.getBpm())
  bpmInput.style.cssText = `
    width: 60px; background: #0a0a1a; border: 1px solid #555;
    color: #fff; padding: 2px 6px; font: 13px monospace; border-radius: 3px;
  `
  bpmInput.addEventListener('change', () => {
    const v = parseInt(bpmInput.value, 10)
    if (v >= 20 && v <= 300) actions.setBpm(v)
  })
  bpmRow.append(bpmLabel, bpmInput)

  // Drums toggle
  const drumsBtn = document.createElement('button')
  drumsBtn.textContent = 'Drums: OFF'
  drumsBtn.style.cssText = BTN_CSS
  drumsBtn.addEventListener('click', () => {
    actions.drums.enabled = !actions.drums.enabled
    drumsBtn.textContent = `Drums: ${actions.drums.enabled ? 'ON' : 'OFF'}`
    drumsBtn.style.background = actions.drums.enabled ? '#2e5a2e' : '#2a2a4e'
  })

  // Button row: Play + Clear side by side
  const btnRow = document.createElement('div')
  btnRow.style.cssText = 'display: flex; gap: 6px;'

  const playBtn = document.createElement('button')
  playBtn.textContent = 'Play / Stop'
  playBtn.style.cssText = BTN_CSS + 'flex: 1;'
  playBtn.addEventListener('click', () => actions.togglePlay())

  const clearBtn = document.createElement('button')
  clearBtn.textContent = 'Clear Trk'
  clearBtn.style.cssText = BTN_CSS + 'flex: 1; background: #4e2a2a;'
  clearBtn.addEventListener('click', () => actions.clearTrack())

  // Help button
  const helpBtn = document.createElement('button')
  helpBtn.textContent = 'Keys (?)'
  helpBtn.style.cssText = BTN_CSS + 'background: #3a3a5e;'
  helpBtn.addEventListener('click', () => toggleHelp())

  // Instructions button
  const instrBtn = document.createElement('button')
  instrBtn.textContent = 'Instructions'
  instrBtn.style.cssText = BTN_CSS + 'background: #3a3a5e;'
  instrBtn.addEventListener('click', () => toggleInstructions())

  btnRow.append(playBtn, clearBtn)
  el.append(bpmRow, drumsBtn, btnRow, helpBtn, instrBtn)
  document.body.appendChild(el)
}
