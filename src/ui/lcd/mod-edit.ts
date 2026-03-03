/**
 * LCD MOD Edit screen — two views toggled by encoder-a-push:
 *   1. MOD SEQ: step sequencer bar grid (2x8) with per-step value/slew
 *   2. MOD LFO: animated waveform preview with parameter list
 * All text >=16px for readability on 3.5" TFT at 50cm.
 */

import type { SequencerState, LFOConfig, LFOWaveform } from '../../engine/types'
import type { UIState } from '../hw-types'
import { COLORS } from '../colors'
import { fillRect, strokeRect, drawText, LCD_W, LCD_CONTENT_Y, LCD_CONTENT_H } from '../renderer'
import { waveformValue } from '../../engine/lfo'

const PAD = 8
const HEADER_H = 42
const STEP_AREA_TOP = LCD_CONTENT_Y + HEADER_H
const COLS = 8
const ROW_GAP = 8
const COL_GAP = 2
const STEP_W = (LCD_W - PAD * 2 - (COLS - 1) * COL_GAP) / COLS
const AVAIL_H = LCD_CONTENT_H - HEADER_H - 4
const BAR_MAX_H = (AVAIL_H - ROW_GAP) / 2

function clamp01(v: number): number { return Math.max(0, Math.min(1, v)) }

/** Stable seeded random for waveform preview — deterministic per segment index. */
function previewRng(seed: number): number {
  let t = (seed * 7919 + 31) | 0
  t = (t + 0x6d2b79f5) | 0
  let r = Math.imul(t ^ (t >>> 15), 1 | t)
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
  return ((r ^ (r >>> 14)) >>> 0) / 4294967296
}

export function renderModEdit(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  if (ui.modLfoView) {
    renderModLfo(ctx, engine, ui)
  } else {
    renderModSeq(ctx, engine, ui)
  }
}

// --- MOD SEQ view (step bars) ---

function renderModSeq(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const track = engine.tracks[ui.selectedTrack]
  const trackColor = COLORS.track[ui.selectedTrack]
  const pageOffset = ui.currentPage * 16
  const maxPage = Math.max(0, Math.ceil(track.mod.length / 16) - 1)

  // Title
  drawText(ctx, `MOD SEQ — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)

  // Selected step info — value% and slew%
  const selIdx = pageOffset + ui.selectedStep
  if (selIdx < track.mod.length) {
    const modStep = track.mod.steps[selIdx]
    const valPct = Math.round(modStep.value * 100)
    const slewPct = Math.round(modStep.slew * 100)
    drawText(ctx, `${valPct}%  slew ${slewPct}%`, PAD, LCD_CONTENT_Y + 36, COLORS.textBright, 16)
  }

  // Right side info
  let infoText = `LEN ${track.mod.length}`
  if (track.mod.clockDivider > 1) infoText += `  ÷${track.mod.clockDivider}`
  if (maxPage > 0) infoText += `  P${ui.currentPage + 1}/${maxPage + 1}`
  drawText(ctx, infoText, LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textDim, 16, 'right')

  // Step bars — 2 rows of 8
  for (let row = 0; row < 2; row++) {
    const barBaseY = STEP_AREA_TOP + (row + 1) * BAR_MAX_H + row * ROW_GAP
    for (let col = 0; col < COLS; col++) {
      const i = row * COLS + col
      const stepIdx = pageOffset + i
      const x = PAD + col * (STEP_W + COL_GAP)

      if (stepIdx >= track.mod.length) {
        fillRect(ctx, { x, y: barBaseY - 2, w: STEP_W, h: 2 }, '#111118')
        continue
      }

      const normalized = track.mod.steps[stepIdx].value // already 0.0-1.0
      const barH = Math.max(2, normalized * BAR_MAX_H)
      const barY = barBaseY - barH
      const isSelected = i === ui.selectedStep
      const color = isSelected ? COLORS.textBright : trackColor

      fillRect(ctx, { x, y: barY, w: STEP_W, h: barH }, color)

      if (isSelected) {
        strokeRect(ctx, { x: x - 1, y: barY - 1, w: STEP_W + 2, h: barH + 2 }, '#ffffff', 1)
      }

      // Playhead
      if (stepIdx === track.mod.currentStep) {
        fillRect(ctx, { x, y: barBaseY + 2, w: STEP_W, h: 3 }, '#ffffff')
      }
    }
  }
}

// --- MOD LFO view (animated waveform + params) ---

const WAVE_X = PAD
const WAVE_W = LCD_W - PAD * 2
const WAVE_TOP = LCD_CONTENT_Y + HEADER_H
const WAVE_H = 120
const WAVE_BOT = WAVE_TOP + WAVE_H
const WAVE_SAMPLES = 120 // sample points for waveform curve

const LFO_PARAM_LABELS = ['WAVE', 'SYNC', 'RATE', 'DEPTH', 'OFFS', 'WIDTH', 'PHASE']
const LFO_WAVEFORM_NAMES: Record<LFOWaveform, string> = {
  'sine': 'SINE',
  'triangle': 'TRI',
  'saw': 'SAW',
  'square': 'SQR',
  'slew-random': 'SLEW',
  's+h': 'S+H',
}

function renderModLfo(ctx: CanvasRenderingContext2D, engine: SequencerState, ui: UIState): void {
  const trackColor = COLORS.track[ui.selectedTrack]
  const config = engine.lfoConfigs[ui.selectedTrack]
  const runtime = engine.lfoRuntimes[ui.selectedTrack]

  // Title
  drawText(ctx, `MOD LFO — T${ui.selectedTrack + 1}`, PAD, LCD_CONTENT_Y + 18, trackColor, 18)
  drawText(ctx, LFO_WAVEFORM_NAMES[config.waveform], LCD_W - PAD, LCD_CONTENT_Y + 18, COLORS.textBright, 16, 'right')

  // Waveform info line
  const rateText = config.syncMode === 'free'
    ? `${config.freeRate.toFixed(1)}Hz`
    : `÷${config.rate}`
  const depthPct = Math.round(config.depth * 100)
  drawText(ctx, `${rateText}  D${depthPct}%`, PAD, LCD_CONTENT_Y + 36, COLORS.textDim, 16)

  // --- Waveform preview area ---
  // Background
  fillRect(ctx, { x: WAVE_X, y: WAVE_TOP, w: WAVE_W, h: WAVE_H }, '#0d0d1a')
  strokeRect(ctx, { x: WAVE_X, y: WAVE_TOP, w: WAVE_W, h: WAVE_H }, '#1a1a30', 1)

  // Center line (0.5 value)
  const centerY = WAVE_TOP + WAVE_H * (1 - config.offset)
  ctx.strokeStyle = '#1a1a30'
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(WAVE_X, centerY)
  ctx.lineTo(WAVE_X + WAVE_W, centerY)
  ctx.stroke()
  ctx.setLineDash([])

  // Draw waveform curve — render with depth/offset applied
  ctx.strokeStyle = trackColor
  ctx.lineWidth = 2
  ctx.beginPath()

  if (config.waveform === 's+h') {
    // S+H preview: stepped random values, one per segment
    const segments = Math.max(2, Math.round(config.rate))
    const segW = WAVE_W / segments
    for (let seg = 0; seg < segments; seg++) {
      const raw = previewRng(seg)
      const scaled = clamp01(config.offset + (raw - 0.5) * config.depth)
      const y = WAVE_TOP + WAVE_H * (1 - scaled)
      const x0 = WAVE_X + seg * segW
      const x1 = WAVE_X + (seg + 1) * segW
      if (seg === 0) ctx.moveTo(x0, y)
      else ctx.lineTo(x0, y)
      ctx.lineTo(x1, y)
    }
    ctx.stroke()
  } else if (config.waveform === 'slew-random') {
    // Slew-random preview: smooth interpolation between random targets
    const segments = Math.max(2, Math.round(config.rate))
    // Generate random target values for each segment boundary
    const targets: number[] = []
    for (let i = 0; i <= segments; i++) targets.push(previewRng(i))
    // Wrap last target to first for continuity
    targets[segments] = targets[0]

    const slewRate = 1 - config.width * 0.95
    let current = targets[0]

    for (let s = 0; s <= WAVE_SAMPLES; s++) {
      const phase = s / WAVE_SAMPLES
      const segFloat = phase * segments
      const segIdx = Math.min(Math.floor(segFloat), segments - 1)
      const segPhase = segFloat - segIdx
      // Simulate slew: interpolate from previous segment's settled value toward current target
      const target = targets[segIdx]
      const prevTarget = segIdx > 0 ? targets[segIdx - 1] : targets[segments - 1]
      // Approximate settled value at segment start
      const startVal = prevTarget + (target - prevTarget) * slewRate
      // Interpolate within segment
      const raw = startVal + (target - startVal) * (1 - Math.pow(1 - slewRate, segPhase * 4))
      const scaled = clamp01(config.offset + (raw - 0.5) * config.depth)
      const x = WAVE_X + phase * WAVE_W
      const y = WAVE_TOP + WAVE_H * (1 - scaled)
      if (s === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  } else {
    // Deterministic waveforms: draw smooth curve
    for (let s = 0; s <= WAVE_SAMPLES; s++) {
      const phase = s / WAVE_SAMPLES
      const raw = waveformValue(config.waveform, phase, config.width)
      const scaled = clamp01(config.offset + (raw - 0.5) * config.depth)
      const x = WAVE_X + phase * WAVE_W
      const y = WAVE_TOP + WAVE_H * (1 - scaled)
      if (s === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  // Animated phase cursor — vertical line at current LFO phase
  if (engine.transport.playing) {
    const cursorX = WAVE_X + runtime.currentPhase * WAVE_W
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cursorX, WAVE_TOP)
    ctx.lineTo(cursorX, WAVE_BOT)
    ctx.stroke()

    // Dot at current value on the cursor
    const currentVal = computeDisplayValue(config, runtime)
    const dotY = WAVE_TOP + WAVE_H * (1 - currentVal)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cursorX, dotY, 4, 0, Math.PI * 2)
    ctx.fill()
  }

  // --- Parameter rows below waveform ---
  const paramTop = WAVE_BOT + 8
  const paramH = Math.floor((LCD_CONTENT_Y + LCD_CONTENT_H - paramTop) / 4)
  const paramColW = Math.floor(WAVE_W / 2)

  for (let i = 0; i < LFO_PARAM_LABELS.length; i++) {
    const col = i < 4 ? 0 : 1
    const row = i < 4 ? i : i - 4
    const x = PAD + col * paramColW
    const y = paramTop + row * paramH
    const isSelected = i === ui.modLfoParam

    // Highlight selected row
    if (isSelected) {
      fillRect(ctx, { x, y, w: paramColW - 4, h: paramH - 2 }, `${trackColor}22`)
    }

    // Label
    const labelColor = isSelected ? COLORS.text : COLORS.textDim
    drawText(ctx, LFO_PARAM_LABELS[i], x + 4, y + paramH / 2 - 1, labelColor, 16)

    // Value
    const valText = getLfoParamValue(config, i)
    const valColor = isSelected ? COLORS.textBright : COLORS.text
    drawText(ctx, valText, x + paramColW - 8, y + paramH / 2 - 1, valColor, 16, 'right')
  }
}

/** Compute a display value for the LFO cursor dot using config + runtime. */
function computeDisplayValue(config: LFOConfig, runtime: import('../../engine/types').LFORuntime): number {
  // For random waveforms, use the runtime's stored values
  if (config.waveform === 's+h') {
    return Math.max(0, Math.min(1, config.offset + (runtime.lastSHValue - 0.5) * config.depth))
  }
  if (config.waveform === 'slew-random') {
    return Math.max(0, Math.min(1, config.offset + (runtime.slewCurrent - 0.5) * config.depth))
  }
  // For deterministic waveforms, compute from phase
  const raw = waveformValue(config.waveform, runtime.currentPhase, config.width)
  return Math.max(0, Math.min(1, config.offset + (raw - 0.5) * config.depth))
}

/** Format an LFO parameter value for display. */
function getLfoParamValue(config: LFOConfig, paramIdx: number): string {
  switch (paramIdx) {
    case 0: return LFO_WAVEFORM_NAMES[config.waveform]
    case 1: return config.syncMode === 'track' ? 'SYNC' : 'FREE'
    case 2: return config.syncMode === 'free'
      ? `${config.freeRate.toFixed(1)}Hz`
      : `${config.rate}`
    case 3: return `${Math.round(config.depth * 100)}%`
    case 4: return `${Math.round(config.offset * 100)}%`
    case 5: return `${Math.round(config.width * 100)}%`
    case 6: return `${Math.round(config.phase * 100)}%`
    default: return ''
  }
}
