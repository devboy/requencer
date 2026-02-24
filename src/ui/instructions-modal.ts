/**
 * Instructions modal — explains the sequencer concept and workflow.
 * Accessible from the debug menu.
 */

const SECTIONS: { title: string; body: string }[] = [
  {
    title: 'WHAT IS THIS?',
    body: 'A 4-track eurorack-style step sequencer. Each track generates CV/gate output for a synth voice. Designed around polymetric randomization — quick-generate musical patterns at independent lengths, then sculpt.',
  },
  {
    title: 'TRACKS & SUBTRACKS',
    body: 'Each track has 4 independent subtracks: gate (rhythm), pitch (melody), velocity (dynamics), mod (modulation). Each subtrack has its own step length (1–64) and clock divider — so a track can have a 7-step gate pattern running at ÷2 alongside a 12-step pitch pattern at ÷1, creating evolving polymetric sequences.',
  },
  {
    title: 'RANDOMIZER',
    body: `Press D to open the RAND screen. Configure per-track: musical scale & root, pitch range, max distinct notes, fill density (min/max %), gate algorithm (euclidean or random), velocity range. Use Enc A to scroll params, Enc B to adjust values, Enc A push to apply a preset or save your own.

Quick randomize: Hold a track button (1–4) + D to regenerate all subtracks. Hold a subtrack button (Q/W/E) + D to regenerate only that layer. Hold D alone to randomize everything.`,
  },
  {
    title: 'PRESETS',
    body: '6 factory presets shape the randomizer: Bassline (minor pent, euclidean grooves), Hypnotic (dense, repetitive), Acid (blues scale, wide velocity), Ambient (sparse, major), Percussive (chromatic, high velocity), Sparse (dorian, light fills). Save custom presets from the RAND screen.',
  },
  {
    title: 'HOLD COMBOS',
    body: 'Hold any track/subtrack/feature button + use encoders or press other buttons to access secondary functions. On screen: hold physically or double-tap for sticky hold. Reference: press ? for the full keymap.',
  },
  {
    title: 'ROUTING',
    body: 'Press S to enter the route screen. Each track\'s 4 subtrack outputs (gate/pitch/vel/mod) can be freely routed to any of the 4 output jacks (A–D), enabling multi-voice or layered configurations.',
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
    max-width: 560px; width: 90%; max-height: 85vh; overflow-y: auto;
  `

  const title = document.createElement('h2')
  title.textContent = 'INSTRUCTIONS'
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

    const body = document.createElement('div')
    body.style.cssText = 'color: #aaa; line-height: 1.5; white-space: pre-wrap;'
    body.textContent = section.body
    card.appendChild(body)
  }

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
