/**
 * Persistence — stores opaque byte blobs from Rust serialization in localStorage.
 * Rust owns all serialization (postcard). TS just stores/retrieves raw bytes.
 */

const STATE_KEY = 'requencer:state'
const LIBRARY_KEY = 'requencer:library'

// Clean up old JSON-format keys from previous TS persistence
try {
  localStorage.removeItem('requencer:patterns')
  localStorage.removeItem('requencer:presets')
} catch {
  /* */
}

/** Encode bytes to base64 string for localStorage. */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

/** Decode base64 string from localStorage to bytes. */
function fromBase64(str: string): Uint8Array {
  const binary = atob(str)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

export function saveState(bytes: Uint8Array): void {
  try {
    localStorage.setItem(STATE_KEY, toBase64(bytes))
  } catch {
    // localStorage full or unavailable
  }
}

export function loadState(): Uint8Array | null {
  try {
    const raw = localStorage.getItem(STATE_KEY)
    if (!raw) return null
    return fromBase64(raw)
  } catch {
    return null
  }
}

export function saveLibrary(bytes: Uint8Array): void {
  try {
    localStorage.setItem(LIBRARY_KEY, toBase64(bytes))
  } catch {
    // localStorage full or unavailable
  }
}

export function loadLibrary(): Uint8Array | null {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (!raw) return null
    return fromBase64(raw)
  } catch {
    return null
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STATE_KEY)
  } catch {
    /* */
  }
}

export function clearLibrary(): void {
  try {
    localStorage.removeItem(LIBRARY_KEY)
  } catch {
    /* */
  }
}
