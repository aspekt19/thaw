import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHECK_TOP, FULL_DEEP, LIGHT_DEEP, RANK_WINDOW_MS, rankCounterparties, type RankedTransfer } from './rank.ts'
import { timelinePdf } from './pdf.ts'

describe('case ranking', () => {
  it('keeps 14 days, the top 20, and deep 3 or 10', () => {
    const now = Date.parse('2026-11-02T00:00:00Z')
    const rows: RankedTransfer[] = []
    for (let i = 0; i < 25; i += 1) {
      rows.push({
        address: `0x${i.toString(16).padStart(40, '0')}`,
        raw: String(1000 - i),
        timeMs: now - (i === 21 ? RANK_WINDOW_MS + 1 : 1000),
        chain: 'ethereum',
      })
    }
    const light = rankCounterparties(rows, now, 'light')
    assert.equal(light.length, CHECK_TOP)
    assert.equal(light.filter((row) => row.deep).length, LIGHT_DEEP)
    assert.equal(light[0]?.raw, '1000')
    assert.equal(rankCounterparties(rows, now, 'full').filter((row) => row.deep).length, FULL_DEEP)
    assert.equal(light.some((row) => row.raw === String(1000 - 21)), false)
  })

  it('writes a PDF timeline', () => {
    const pdf = new TextDecoder().decode(timelinePdf(['Case file', 'No promise of release']))
    assert.match(pdf, /^%PDF-1.4/)
    assert.match(pdf, /Case file/)
    const long = timelinePdf([...Array.from({ length: 45 }, (_, index) => `row ${index} ${'word '.repeat(30)}`), 'Appeal draft body stays whole'])
    const text = new TextDecoder().decode(long)
    assert.match(text, /Appeal draft body stays whole/)
    assert.ok((text.match(/\/Type \/Page /g) ?? []).length >= 2)
    assert.match(pdf, /%%EOF/)
  })
})
