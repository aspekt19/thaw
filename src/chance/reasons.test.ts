import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decide, REASON } from './rules.ts'
import { recommendTier } from './tier.ts'

const facts = {
  ban: 'disabled' as const,
  lookupOk: true,
  amountMatch: 'match' as const,
  dateMatch: 'match' as const,
  origin: 'exchange_purchase' as const,
  hasDocuments: null,
  priorRefusal: false,
}

describe('chance reasons', () => {
  it('does not say the account is closed when only the model picked a stop category', () => {
    const decision = decide({
      ...facts,
      categories: ['technical'],
      servOnly: ['technical'],
      servQuote: 'technical limitation and will not return it',
      firstHopOk: true,
    })
    assert.equal(decision.verdict, 'cannot_help')
    assert.equal(decision.reasons.some((reason) => reason === REASON.closure), false)
    assert.match(decision.reasons.join(' '), /technical limitation/)
  })

  it('mentions the one-page hop limit only after the hop was read', () => {
    const unread = decide({ ...facts, categories: ['source_of_funds'], servOnly: [], firstHopOk: false })
    assert.equal(unread.reasons.includes(REASON.pageLimit), false)
    assert.ok(unread.reasons.includes(REASON.hopFail))
    const read = decide({ ...facts, categories: ['source_of_funds'], servOnly: [], firstHopOk: true })
    assert.ok(read.reasons.includes(REASON.pageLimit))
  })

  it('does not call the sources clear when the first hop was not read', () => {
    const result = recommendTier({
      exchange: 'bybit',
      verdict: 'medium',
      disputedDepositsCount: 1,
      addressesCount: 1,
      fundsSources: ['other_exchange'],
      priorExchangeRejection: false,
      requestedDocs: [],
      ownershipProofRequested: false,
      evidence: ['txid_only'],
      firstHopOk: false,
    })
    assert.equal(result.reason, 'HOP_UNREAD')
    assert.equal(result.tier, 'full')
  })
})
