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
    const parsed = JSON.parse(raw) as unknown[]
    // Filter out old-format or corrupt entries
    return parsed.filter(isValidPattern) as SavedPattern[]
  } catch {
    return []
  }
}

function isValidPattern(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false
  const obj = p as Record<string, unknown>
  return typeof obj.name === 'string' && typeof obj.data === 'object' && obj.data !== null
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
