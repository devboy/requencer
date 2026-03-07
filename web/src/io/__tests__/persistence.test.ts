import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock localStorage before importing the module (it accesses localStorage at module scope)
const store = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => store.set(key, value)),
  removeItem: vi.fn((key: string) => store.delete(key)),
  clear: vi.fn(() => store.clear()),
}
vi.stubGlobal('localStorage', localStorageMock)

// btoa/atob are available in Node 16+, but stub if missing
if (typeof globalThis.btoa === 'undefined') {
  vi.stubGlobal('btoa', (s: string) => Buffer.from(s, 'binary').toString('base64'))
  vi.stubGlobal('atob', (s: string) => Buffer.from(s, 'base64').toString('binary'))
}

const { saveState, loadState, saveLibrary, loadLibrary, clearState, clearLibrary } = await import('../persistence')

beforeEach(() => {
  store.clear()
  vi.clearAllMocks()
})

describe('saveState / loadState', () => {
  it('roundtrips binary data through localStorage', () => {
    const data = new Uint8Array([0, 1, 2, 127, 128, 255])
    saveState(data)
    const loaded = loadState()
    expect(loaded).toEqual(data)
  })

  it('returns null when no state is saved', () => {
    expect(loadState()).toBeNull()
  })

  it('returns null for empty array (btoa produces empty string, treated as missing)', () => {
    saveState(new Uint8Array(0))
    // Empty Uint8Array → btoa("") → "" → getItem returns "" → !raw is true → null
    expect(loadState()).toBeNull()
  })
})

describe('saveLibrary / loadLibrary', () => {
  it('roundtrips binary data through localStorage', () => {
    const data = new Uint8Array([10, 20, 30, 40])
    saveLibrary(data)
    const loaded = loadLibrary()
    expect(loaded).toEqual(data)
  })

  it('returns null when no library is saved', () => {
    expect(loadLibrary()).toBeNull()
  })
})

describe('clearState / clearLibrary', () => {
  it('clears saved state', () => {
    saveState(new Uint8Array([1, 2, 3]))
    clearState()
    expect(loadState()).toBeNull()
  })

  it('clears saved library', () => {
    saveLibrary(new Uint8Array([1, 2, 3]))
    clearLibrary()
    expect(loadLibrary()).toBeNull()
  })

  it('state and library are independent', () => {
    saveState(new Uint8Array([1]))
    saveLibrary(new Uint8Array([2]))
    clearState()
    expect(loadState()).toBeNull()
    expect(loadLibrary()).toEqual(new Uint8Array([2]))
  })
})
