import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { categoriesInNotice } from './lexicon.ts'

describe('notice lexicon', () => {
  it('reads the phrases named in the plan', () => {
    assert.ok(categoriesInNotice('request from law enforcement').includes('law_enforcement'))
    assert.ok(categoriesInNotice('по запросу правоохранительных органов').includes('law_enforcement'))
    assert.ok(categoriesInNotice('OFAC list').includes('sanctions'))
    assert.ok(categoriesInNotice('адрес sanctioned').includes('sanctions'))
    assert.ok(categoriesInNotice('это санкции').includes('sanctions'))
    assert.ok(categoriesInNotice('reported as stolen').includes('theft'))
    assert.ok(categoriesInNotice('fraud victim report').includes('theft'))
    assert.ok(categoriesInNotice('permanently closed').includes('final_closure'))
    assert.ok(categoriesInNotice('please provide source of funds').includes('source_of_funds'))
    assert.ok(categoriesInNotice('Travel Rule hold').includes('travel_rule'))
    assert.ok(categoriesInNotice('T+N risk control').includes('t_plus_n'))
    assert.ok(categoriesInNotice('T+N risk control').includes('risk_control'))
  })

  it('does not treat a lookalike word as a sanctions hit', () => {
    assert.deepEqual(categoriesInNotice('the wallet is unsanctioned'), [])
  })
})
