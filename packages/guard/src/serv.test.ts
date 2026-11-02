import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildServTools, resolveEffort, servChat, servStructured, type ServComplete } from './serv.ts'

describe('serv client', () => {
  it('maps minimal effort to low and unknown effort to low', () => {
    assert.equal(resolveEffort('minimal'), 'low')
    assert.equal(resolveEffort('nope'), 'low')
    assert.equal(resolveEffort('high'), 'high')
  })

  it('asks for the prompt guard tool and returns the text', async () => {
    let body: Record<string, unknown> | undefined
    const complete: ServComplete = async (sent) => {
      body = sent
      return {
        model: 'gpt-5.4-mini',
        output_text: 'ok',
      }
    }
    const result = await servChat(
      {
        system: 'sys',
        user: 'user',
        servTools: { promptGuard: true },
        promptVersion: 'thaw.test',
      },
      complete,
    )
    assert.equal(result.text, 'ok')
    assert.equal(result.meta.promptVersion, 'thaw.test')
    const tools = body?.tools as Array<{ name: string }>
    assert.equal(tools[0]?.name, 'serv_prompt_guard')
    assert.equal((body?.reasoning as { effort?: string } | undefined)?.effort, 'low')
    assert.equal(body?.instructions, 'sys')
    assert.equal(body?.input, 'user')
  })

  it('parses a structured response and rejects a refusal', async () => {
    const complete: ServComplete = async () => ({
      output_text: '{"category":"unknown"}',
    })
    const good = await servStructured(
      {
        system: 'sys',
        user: 'user',
        schemaName: 'notice',
        jsonSchema: { type: 'object' },
        parse: (value) => {
          const row = value as { category?: string }
          if (row.category !== 'unknown') throw new Error('bad')
          return row.category
        },
      },
      complete,
    )
    assert.equal(good.data, 'unknown')

    const refused: ServComplete = async () => ({
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'no' }] }],
    })
    await assert.rejects(() =>
      servStructured(
        {
          system: 'sys',
          user: 'user',
          schemaName: 'notice',
          jsonSchema: { type: 'object' },
          parse: () => 'x',
        },
        refused,
      ),
    )
  })

  it('builds a shadow-agent tool only when asked', () => {
    assert.deepEqual(buildServTools({}), [])
    const tools = buildServTools({ shadowAgent: { hint: 'stay', maxIterations: 2 } })
    assert.equal(tools[0]?.name, 'serv_shadow_agent')
  })
})
