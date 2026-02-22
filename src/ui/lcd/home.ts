/**
 * LCD Home screen — 4-track overview with gate/pitch/velocity lanes.
 * Uses full content height. All text ≥16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState, SequenceTrack, RandomConfig } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, drawText, LCD_W, LCD_H, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'

const PAD = 8
const LABEL_W = 36            // space for "T1" label
const GRID_LEFT = PAD + LABEL_W
const GRID_W = LCD_W - GRID_LEFT - PAD
const DISPLAY_STEPS = 16
const GAP = 1
const STEP_W = (GRID_W - (DISPLAY_STEPS - 1) * GAP) / DISPLAY_STEPS

// Use full content height for 4 tracks with info footer
const INFO_H = 22             // compact info line at bottom
const TRACK_GAP = 6
const BAND_H = Math.floor((LCD_CONTENT_H - PAD - INFO_H - 3 * TRACK_GAP) / 4)

// Sub-lane proportions within a band
const GATE_FRAC = 0.22
const PITCH_FRAC = 0.42
const VEL_FRAC = 0.36

export function renderHome(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  for (let i = 0; i < 4; i++) {
    const track = engine.tracks[i]
    const isSelected = i === ui.selectedTrack
    const y = LCD_CONTENT_Y + PAD / 2 + i * (BAND_H + TRACK_GAP)

    renderTrackBand(ctx, track, i, y, isSelected, engine.randomConfigs[i])
  }

  // Info footer — selected track length/div summary
  const t = engine.tracks[ui.selectedTrack]
  const infoY = LCD_H - INFO_H / 2
  const parts: string[] = []
  // Show lengths if they differ, otherwise show shared length
  if (t.gate.length === t.pitch.length && t.pitch.length === t.velocity.length) {
    parts.push(`L${t.gate.length}`)
  } else {
    parts.push(`G:${t.gate.length} P:${t.pitch.length} V:${t.velocity.length}`)
  }
  if (t.clockDivider > 1) parts.push(`÷${t.clockDivider}`)
  // Per-subtrack dividers only if different from 1
  const subDivs: string[] = []
  if (t.gate.clockDivider > 1) subDivs.push(`G÷${t.gate.clockDivider}`)
  if (t.pitch.clockDivider > 1) subDivs.push(`P÷${t.pitch.clockDivider}`)
  if (t.velocity.clockDivider > 1) subDivs.push(`V÷${t.velocity.clockDivider}`)
  if (subDivs.length > 0) parts.push(subDivs.join(' '))

  drawText(ctx, parts.join('  '), PAD, infoY, COLORS.textDim, 16)
}

function renderTrackBand(
  ctx: CanvasRenderingContext2D,
  track: SequenceTrack,
  trackIdx: number,
  y: number,
  isSelected: boolean,
  config: RandomConfig,
): void {
  const trackColor = COLORS.track[trackIdx]
  const dimColor = COLORS.trackDim[trackIdx]

  const gateH = Math.round(BAND_H * GATE_FRAC)
  const pitchH = Math.round(BAND_H * PITCH_FRAC)
  const velH = BAND_H - gateH - pitchH

  // Selected row background tint
  if (isSelected) {
    fillRect(ctx, { x: 0, y, w: LCD_W, h: BAND_H }, `${trackColor}18`)
  }

  // Track label — centered vertically in band
  drawText(ctx, `T${trackIdx + 1}`, PAD, y + BAND_H / 2, isSelected ? trackColor : COLORS.textDim, 18)

  // Gate row
  const gateY = y
  renderGateRow(ctx, track.gate.steps, track.gate.length, track.gate.currentStep, gateY, gateH, trackColor, dimColor)

  // Pitch row
  const pitchY = gateY + gateH
  renderPitchRow(ctx, track.pitch.steps, track.pitch.length, track.pitch.currentStep, pitchY, pitchH, trackColor, config)

  // Velocity row
  const velY = pitchY + pitchH
  renderVelocityRow(ctx, track.velocity.steps, track.velocity.length, track.velocity.currentStep, velY, velH, trackColor)
}

function stepX(i: number): number {
  return GRID_LEFT + i * (STEP_W + GAP)
}

const INACTIVE_BG = '#1a1a2e'

function renderGateRow(
  ctx: CanvasRenderingContext2D,
  steps: boolean[],
  length: number,
  currentStep: number,
  y: number,
  h: number,
  onColor: string,
  offColor: string,
): void {
  for (let i = 0; i < DISPLAY_STEPS; i++) {
    const x = stepX(i)
    if (i < length) {
      fillRect(ctx, { x, y, w: STEP_W, h }, steps[i] ? onColor : offColor)
    } else {
      fillRect(ctx, { x, y, w: STEP_W, h }, INACTIVE_BG)
    }
  }

  if (currentStep < DISPLAY_STEPS) {
    fillRect(ctx, { x: stepX(currentStep), y, w: 2, h }, '#ffffff')
  }
}

function renderPitchRow(
  ctx: CanvasRenderingContext2D,
  steps: number[],
  length: number,
  currentStep: number,
  y: number,
  h: number,
  color: string,
  config: RandomConfig,
): void {
  const minNote = config.pitch.low
  const maxNote = config.pitch.high
  const range = maxNote - minNote || 1

  for (let i = 0; i < DISPLAY_STEPS; i++) {
    const x = stepX(i)
    const normalized = Math.max(0, Math.min(1, (steps[i] - minNote) / range))
    const barH = Math.max(2, normalized * (h - 2))
    const barY = y + h - barH
    const barColor = i < length ? color : INACTIVE_BG
    fillRect(ctx, { x, y: barY, w: STEP_W, h: barH }, barColor)
  }

  if (currentStep < DISPLAY_STEPS) {
    fillRect(ctx, { x: stepX(currentStep), y, w: 2, h }, '#ffffff')
  }
}

function renderVelocityRow(
  ctx: CanvasRenderingContext2D,
  steps: number[],
  length: number,
  currentStep: number,
  y: number,
  h: number,
  color: string,
): void {
  for (let i = 0; i < DISPLAY_STEPS; i++) {
    const x = stepX(i)
    if (i < length) {
      const alpha = steps[i] / 127
      fillRect(ctx, { x, y, w: STEP_W, h }, colorWithAlpha(color, alpha))
    } else {
      fillRect(ctx, { x, y, w: STEP_W, h }, INACTIVE_BG)
    }
  }

  if (currentStep < DISPLAY_STEPS) {
    fillRect(ctx, { x: stepX(currentStep), y, w: 2, h }, '#ffffff')
  }
}

function colorWithAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
