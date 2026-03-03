import type { SavedPattern, UserPreset } from '../engine/types'

const PATTERNS_KEY = 'requencer:patterns'
const PRESETS_KEY = 'requencer:presets'

export function savePatterns(patterns: SavedPattern[]): void {
  try {
    localStorage.setItem(PATTERNS_KEY, JSON.stringify(patterns))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function loadPatterns(): SavedPattern[] {
  try {
    const raw = localStorage.getItem(PATTERNS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as SavedPattern[]
  } catch {
    return []
  }
}

export function savePresets(presets: UserPreset[]): void {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify(presets))
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

export function loadPresets(): UserPreset[] {
  try {
    const raw = localStorage.getItem(PRESETS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as UserPreset[]
  } catch {
    return []
  }
}
