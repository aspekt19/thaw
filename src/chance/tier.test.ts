import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_CONFIG, LIGHT_BLOCKED_NOTE, NO_FABRICATION, chooseTier, recommendTier, upgradeQuote, type TierInput } from './tier.ts'

const base: TierInput = {
  exchange: 'binance',
  verdict: 'high',
  disputedDepositsCount: 1,
  addressesCount: 12,
  fundsSources: ['other_exchange'],
  priorExchangeRejection: false,
  requestedDocs: ['source_of_funds'],
  ownershipProofRequested: false,
  evidence: ['exchange_export'],
}

describe('tier recommendation', () => {
  const cases: Array<[string, Partial<TierInput>, string | null, string, string[]?]> = [
    ['T01', {}, 'light', 'LIGHT_DEFAULT'],
    ['T02', { verdict: 'medium', disputedDepositsCount: 2, fundsSources: ['own_wallet', 'other_exchange'] }, 'light', 'LIGHT_DEFAULT'],
    ['T03', { priorExchangeRejection: true, fundsSources: ['p2p'] }, 'full', 'PRIOR_REJECTION'],
    ['T04', { ownershipProofRequested: true }, 'full', 'OWNERSHIP_REQUESTED'],
    ['T05', { exchange: 'okx', evidence: ['txid_only'] }, 'full', 'OKX_TXID_ONLY'],
    ['T06', { exchange: 'binance', evidence: ['txid_only'] }, 'light', 'LIGHT_DEFAULT'],
    ['T07', { fundsSources: ['other_exchange', 'p2p'] }, 'full', 'COMPLEX_SOURCES'],
    ['T08', { fundsSources: [] }, 'full', 'COMPLEX_SOURCES'],
    ['T09', { disputedDepositsCount: 3 }, 'full', 'MANY_DEPOSITS'],
    ['T10', { requestedDocs: ['bank_statement', 'proof_of_address', 'exchange_statement'] }, 'full', 'MANY_DOCS_REQUESTED'],
    ['T11', { addressesCount: 31 }, 'full', 'MANY_ADDRESSES'],
    ['T12', { addressesCount: 120 }, 'full', 'MANY_ADDRESSES', ['FULL_BUDGET_GUARD']],
    ['T15', { exchange: 'other', addressesCount: null }, 'light', 'LIGHT_DEFAULT', ['ADDRESSES_UNKNOWN', 'GENERIC_EXCHANGE']],
  ]

  for (const [id, patch, tier, reason, flags] of cases) {
    it(id, () => {
      const result = recommendTier({ ...base, ...patch })
      assert.equal(result.status, 'ok')
      assert.equal(result.canOpenCase, true)
      assert.equal(result.tier, tier)
      assert.equal(result.reason, reason)
      assert.equal(result.lowChanceAck.required, false)
      if (flags) {
        for (const flag of flags) assert.ok(result.flags.includes(flag as never))
      }
    })
  }

  it('T13a blocks a low chance when confirmation is missing', () => {
    const result = recommendTier({ ...base, verdict: 'low' })
    assert.equal(result.status, 'blocked_low_chance')
    assert.equal(result.canOpenCase, false)
    assert.equal(result.tier, 'full')
    assert.equal(result.lowChanceAck.required, true)
    assert.equal(result.lowChanceAck.confirmed, false)
    assert.equal(result.lowChanceAck.warnings.length, 4)
  })

  it('T13b blocks a low chance when confirmation is false', () => {
    const result = recommendTier({ ...base, verdict: 'low', userConfirmedLowChance: false })
    assert.equal(result.status, 'blocked_low_chance')
    assert.equal(result.canOpenCase, false)
    assert.equal(result.tier, 'full')
    assert.equal(result.lowChanceAck.required, true)
    assert.equal(result.lowChanceAck.confirmed, false)
    assert.equal(result.lowChanceAck.warnings.length, 4)
  })

  it('T14 refuses a case we cannot take', () => {
    const result = recommendTier({ ...base, verdict: 'cannot_help', userConfirmedLowChance: true })
    assert.equal(result.status, 'refused')
    assert.equal(result.canOpenCase, false)
    assert.equal(result.tier, null)
    assert.equal(result.reason, 'NOT_ELIGIBLE')
    assert.equal(result.lowChanceAck.required, false)
  })

  it('T16 opens a low-chance Full case only after an explicit yes', () => {
    const result = recommendTier({ ...base, verdict: 'low', userConfirmedLowChance: true })
    const places = result.lowChanceAck.warnings.map((item) => item.place).sort().join(',')
    const texts = result.lowChanceAck.warnings.map((item) => item.text)
    const noPromises = texts.every((text) => !/unfreez|we will get|legal advice/i.test(text.replaceAll('not legal advice', '')))
    assert.equal(result.status, 'ok')
    assert.equal(result.canOpenCase, true)
    assert.equal(result.tier, 'full')
    assert.equal(result.reason, 'LOW_POLICY_FULL')
    assert.equal(result.lowChanceAck.required, true)
    assert.equal(result.lowChanceAck.confirmed, true)
    assert.equal(places, 'case_cover_note,chance_result,checkout,checkout_checkbox')
    assert.ok(texts.filter((text) => text.includes(NO_FABRICATION)).length >= 3)
    assert.ok(texts.some((text) => text.includes('falsify')))
    assert.equal(noPromises, true)
  })

  it('T17 lets the normal rules decide a low chance when configured that way', () => {
    const result = recommendTier(
      { ...base, verdict: 'low', userConfirmedLowChance: true },
      { ...DEFAULT_CONFIG, lowVerdictTier: 'rules' },
    )
    assert.equal(result.status, 'ok')
    assert.equal(result.tier, 'light')
    assert.equal(result.reason, 'LIGHT_DEFAULT')
    assert.equal(result.lowChanceAck.required, true)
  })

  it('T18 refuses a low chance when that path is off', () => {
    const result = recommendTier(
      { ...base, verdict: 'low', userConfirmedLowChance: true },
      { ...DEFAULT_CONFIG, allowLowVerdict: false },
    )
    assert.equal(result.status, 'refused')
    assert.equal(result.tier, null)
  })

  it('T19 prices a Light to Full upgrade at the $30 difference', () => {
    const quote = upgradeQuote('light')
    assert.equal(quote.allowed, true)
    assert.equal(quote.to, 'full')
    assert.equal(quote.payUsd, 30)
    assert.equal(quote.costCapUsd, 63.2)
    assert.ok(quote.reuse.length > 0)
  })

  it('T20 does not price an upgrade from Full', () => {
    const quote = upgradeQuote('full')
    assert.equal(quote.allowed, false)
    assert.equal(quote.payUsd, 0)
  })

  it('T21 blocks Light when the Light budget rule fires', () => {
    const result = recommendTier(
      { ...base, addressesCount: 200 },
      { ...DEFAULT_CONFIG, maxLightAddresses: 1000 },
    )
    const choice = chooseTier(result, 'light')
    assert.equal(result.tier, 'full')
    assert.equal(result.reason, 'LIGHT_OVER_BUDGET')
    assert.equal(result.lightAllowed, false)
    assert.equal(result.lightBlockedNote, LIGHT_BLOCKED_NOTE)
    assert.equal(choice.ok, false)
    assert.equal(choice.error, 'LIGHT_NOT_ALLOWED')
    assert.equal(choice.tier, 'full')
    assert.equal(choice.note, LIGHT_BLOCKED_NOTE)
    assert.equal(chooseTier(result, 'full').ok, true)
  })

  it('T22 still blocks Light when a cheaper rule matches first', () => {
    const result = recommendTier({ ...base, addressesCount: 200 })
    assert.equal(result.reason, 'MANY_ADDRESSES')
    assert.ok(result.matched.includes('LIGHT_OVER_BUDGET'))
    assert.equal(result.lightAllowed, false)
    assert.equal(chooseTier(result, 'light').error, 'LIGHT_NOT_ALLOWED')
  })

  it('T23 lets a normal Full recommendation move to Light after confirmation', () => {
    const ids = ['T03', 'T04', 'T05', 'T07', 'T08', 'T09', 'T10', 'T11', 'T12']
    const samples: Array<[string, Partial<TierInput>]> = [
      ['T03', { priorExchangeRejection: true, fundsSources: ['p2p'] }],
      ['T04', { ownershipProofRequested: true }],
      ['T05', { exchange: 'okx', evidence: ['txid_only'] }],
      ['T07', { fundsSources: ['other_exchange', 'p2p'] }],
      ['T08', { fundsSources: [] }],
      ['T09', { disputedDepositsCount: 3 }],
      ['T10', { requestedDocs: ['bank_statement', 'proof_of_address', 'exchange_statement'] }],
      ['T11', { addressesCount: 31 }],
      ['T12', { addressesCount: 120 }],
    ]
    assert.deepEqual(samples.map(([id]) => id), ids)
    for (const [, patch] of samples) {
      const result = recommendTier({ ...base, ...patch })
      const choice = chooseTier(result, 'light')
      assert.equal(result.tier, 'full')
      assert.equal(result.lightAllowed, true)
      assert.equal(result.lightBlockedNote, null)
      assert.equal(choice.ok, true)
      assert.equal(choice.tier, 'light')
      assert.equal(choice.needsConfirmation, true)
      assert.equal(choice.override, 'full_to_light')
    }
  })

  it('T24 allows a free move from Light to Full and refuses a case we cannot take', () => {
    const result = recommendTier(base)
    const up = chooseTier(result, 'full')
    const no = chooseTier(recommendTier({ ...base, verdict: 'cannot_help' }), 'light')
    assert.equal(result.lightAllowed, true)
    assert.equal(up.ok, true)
    assert.equal(up.override, 'light_to_full')
    assert.equal(up.needsConfirmation, false)
    assert.equal(no.ok, false)
    assert.equal(no.error, 'NO_CASE')
  })
})
