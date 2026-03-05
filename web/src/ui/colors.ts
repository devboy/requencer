// Dark eurorack-inspired color palette
export const COLORS = {
  bg: '#1a1a2e',
  panel: '#16213e',
  panelLight: '#1c2a4a',
  border: '#0f3460',
  borderLight: '#1a4a7a',

  // Track colors (one per track)
  track: ['#e94560', '#f5a623', '#50c878', '#4fc3f7'] as const,
  trackDim: ['#5a1a28', '#5a3f10', '#1e4a2e', '#1c4a5a'] as const,

  // Step states
  stepOn: '#e94560',
  stepOff: '#2a2a4a',
  stepMuted: '#3a1a28',
  playhead: '#ffffff',
  playheadGlow: 'rgba(255, 255, 255, 0.15)',

  // Text
  text: '#e0e0e0',
  textDim: '#6a6a8a',
  textBright: '#ffffff',

  // UI elements
  accent: '#e94560',
  accentDim: '#8a2a3a',
  buttonBg: '#2a2a4a',
  buttonHover: '#3a3a5a',
  buttonActive: '#4a4a6a',

  // Hardware panel
  faceplate: '#2a2a2e',
  faceplateLabel: '#888888',
  faceplateScrew: '#444444',

  // LCD screen
  lcdBg: '#0a0a14',
  lcdStatusBar: '#12122a',
  lcdSoftBar: '#12122a',
  lcdSoftLabel: '#aaaacc',
  lcdSoftLabelActive: '#ffffff',
  lcdSoftDivider: '#2a2a4a',
  lcdGrid: '#1a1a2e',

  // LED colors
  ledOff: '#1a1a1a',
  ledOn: '#ff3344',
  ledDim: '#662222',
  ledPlayhead: '#ffffff',
  ledTrackOn: '#44aaff',
  ledPlayOn: '#44ff66',
} as const

// Note name lookup
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToNoteName(midi: number): string {
  const octave = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES[midi % 12]}${octave}`
}
