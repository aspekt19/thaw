import { fence, servChat, servModel, servStructured, UNTRUSTED_RULE, type ServComplete, type ServMeta } from '@thaw/guard'

export const TRIGGER_VERSION = 'thaw.trigger.v1'
export const APPEAL_VERSION = 'thaw.appeal.v1'

export const TRIGGER_TEMPLATE =
  'The deposit trace is attached. A model explanation was not used, because it was missing or it mentioned a figure that is not in the trace. This is document preparation, not legal advice. We do not promise that the withdrawal will be released. Only the exchange decides.'

export type AppealClaim = { text: string; factId: string }

export type AppealDraft = {
  subject: string
  body: string
  attachments: string[]
  claims: AppealClaim[]
  source: 'serv' | 'template'
  promptVersion: string
  meta?: ServMeta
}

const APPEAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    subject: { type: 'string' },
    body: { type: 'string' },
    attachments_list: { type: 'array', items: { type: 'string' } },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
          factId: { type: 'string' },
        },
        required: ['text', 'factId'],
      },
    },
  },
  required: ['subject', 'body', 'attachments_list', 'claims'],
}

const STOP =
  /гарантир|гарантия|100\s*%|обязательно размороз|верн[её]м|guarantee|will be released|will unfreeze|we promise|promise to unfreeze/i

const ADDRESS = /0x[a-fA-F0-9]{40}|T[1-9A-HJ-NP-Za-km-z]{33}/g
const HASH = /\b(?:0x)?[a-fA-F0-9]{64}\b/g
const AMOUNT = /\d+\.\d+|\d{2,}/g

export function grounded(text: string, facts: string): boolean {
  for (const match of text.matchAll(ADDRESS)) {
    const piece = match[0]
    if (piece.startsWith('0x') || piece.startsWith('0X')) {
      if (!facts.toLowerCase().includes(piece.toLowerCase())) return false
    } else if (!facts.includes(piece)) return false
  }
  const hay = facts.toLowerCase()
  const pieces = [...text.matchAll(HASH), ...text.matchAll(AMOUNT)].map((match) => match[0])
  return pieces.every((piece) => hay.includes(piece.toLowerCase()))
}

const FACT_TAG = /\[(?:deposit|trace|aml-\d+)\]|\((?:deposit|trace)\)/gi
const TIER_WORD = /\b(?:light|full)(?:[-\s]?tier)?\b|\btier\b/gi
const FACT_TAG_TEST = /\[(?:deposit|trace|aml-\d+)\]|\((?:deposit|trace)\)/i
const TIER_TEST = /\b(?:light|full)[-\s]?tier\b/i

export function cleanClientText(text: string): string {
  return text.replace(FACT_TAG, '').replace(TIER_WORD, '').replace(/[ \t]{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim()
}

export function appealProblem(draft: AppealDraft, factIds: readonly string[]): string | null {
  const blob = `${draft.subject}\n${draft.body}\n${draft.claims.map((claim) => claim.text).join('\n')}`
  if (STOP.test(blob)) return 'promise'
  if (FACT_TAG_TEST.test(blob) || TIER_TEST.test(blob)) return 'internal'
  if (draft.claims.some((claim) => !factIds.includes(claim.factId))) return 'fact'
  return null
}

function displayExchange(exchange: string): string {
  const known: Record<string, string> = { htx: 'HTX', okx: 'OKX', crypto_com: 'Crypto.com' }
  if (known[exchange]) return known[exchange]
  return exchange.slice(0, 1).toUpperCase() + exchange.slice(1)
}

export function templateAppeal(exchange: string, _tier: string): AppealDraft {
  return {
    subject: `Source-of-funds note for ${displayExchange(exchange)}`,
    body: 'Please find the records we can attach for this file. This note is document preparation, not legal advice. It does not ask the exchange to promise a release, and it does not predict one. Only the exchange decides.',
    attachments: ['Deposit trace', 'Timeline'],
    claims: [{ text: 'A deposit trace was prepared for this case.', factId: 'trace' }],
    source: 'template',
    promptVersion: APPEAL_VERSION,
  }
}

export async function explainTrigger(facts: unknown, complete: ServComplete): Promise<{ text: string; source: 'serv' | 'template'; meta?: ServMeta }> {
  const packed = JSON.stringify(facts)
  try {
    const result = await servChat(
      {
        system: `Explain in plain English, in 3 to 5 sentences, why this deposit may have drawn a review. ${UNTRUSTED_RULE} Use only the facts in the input. Every address, amount, date, and provider name must appear in those facts. Do not promise a release. This is document preparation, not legal advice. ${TRIGGER_VERSION}`,
        user: fence(packed, 12000),
        model: servModel('SERV_GRAPH_ID_TRIGGER'),
        promptVersion: TRIGGER_VERSION,
        servTools: {
          promptGuard: true,
          shadowAgent: { hint: 'Every address, amount, date and provider name must appear in the input facts. No promises of release.', maxIterations: 2 },
        },
      },
      complete,
    )
    if (!grounded(result.text, packed) || STOP.test(result.text)) return { text: TRIGGER_TEMPLATE, source: 'template', meta: result.meta }
    return { text: result.text, source: 'serv', meta: result.meta }
  } catch {
    return { text: TRIGGER_TEMPLATE, source: 'template' }
  }
}

export async function draftAppeal(
  facts: { ids: string[] } & Record<string, unknown>,
  exchange: string,
  tier: string,
  complete: ServComplete,
): Promise<AppealDraft> {
  const fallback = templateAppeal(exchange, tier)
  const ask = async () =>
    servStructured(
      {
        system: `Draft a short appeal letter in English. ${UNTRUSTED_RULE} Do not promise or predict a release, do not threaten, and do not invent facts or documents. Do not mention package names, tiers, or fact ids in the subject or body. Copy every TRON address exactly, including capital letters. Every claim must cite a provided fact id. ${APPEAL_VERSION}`,
        user: fence(JSON.stringify({ exchange: displayExchange(exchange), facts }), 12000),
        timeoutMs: 40_000,
        schemaName: 'appeal_draft',
        jsonSchema: APPEAL_SCHEMA,
        model: servModel('SERV_GRAPH_ID_APPEAL'),
        promptVersion: APPEAL_VERSION,
        servTools: {
          promptGuard: true,
          shadowAgent: {
            hint: 'The letter must not promise or predict release, must not threaten, must not invent facts or documents; every claim must cite a provided fact id.',
            maxIterations: 2,
          },
        },
        parse: (value) => {
          const row = value as { subject?: string; body?: string; attachments_list?: string[]; claims?: AppealClaim[] }
          if (!row.subject || !row.body || !Array.isArray(row.attachments_list) || !Array.isArray(row.claims)) throw new Error('shape')
          return {
            subject: row.subject,
            body: row.body,
            attachments: row.attachments_list,
            claims: row.claims,
            source: 'serv' as const,
            promptVersion: APPEAL_VERSION,
          }
        },
      },
      complete,
    )
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await ask()
      const draft = {
        ...result.data,
        subject: cleanClientText(result.data.subject),
        body: cleanClientText(result.data.body),
        claims: result.data.claims.map((claim) => ({ ...claim, text: cleanClientText(claim.text) })),
        meta: result.meta,
      }
      const packed = JSON.stringify(facts)
      if (!appealProblem(draft, facts.ids) && grounded(`${draft.subject}\n${draft.body}`, packed)) return draft
    } catch {
      continue
    }
  }
  return fallback
}
