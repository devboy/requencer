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
    body: `Press D to open the RAND screen. Configure per-track: musical scale & root, pitch range, max distinct notes, fill density (min/max %), velocity range, and gate mode. Four gate algorithms: RAND (shuffle), EUCL (euclidean), SYNC (offbeat-biased), CLST (clustered bursts). EUCL has a random offset sub-param, CLST has a continuation probability. Use Enc A to scroll params, Enc B to adjust values, Enc A push to apply a preset or save your own.

Quick randomize: Hold a track button (1–4) + D to regenerate all subtracks. Hold a subtrack button (Q/W/E/R) + D to regenerate only that layer. Hold D alone to randomize everything.`,
  },
  {
    title: 'PRESETS',
    body: '8 factory presets shape the randomizer: Bassline (deep sub, euclidean), Hypnotic (cluster mode, dense rolls), Acid (sync mode, blues scale, slides), Ambient (sparse, major), Percussive (chromatic, ratchets), Sparse (dorian, light fills), Stab (offbeat minor hits), Driving (relentless pulse). Save custom presets from the RAND screen.',
  },
  {
    title: 'DRIFT & TRANSPOSE',
    body: `Press F for DRIFT — per-track stochastic mutation. Each subtrack (gate, pitch, vel, mod) has an independent drift rate. When enabled, steps randomly mutate over time, creating gradual pattern evolution. Higher rates mean faster change.

Press G for TRANSPOSE — per-track transposition. Set semitone offset, note range (low/high), and scale quantization. Transpose applies to the pitch subtrack output in real time.`,
  },
  {
    title: 'HOLD COMBOS',
    body: 'Hold any track/subtrack/feature button + use encoders or press other buttons to access secondary functions. On screen: hold physically or double-tap for sticky hold. Reference: press ? for the full keymap.',
  },
  {
    title: 'ROUTING',
    body: "Press S to enter the route screen. Each track's 4 subtrack outputs (gate/pitch/vel/mod) can be freely routed to any of the 4 output jacks (A–D), enabling multi-voice or layered configurations.",
  },
  {
    title: 'SETTINGS',
    body: 'Press the SET button (jack zone) to open global settings. Clock section: adjust BPM and clock source (INT/MIDI/EXT). MIDI section: global MIDI on/off, device selection, and per-output MIDI channel assignment (1–16).',
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
