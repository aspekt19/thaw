import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ServComplete } from '@thaw/guard'
import { appealProblem, draftAppeal, explainTrigger, grounded, templateAppeal } from './case-serv.ts'

describe('case SERV checks', () => {
  it('drops a trigger note that invents an address or promises a release', async () => {
    const facts = { deposit: 'aa'.repeat(32), amount: '10.5', asset: 'USDT', date: '2026-11-01' }
    const invented: ServComplete = async () => ({ output_text: 'The sender 0x1111111111111111111111111111111111111111 sent 10.5 USDT.' })
    const dropped = await explainTrigger(facts, invented)
    assert.equal(dropped.source, 'template')
    const promise: ServComplete = async () => ({ output_text: 'We promise the funds will be released. Amount 10.5.' })
    assert.equal((await explainTrigger(facts, promise)).source, 'template')
    const ok: ServComplete = async () => ({ output_text: 'The deposit of 10.5 USDT on 2026-11-01 is the one in the notice. This is document preparation, not a promise of release.' })
    assert.equal((await explainTrigger(facts, ok)).source, 'serv')
    assert.equal(grounded('amount 10.5', JSON.stringify(facts)), true)
  })

  it('rejects an appeal that promises a release or cites a missing fact, then uses the template', async () => {
    const facts = { ids: ['trace'], deposit: 'aa'.repeat(32) }
    let calls = 0
    const bad: ServComplete = async () => {
      calls += 1
      return {
        output_text: JSON.stringify({
          subject: 'Appeal',
          body: 'We guarantee the withdrawal will be released.',
          attachments_list: ['trace'],
          claims: [{ text: 'We guarantee a release.', factId: 'trace' }],
        }),
      }
    }
    const draft = await draftAppeal(facts, 'binance', 'light', bad)
    assert.equal(calls, 2)
    assert.equal(draft.source, 'template')
    assert.equal(appealProblem(templateAppeal('binance', 'light'), ['trace']), null)
    const missing: ServComplete = async () => ({
      output_text: JSON.stringify({
        subject: 'Appeal',
        body: 'See the trace.',
        attachments_list: ['trace'],
        claims: [{ text: 'See the trace.', factId: 'missing' }],
      }),
    })
    assert.equal((await draftAppeal(facts, 'binance', 'light', missing)).source, 'template')
  })
})
