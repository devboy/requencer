import { describe, expect, it } from 'vitest'
import manualSource from '../../../../docs/manual.md?raw'
import { renderManualHtml } from '../instructions-modal'

describe('manual rendering', () => {
  it('converts markdown headings to HTML', () => {
    const html = renderManualHtml('# Title\n\n## Section\n\nbody text')
    expect(html).toContain('<h1')
    expect(html).toContain('<h2')
    expect(html).toContain('body text')
  })

  it('renders tables', () => {
    const html = renderManualHtml('| a | b |\n|---|---|\n| 1 | 2 |')
    expect(html).toContain('<table')
  })

  it('the real manual contains the expected sections', () => {
    expect(manualSource.startsWith('# Requencer Manual')).toBe(true)
    for (const section of [
      '## Quick start (mouse & touch)',
      '## Tracks & subtracks',
      '## Randomizer',
      '## Keyboard shortcuts',
    ]) {
      expect(manualSource).toContain(section)
    }
  })

  it('the real manual renders without error', () => {
    const html = renderManualHtml(manualSource)
    expect(html).toContain('<h1')
    expect(html.length).toBeGreaterThan(1000)
  })
})
