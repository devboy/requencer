/**
 * Manual modal — renders docs/manual.md, the single source of truth
 * shared with the README. Toggle from the MANUAL button or debug menu.
 */

import { marked } from 'marked'
import manualSource from '../../../docs/manual.md?raw'

export function renderManualHtml(markdown: string): string {
  return marked.parse(markdown, { async: false })
}

const MANUAL_CSS = `
  .manual-body h1 { margin: 0 0 16px; font-size: 15px; color: #fff; letter-spacing: 2px; text-align: center; }
  .manual-body h2 { font-size: 11px; color: #888; letter-spacing: 1.5px; margin: 18px 0 6px; border-bottom: 1px solid #333; padding-bottom: 4px; text-transform: uppercase; }
  .manual-body p, .manual-body li { color: #aaa; line-height: 1.5; margin: 6px 0; }
  .manual-body ul { padding-left: 18px; margin: 6px 0; }
  .manual-body strong { color: #ddd; }
  .manual-body code { color: #e8a0bf; }
  .manual-body table { border-collapse: collapse; margin: 8px 0; }
  .manual-body th, .manual-body td { border: 1px solid #333; padding: 3px 8px; color: #aaa; font-size: 12px; text-align: left; }
`

let overlay: HTMLDivElement | null = null

function createOverlay(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  `

  const card = document.createElement('div')
  card.className = 'manual-body'
  card.style.cssText = `
    background: #1a1a2e; border: 1px solid #555; border-radius: 8px;
    padding: 24px 32px; color: #ccc; font: 13px 'JetBrains Mono', monospace;
    max-width: 560px; width: 90%; max-height: 85vh; overflow-y: auto;
  `

  const style = document.createElement('style')
  style.textContent = MANUAL_CSS
  card.appendChild(style)

  const body = document.createElement('div')
  body.innerHTML = renderManualHtml(manualSource)
  card.appendChild(body)

  const hint = document.createElement('div')
  hint.textContent = 'Press any key or click outside to close'
  hint.style.cssText = `
    margin-top: 16px; text-align: center;
    font-size: 11px; color: #666;
  `
  card.appendChild(hint)

  el.appendChild(card)

  // Click outside card to close
  el.addEventListener('click', (e) => {
    if (e.target === el) toggleInstructions()
  })

  return el
}

export function toggleInstructions(): void {
  if (overlay) {
    overlay.remove()
    overlay = null
  } else {
    overlay = createOverlay()
    document.body.appendChild(overlay)
  }
}

export function isInstructionsOpen(): boolean {
  return overlay !== null
}
