/**
 * Help modal — shows all keyboard shortcuts in a styled overlay.
 * Toggle with the "?" key or the help button in the debug menu.
 */

const SECTIONS: { title: string; keys: [string, string][] }[] = [
  {
    title: 'TRANSPORT',
    keys: [
      ['Space', 'Play / Stop'],
      ['Backspace', 'Reset'],
    ],
  },
  {
    title: 'TRACKS',
    keys: [
      ['1 – 4', 'Select track T1–T4'],
    ],
  },
  {
    title: 'SUBTRACKS',
    keys: [
      ['Q', 'Gate edit'],
      ['W', 'Pitch edit'],
      ['E', 'Velocity edit'],
      ['R', 'Mod edit'],
    ],
  },
  {
    title: 'FEATURES',
    keys: [
      ['A', 'Mute patterns'],
      ['S', 'Route outputs'],
      ['D', 'Randomizer'],
      ['F', 'Clock dividers'],
    ],
  },
  {
    title: 'STEP ENTRY',
    keys: [
      ['Z X C V B N M ,', 'Steps 1–8'],
      ['Shift + above', 'Steps 9–16'],
    ],
  },
  {
    title: 'NAVIGATION',
    keys: [
      ['↑ / ↓', 'Encoder A (value / scroll)'],
      ['← / →', 'Encoder B (page / param)'],
      ['Enter', 'Confirm / push A'],
      ['Escape', 'Back / push B'],
    ],
  },
  {
    title: 'HOLD COMBOS',
    keys: [
      ['Hold 1–4 + ↑↓', 'Track length / divider'],
      ['Hold Q/W/E + ↑↓', 'Subtrack length / divider'],
      ['Hold A + ↑↓', 'Mute length / divider'],
      ['Hold 1–4 + D', 'Randomize selected track'],
      ['Hold D', 'Quick randomize all'],
      ['Double-tap key', 'Sticky hold (tap again to release)'],
    ],
  },
]

let overlay: HTMLDivElement | null = null

function createOverlay(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.7); backdrop-filter: blur(4px);
  `

  const card = document.createElement('div')
  card.style.cssText = `
    background: #1a1a2e; border: 1px solid #555; border-radius: 8px;
    padding: 24px 32px; color: #ccc; font: 13px 'JetBrains Mono', monospace;
    max-width: 520px; width: 90%; max-height: 85vh; overflow-y: auto;
  `

  const title = document.createElement('h2')
  title.textContent = 'KEYBOARD SHORTCUTS'
  title.style.cssText = `
    margin: 0 0 16px; font-size: 15px; color: #fff;
    letter-spacing: 2px; text-align: center;
  `
  card.appendChild(title)

  for (const section of SECTIONS) {
    const heading = document.createElement('div')
    heading.textContent = section.title
    heading.style.cssText = `
      font-size: 11px; color: #888; letter-spacing: 1.5px;
      margin: 14px 0 6px; border-bottom: 1px solid #333; padding-bottom: 4px;
    `
    card.appendChild(heading)

    for (const [key, desc] of section.keys) {
      const row = document.createElement('div')
      row.style.cssText = 'display: flex; justify-content: space-between; padding: 3px 0;'

      const k = document.createElement('span')
      k.textContent = key
      k.style.cssText = 'color: #e8a0bf; font-weight: bold;'

      const d = document.createElement('span')
      d.textContent = desc
      d.style.cssText = 'color: #aaa; text-align: right;'

      row.append(k, d)
      card.appendChild(row)
    }
  }

  const hint = document.createElement('div')
  hint.textContent = 'Press ? or click outside to close'
  hint.style.cssText = `
    margin-top: 16px; text-align: center;
    font-size: 11px; color: #666;
  `
  card.appendChild(hint)

  el.appendChild(card)

  // Click outside card to close
  el.addEventListener('click', (e) => {
    if (e.target === el) toggleHelp()
  })

  return el
}

export function toggleHelp(): void {
  if (overlay) {
    overlay.remove()
    overlay = null
  } else {
    overlay = createOverlay()
    document.body.appendChild(overlay)
  }
}

export function isHelpOpen(): boolean {
  return overlay !== null
}
