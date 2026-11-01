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

  const travelCases: Array<[string, Partial<TierInput>]> = [
    ['T25a', {}],
    ['T25b', { ownershipProofRequested: true, disputedDepositsCount: 3, fundsSources: ['p2p'] }],
  ]
  for (const [id, patch] of travelCases) {
    it(`${id} recommends Light for a confirmed Travel Rule hold`, () => {
      const result = recommendTier({ ...base, ...patch, holdType: 'travel_rule', travelRuleConfirmed: true })
      assert.equal(result.status, 'ok')
      assert.equal(result.canOpenCase, true)
      assert.equal(result.tier, 'light')
      assert.equal(result.reason, 'TRAVEL_RULE_LIGHT')
      assert.equal(result.lightAllowed, true)
      assert.equal(result.flags.includes('TRAVEL_RULE_VERIFY_FIRST'), false)
    })
  }

  it('T26 keeps the ordinary result and asks us to verify an unconfirmed Travel Rule hold', () => {
    const patches: Array<Partial<TierInput>> = [{}, { ownershipProofRequested: true }, { addressesCount: 120 }, { verdict: 'low' }]
    for (const patch of patches) {
      const plain = recommendTier({ ...base, ...patch })
      for (const travelRuleConfirmed of [undefined, false]) {
        const marked = recommendTier({ ...base, ...patch, holdType: 'travel_rule', travelRuleConfirmed })
        const { flags: markedFlags, ...markedRest } = marked
        const { flags: plainFlags, ...plainRest } = plain
        assert.deepEqual(markedRest, plainRest)
        assert.ok(markedFlags.includes('TRAVEL_RULE_VERIFY_FIRST'))
        assert.deepEqual(markedFlags.filter((flag) => flag !== 'TRAVEL_RULE_VERIFY_FIRST'), plainFlags)
      }
    }
  })

  it('T27 does not let a Travel Rule hold override a refusal', () => {
    const stopped = recommendTier({ ...base, verdict: 'cannot_help', holdType: 'travel_rule', travelRuleConfirmed: true })
    const htx = recommendTier({ ...base, exchange: 'htx', clientCountry: 'GB', holdType: 'travel_rule', travelRuleConfirmed: true })
    assert.equal(stopped.status, 'refused')
    assert.equal(stopped.tier, null)
    assert.equal(stopped.reason, 'NOT_ELIGIBLE')
    assert.equal(htx.status, 'refused')
    assert.equal(htx.tier, null)
    assert.equal(htx.reason, 'HTX_UK_EU_CLIENT')
  })

  it('T28 lets the Light budget rule win over a confirmed Travel Rule hold', () => {
    const result = recommendTier({ ...base, addressesCount: 200, holdType: 'travel_rule', travelRuleConfirmed: true })
    assert.equal(result.tier, 'full')
    assert.equal(result.lightAllowed, false)
    assert.equal(result.matched.includes('TRAVEL_RULE_LIGHT'), false)
  })

  it('T29 leaves an AML hold on the ordinary rules', () => {
    const result = recommendTier({ ...base, holdType: 'aml', travelRuleConfirmed: true })
    assert.equal(result.tier, 'light')
    assert.equal(result.reason, 'LIGHT_DEFAULT')
    assert.equal(result.flags.includes('TRAVEL_RULE_VERIFY_FIRST'), false)
  })

  const htxCases: Array<[string, Partial<TierInput>]> = [
    ['T30a', { exchange: 'htx', clientCountry: 'GB' }],
    ['T30b', { exchange: 'htx', clientCountry: 'DE' }],
    ['T30c', { exchange: 'htx', clientCountry: 'uk' }],
    ['T30d', { exchange: 'htx', clientCountry: 'EL' }],
    ['T30e', { exchange: 'htx', clientCountry: 'TR', clientNationalities: ['FR'] }],
    ['T30f', { exchange: 'kraken', htxLinked: true, clientCountry: 'IT' }],
  ]
  for (const [id, patch] of htxCases) {
    it(`${id} refuses an HTX-related case for a UK or EU client`, () => {
      const result = recommendTier({ ...base, ...patch })
      assert.equal(result.status, 'refused')
      assert.equal(result.canOpenCase, false)
      assert.equal(result.tier, null)
      assert.equal(result.reason, 'HTX_UK_EU_CLIENT')
    })
  }

  for (const [id, country] of [['T31a', 'TR'], ['T31b', 'US'], ['T31c', 'NO']] as const) {
    it(`${id} keeps the ordinary rules for an HTX client outside the UK and EU`, () => {
      const result = recommendTier({ ...base, exchange: 'htx', clientCountry: country })
      assert.equal(result.status, 'ok')
      assert.equal(result.canOpenCase, true)
      assert.equal(result.tier, 'light')
      assert.equal(result.reason, 'LIGHT_DEFAULT')
      assert.equal(result.flags.includes('HTX_COUNTRY_REQUIRED'), false)
    })
  }

  it('T32 asks for a country before an HTX-related case can open', () => {
    const missing = recommendTier({ ...base, exchange: 'htx' })
    const unrelated = recommendTier({ ...base, exchange: 'kraken', clientCountry: 'DE' })
    assert.equal(missing.status, 'blocked_need_country')
    assert.equal(missing.canOpenCase, false)
    assert.equal(missing.tier, 'light')
    assert.ok(missing.flags.includes('HTX_COUNTRY_REQUIRED'))
    assert.equal(unrelated.status, 'ok')
    assert.equal(unrelated.canOpenCase, true)
  })
})
