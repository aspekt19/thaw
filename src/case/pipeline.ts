import { explainTrigger, draftAppeal, templateAppeal, type AppealDraft } from '../chance/case-serv.ts'
import type { ServComplete } from '@thaw/guard'
import { AML_ENDPOINTS, LAST_KNOWN_QUOTE_MICRO, assessKitePayment, chargeAllowed, type KiteDeny } from '../kite/guard.ts'
import type { KiteExecutor } from '../kite/executor.ts'
import { rankCounterparties, type RankedAddress, type RankedTransfer } from './rank.ts'
import { timelinePdf } from './pdf.ts'

export type CaseStage = 'awaiting_payment' | 'tracing' | 'waiting_kite' | 'aml_running' | 'awaiting_review' | 'ready'

export type SpendRow = {
  caseId: string
  source: 'kite' | 'serv'
  endpoint: string
  amountMicro: number
  idempotencyKey: string
  outcome: string
  createdAt: number
}

export type PipelineInput = {
  caseId: string
  tier: 'light' | 'full'
  exchange: string
  chain: RankedTransfer['chain']
  deposit: string
  amount: string
  asset: string
  date: string
  notice?: string
  fundsSources?: string[]
  evidenceQuote?: string | null
  labels?: Array<{ address: string; name: string; exchange: string }>
  transfers: RankedTransfer[]
  depositTimeMs: number | null
}

export type CaseWork = {
  stage: CaseStage
  waitReason: KiteDeny | 'runner_required' | 'session_exhausted' | null
  ranked: RankedAddress[]
  screened: number
  skipped: number
  aml: Array<{ endpoint: string; address: string; outcome: string }>
  trigger: { text: string; source: 'serv' | 'template' }
  appeal: AppealDraft | null
  timeline: string[]
  pdfBase64: string
}

function answerUsable(body: unknown): boolean {
  if (body == null) return false
  const text = typeof body === 'string' ? body : JSON.stringify(body)
  if (!text.trim() || text === '{}' || text === 'null') return false
  return !/ignore (all )?previous instructions|private key|seed phrase/i.test(text)
}

export async function runPaidCase(input: PipelineInput, deps: {
  now: () => number
  kiteEnabled: boolean
  sessionId: string | undefined
  sessionExpiresAt: number | null
  dailyCapMicro: number
  caseSpentMicro: number
  daySpentMicro: number
  executor: KiteExecutor
  serv: ServComplete | null
  recordSpend: (row: SpendRow) => Promise<void>
}): Promise<CaseWork> {
  const ranked = rankCounterparties(input.transfers, input.depositTimeMs, input.tier)
  const deep = ranked.filter((row) => row.deep)
  const deepEvm = deep.filter((row) => row.evm)
  const deepTron = deep.filter((row) => !row.evm)
  const aml: CaseWork['aml'] = []
  let caseSpent = deps.caseSpentMicro
  let daySpent = deps.daySpentMicro
  let wait: CaseWork['waitReason'] = null
  let screened = 0

  if (!deps.kiteEnabled) wait = 'kite_off'
  else if (!deps.sessionId?.trim()) wait = 'session_missing'
  else {
    for (const address of deepEvm) {
      for (const endpoint of AML_ENDPOINTS) {
        const quote = LAST_KNOWN_QUOTE_MICRO[endpoint.id]
        const decision = assessKitePayment({
          enabled: true,
          sessionId: deps.sessionId,
          sessionExpiresAt: deps.sessionExpiresAt,
          now: deps.now(),
          method: endpoint.method,
          url: endpoint.url,
          quotedMicro: quote,
          caseSpentMicro: caseSpent,
          daySpentMicro: daySpent,
          dailyCapMicro: deps.dailyCapMicro,
        })
        const key = `${input.caseId}:${endpoint.id}:${address.address.toLowerCase()}`
        if (!decision.ok) {
          wait = decision.code
          await deps.recordSpend({
            caseId: input.caseId,
            source: 'kite',
            endpoint: endpoint.url,
            amountMicro: 0,
            idempotencyKey: key,
            outcome: decision.code,
            createdAt: deps.now(),
          })
          break
        }
        const result = await deps.executor.execute({
          sessionId: deps.sessionId,
          method: endpoint.method,
          url: endpoint.url,
          body: JSON.stringify({ address: address.address, chain: address.chain }),
          idempotencyKey: key,
        })
        if (!result.ok) {
          wait = result.code === 'session_exhausted' ? 'session_exhausted' : result.code === 'session_expired' ? 'session_expired' : 'runner_required'
          await deps.recordSpend({
            caseId: input.caseId,
            source: 'kite',
            endpoint: endpoint.url,
            amountMicro: 0,
            idempotencyKey: key,
            outcome: result.code,
            createdAt: deps.now(),
          })
          break
        }
        caseSpent += result.amountMicro
        daySpent += result.amountMicro
        const usable = answerUsable(result.body) && chargeAllowed(quote, result.amountMicro)
        const outcome = !chargeAllowed(quote, result.amountMicro) ? 'over_catalog' : usable ? 'paid' : 'withheld'
        if (usable) {
          screened += 1
          aml.push({ endpoint: endpoint.id, address: address.address, outcome: 'paid' })
        }
        await deps.recordSpend({
          caseId: input.caseId,
          source: 'kite',
          endpoint: endpoint.url,
          amountMicro: result.amountMicro,
          idempotencyKey: key,
          outcome,
          createdAt: deps.now(),
        })
      }
      if (wait) break
    }
  }

  const skipped = deepEvm.length * AML_ENDPOINTS.length - screened
  for (const row of deepTron) aml.push({ endpoint: 'tron', address: row.address, outcome: 'not_screened' })
  const facts = {
    ids: ['trace', 'deposit', ...aml.map((_, index) => `aml-${index + 1}`)],
    exchange: input.exchange,
    notice: input.notice ?? '',
    fundsSources: input.fundsSources ?? [],
    evidenceQuote: input.evidenceQuote ?? null,
    labels: input.labels ?? [],
    deposit: input.deposit,
    amount: input.amount,
    asset: input.asset,
    date: input.date,
    chain: input.chain,
    ranked: ranked.map((row) => ({ address: row.address, deep: row.deep, chain: row.chain })),
    aml,
    screened,
    tronNotScreened: deepTron.length,
    skipped: Math.max(0, skipped),
  }
  const timeline = [
    `Case ${input.caseId}`,
    `Deposit ${input.deposit} on ${input.date}`,
    `Ranked ${ranked.length} counterparties. Deep checks: ${deep.length}. EVM to screen: ${deepEvm.length}. TRON not screened, no TRON AML seller yet: ${deepTron.length}.`,
    wait ? `AML is waiting: ${wait}. Checked ${screened}.` : `AML checks paid: ${screened}.`,
    'This is document preparation. We do not promise a release.',
  ]
  const trigger = deps.serv ? await explainTrigger(facts, deps.serv) : { text: 'The deposit trace is attached. SERV is not configured, so this note stays with the trace. We do not promise a release.', source: 'template' as const }
  const appeal = deps.serv ? await draftAppeal(facts, input.exchange, input.tier, deps.serv) : templateAppeal(input.exchange, input.tier)
  const pdf = timelinePdf([
    ...timeline,
    'Trigger',
    trigger.text,
    'Appeal draft',
    appeal?.subject ?? '',
    appeal?.body ?? '',
  ])
  let binary = ''
  for (const byte of pdf) binary += String.fromCharCode(byte)
  return {
    stage: wait ? 'waiting_kite' : 'awaiting_review',
    waitReason: wait,
    ranked,
    screened,
    skipped: Math.max(0, skipped),
    aml,
    trigger,
    appeal,
    timeline,
    pdfBase64: btoa(binary),
  }
}
