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
    return parsed
      .map(migratePattern)
      .filter((p): p is SavedPattern => p !== null)
  } catch {
    return []
  }
}

/** Migrate old 4-slot format to new single-track format */
function migratePattern(raw: unknown): SavedPattern | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>

  // New format: has 'data' field
  if ('data' in obj && 'name' in obj) {
    return obj as unknown as SavedPattern
  }

  // Old format: has 'slots' array — extract first non-null slot
  if ('slots' in obj && Array.isArray(obj.slots) && 'name' in obj) {
    const slots = obj.slots as unknown[]
    const firstIdx = slots.findIndex((s) => s !== null)
    if (firstIdx === -1) return null
    return {
      name: obj.name as string,
      data: slots[firstIdx] as SavedPattern['data'],
      sourceTrack: firstIdx,
    }
  }

  return null
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
