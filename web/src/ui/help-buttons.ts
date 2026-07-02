/**
 * Always-visible MANUAL and ? buttons (bottom-right), plus first-visit
 * auto-open of the manual so new visitors get an explanation up front.
 */

import { toggleHelp } from './help-modal'
import { isInstructionsOpen, toggleInstructions } from './instructions-modal'

const SEEN_KEY = 'requencer-manual-seen'

export interface KeyValueStore {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

/** True exactly once per store — marks the store as seen. */
export function shouldAutoOpenManual(store: KeyValueStore): boolean {
  if (store.getItem(SEEN_KEY)) return false
  store.setItem(SEEN_KEY, '1')
  return true
}

const BTN_CSS = `
  padding: 6px 12px; background: #1a1a2e; border: 1px solid #444;
  color: #ccc; font: 13px monospace; border-radius: 6px; cursor: pointer;
`

export function createHelpButtons(): void {
  const bar = document.createElement('div')
  bar.style.cssText = `
    position: fixed; bottom: 12px; right: 12px; z-index: 9998;
    display: flex; gap: 6px;
  `

  const manualBtn = document.createElement('button')
  manualBtn.textContent = 'MANUAL'
  manualBtn.style.cssText = BTN_CSS
  manualBtn.addEventListener('click', () => toggleInstructions())

  const keysBtn = document.createElement('button')
  keysBtn.textContent = '?'
  keysBtn.style.cssText = BTN_CSS
  keysBtn.title = 'Keyboard shortcuts'
  keysBtn.addEventListener('click', () => toggleHelp())

  bar.append(manualBtn, keysBtn)
  document.body.appendChild(bar)
}

export function maybeAutoOpenManual(store?: KeyValueStore): void {
  let s = store
  if (!s) {
    try {
      s = window.localStorage
    } catch {
      return // storage blocked (privacy mode) — skip auto-open
    }
  }
  let autoOpen = false
  try {
    autoOpen = shouldAutoOpenManual(s)
  } catch {
    return // getItem/setItem threw (privacy mode, storage full) — skip auto-open
  }
  if (autoOpen && !isInstructionsOpen()) toggleInstructions()
}
