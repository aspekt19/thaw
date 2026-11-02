import { clientIp, createFetchComplete } from '@thaw/guard'
import { liveBanList } from './chance/banlist.ts'
import { createServHooks, recommendationWithCountry, runChanceCheck, type ChanceDeps, type PublicResult } from './chance/check.ts'
import { PAID_PATH_PRICE_USD } from './chance/constants.ts'
import { defaultLimitConfig } from './chance/limits.ts'
import { parseChanceInput, type ChanceInput } from './chance/parse.ts'
import { captchaRequired, verifyCaptchaToken } from './captcha.ts'
import { createRpc, rpcUrls, type RpcChain } from './chain/evm-rpc.ts'
import { mcpFetch } from './mcp/server.ts'
import { runPaidCase } from './case/pipeline.ts'
import { createHttpKiteExecutor, createRunnerExecutor } from './kite/executor.ts'
import { DEFAULT_DAILY_CAP_MICRO } from './kite/guard.ts'
import { lookupFirstHop } from './chance/lookup.ts'
import { consumeCasePayment, consumePayment, d1LimitStore, getCase, getCaseForOrder, getOrder, insertCaseInvoice, insertOrder, insertSpend, saveCaseWork, setCaseToken, spentMicro, updatePaidResult, type CaseRow } from './db/d1-store.ts'
import type { SqlDb } from './db/sql.ts'
import { LOW_CHANCE_WARNINGS, NEED_COUNTRY_NOTE, choiceResult, chooseTier } from './chance/tier.ts'
import { checkPriceMicro, isPaymentChain, parseUsdToMicro, paymentRpc, USDC_CONTRACT, verifyUsdcTransfer, type PaymentChain } from './pay/usdc.ts'

export interface Env {
  DB: SqlDb
  ASSETS: { fetch(request: Request): Promise<Response> }
  ALCHEMY_API_KEY?: string
  THAW_USDC_ADDRESS?: string
  THAW_CHECK_PRICE_USD?: string
  THAW_PAYMENT_CHAIN?: string
  THAW_PAYMENT_CONFIRMATIONS?: string
  THAW_CASE_LIGHT_USD?: string
  THAW_CASE_FULL_USD?: string
  THAW_PAID_PATH_ENABLED?: string
  SERV_API_KEY?: string
  ETHERSCAN_API_KEY?: string
  TRONGRID_API_KEY?: string
  THAW_RECEIPT_SECRET?: string
  THAW_BANLIST_ENABLED?: string
  THAW_TURNSTILE_SECRET?: string
  THAW_DAILY_CHECK_LIMIT?: string
  THAW_DAILY_SPEND_CAP_USD?: string
  THAW_RPC_URL_ETHEREUM?: string
  THAW_RPC_URL_BASE?: string
  THAW_RPC_URL_ARBITRUM?: string
  THAW_KITE_ENABLED?: string
  THAW_KITE_DAILY_CAP_USD?: string
  KITE_SESSION_ID?: string
  KITE_SESSION_EXPIRES_AT?: string
  KITE_HTTP_EXECUTE_URL?: string
  THAW_REVIEW_TOKEN?: string
}

const ENV_KEYS = [
  'ALCHEMY_API_KEY',
  'THAW_USDC_ADDRESS',
  'THAW_CHECK_PRICE_USD',
  'THAW_PAYMENT_CHAIN',
  'THAW_PAYMENT_CONFIRMATIONS',
  'THAW_CASE_LIGHT_USD',
  'THAW_CASE_FULL_USD',
  'THAW_PAID_PATH_ENABLED',
  'SERV_API_KEY',
  'ETHERSCAN_API_KEY',
  'TRONGRID_API_KEY',
  'THAW_RECEIPT_SECRET',
  'THAW_BANLIST_ENABLED',
  'THAW_TURNSTILE_SECRET',
  'THAW_DAILY_CHECK_LIMIT',
  'THAW_DAILY_SPEND_CAP_USD',
  'THAW_RPC_URL_ETHEREUM',
  'THAW_RPC_URL_BASE',
  'THAW_RPC_URL_ARBITRUM',
  'THAW_KITE_ENABLED',
  'THAW_KITE_DAILY_CAP_USD',
  'KITE_SESSION_ID',
  'KITE_SESSION_EXPIRES_AT',
  'KITE_HTTP_EXECUTE_URL',
  'THAW_REVIEW_TOKEN',
] as const

function applyEnv(env: Env): void {
  for (const key of ENV_KEYS) {
    const value = env[key]
    if (typeof value === 'string') process.env[key] = value
    else delete process.env[key]
  }
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status })
}

function headerRecord(request: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return headers
}

function paymentChainOf(env: Env): PaymentChain {
  const raw = env.THAW_PAYMENT_CHAIN?.trim() || 'base'
  return isPaymentChain(raw) ? raw : 'base'
}

function confirmationsOf(env: Env): number {
  const raw = Number(env.THAW_PAYMENT_CONFIRMATIONS ?? '1')
  if (!Number.isInteger(raw) || raw < 1) return 1
  return raw
}

function depsFor(env: Env, depositChain: RpcChain | null): ChanceDeps {
  const override = depositChain === 'ethereum' ? env.THAW_RPC_URL_ETHEREUM : depositChain === 'arbitrum' ? env.THAW_RPC_URL_ARBITRUM : depositChain === 'base' ? env.THAW_RPC_URL_BASE : undefined
  const urls = depositChain ? rpcUrls(depositChain, { alchemyKey: env.ALCHEMY_API_KEY, overrideUrl: override }) : []
  return {
    now: () => Date.now(),
    fetch,
    serv: env.SERV_API_KEY ? createServHooks(createFetchComplete()) : null,
    banlist: liveBanList(),
    store: d1LimitStore(env.DB),
    limits: defaultLimitConfig(),
    captchaRequired: captchaRequired(),
    verifyCaptcha: (token) => verifyCaptchaToken(token),
    paidPathEnabled: env.THAW_PAID_PATH_ENABLED === '1',
    paidPathPriceUsd: PAID_PATH_PRICE_USD,
    id: () => crypto.randomUUID(),
    burst: () => ({ ok: true }),
    etherscanApiKey: env.ETHERSCAN_API_KEY,
    trongridApiKey: env.TRONGRID_API_KEY,
    receiptSecret: env.THAW_RECEIPT_SECRET?.trim() || undefined,
    evmCall: urls.length ? createRpc(urls, fetch) : undefined,
    alchemyTransfers: Boolean(env.ALCHEMY_API_KEY),
  }
}

function uniqueAtomic(priceMicro: number): string {
  const dust = crypto.getRandomValues(new Uint32Array(1))[0]! % 99_999 + 1
  return (BigInt(priceMicro) + BigInt(dust)).toString()
}

export async function handleApi(request: Request, env: Env): Promise<Response | null> {
  applyEnv(env)
  const path = new URL(request.url).pathname
  if (path === '/api/check-orders' || path === '/v1/check-orders') {
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Use POST.' }, 405)
    return createOrder(request, env)
  }
  const residence = /^\/(?:api|v1)\/check-orders\/([^/]+)\/residence$/.exec(path)
  if (residence) {
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Use POST.' }, 405)
    return setResidence(request, env, decodeURIComponent(residence[1] ?? ''))
  }
  const confirm = /^\/(?:api|v1)\/check-orders\/([^/]+)\/confirm$/.exec(path)
  if (confirm) {
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Use POST.' }, 405)
    return confirmOrder(request, env, decodeURIComponent(confirm[1] ?? ''))
  }
  const orderRead = /^\/(?:api|v1)\/check-orders\/([^/]+)$/.exec(path)
  if (orderRead) {
    if (request.method !== 'GET') return json({ ok: false, code: 'method', error: 'Use GET.' }, 405)
    return readOrder(env, decodeURIComponent(orderRead[1] ?? ''))
  }
  if (path === '/api/cases' || path === '/v1/cases') {
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Use POST.' }, 405)
    return openCase(request, env)
  }
  const caseConfirm = /^\/(?:api|v1)\/cases\/([^/]+)\/confirm$/.exec(path)
  if (caseConfirm) {
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Use POST.' }, 405)
    return confirmCase(request, env, decodeURIComponent(caseConfirm[1] ?? ''))
  }
  const review = /^\/(?:api|v1)\/cases\/([^/]+)\/review$/.exec(path)
  if (review) {
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Use POST.' }, 405)
    return reviewCase(request, env, decodeURIComponent(review[1] ?? ''))
  }
  const caseRead = /^\/(?:api|v1)\/cases\/([^/]+)$/.exec(path)
  if (caseRead) {
    if (request.method !== 'GET') return json({ ok: false, code: 'method', error: 'Use GET.' }, 405)
    return readCase(request, env, decodeURIComponent(caseRead[1] ?? ''))
  }
  if (path === '/api/check-chance' || path === '/v1/check-chance') {
    return json(
      { ok: false, code: 'payment_required', error: 'Create an order with POST /api/check-orders and pay it first.' },
      402,
    )
  }
  return null
}

async function createOrder(request: Request, env: Env): Promise<Response> {
  const recipient = env.THAW_USDC_ADDRESS?.trim() ?? ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    return json({ ok: false, code: 'payment_not_configured', error: 'The USDC address is not set.' }, 503)
  }
  let priceMicro: number
  try {
    priceMicro = checkPriceMicro(env.THAW_CHECK_PRICE_USD)
  } catch {
    return json({ ok: false, code: 'price', error: 'The check price must be at least 1.00 USD.' }, 500)
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'json', error: 'Could not read the request.' }, 400)
  }
  const input = parseChanceInput(body)
  if (!input.ok) return json({ ok: false, code: 'input', error: input.error }, 400)
  const chain = paymentChainOf(env)
  const ip = clientIp({ headers: headerRecord(request) })
  const clientKey = `${ip}|${input.value.clientId ?? ''}`
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID()
    const amountAtomic = uniqueAtomic(priceMicro)
    const ok = await insertOrder(env.DB, {
      id,
      created_at: Date.now(),
      chain,
      amount_atomic: amountAtomic,
      price_micro: priceMicro,
      status: 'pending',
      input_json: JSON.stringify(input.value),
      client_key: clientKey,
    })
    if (!ok) continue
    return json(
      {
        ok: true,
        paymentRequired: true,
        orderId: id,
        chain,
        token: USDC_CONTRACT[chain],
        recipient,
        amountAtomic,
        amountUsd: (Number(amountAtomic) / 1_000_000).toFixed(6),
        priceUsd: (priceMicro / 1_000_000).toFixed(2),
        note: 'Send this exact USDC amount. It is credited toward a case opened from this same check.',
      },
      201,
    )
  }
  return json({ ok: false, code: 'amount', error: 'Could not reserve a unique amount. Try again.' }, 503)
}

async function confirmOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const order = await getOrder(env.DB, orderId)
  if (!order) return json({ ok: false, code: 'not_found', error: 'That invoice is not on this server.' }, 404)
  if (order.status === 'paid' && order.result_json) return json(JSON.parse(order.result_json), 200)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'json', error: 'Could not read the request.' }, 400)
  }
  const txHash = body && typeof body === 'object' ? (body as { txHash?: unknown }).txHash : undefined
  if (typeof txHash !== 'string') return json({ ok: false, code: 'tx', error: 'Paste the transaction hash.' }, 400)
  const chain = isPaymentChain(order.chain) ? order.chain : null
  const recipient = env.THAW_USDC_ADDRESS?.trim() ?? ''
  if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    return json({ ok: false, code: 'payment_not_configured', error: 'This server has no USDC address, so it cannot open an invoice.' }, 503)
  }
  const checked = await verifyUsdcTransfer(paymentRpc(chain, env.ALCHEMY_API_KEY, fetch, chain === 'base' ? env.THAW_RPC_URL_BASE : env.THAW_RPC_URL_ARBITRUM), {
    chain,
    txHash,
    recipient,
    amountAtomic: BigInt(order.amount_atomic),
    minConfirmations: confirmationsOf(env),
  })
  if (!checked.ok) return json({ ok: false, code: checked.reason, error: 'That transfer does not match this invoice.' }, 402)
  const input = JSON.parse(order.input_json) as ChanceInput
  const depositChain: RpcChain | null = input.chain === 'ethereum' || input.chain === 'arbitrum' || input.chain === 'base' ? input.chain : null
  const ip = order.client_key.split('|')[0] || 'unknown'
  const result = await runChanceCheck(input, ip, depsFor(env, depositChain))
  if (!result.ok) return json(result, result.status)
  const stored = await consumePayment(env.DB, {
    chain,
    txHash,
    orderId,
    resultJson: JSON.stringify(result),
    feeMicro: order.price_micro,
  })
  if (!stored) return json({ ok: false, code: 'reused', error: 'That transfer was already used on another invoice.' }, 409)
  return json(result, 200)
}

async function setResidence(request: Request, env: Env, orderId: string): Promise<Response> {
  const order = await getOrder(env.DB, orderId)
  if (!order || order.status !== 'paid' || !order.result_json) {
    return json({ ok: false, code: 'unpaid', error: 'The result is available after the check is paid.' }, 402)
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'json', error: 'Could not read the request.' }, 400)
  }
  const raw = body && typeof body === 'object' ? (body as { clientCountry?: unknown }).clientCountry : undefined
  if (typeof raw !== 'string' || !/^[A-Za-z]{2}$/.test(raw.trim())) {
    return json({ ok: false, code: 'country', error: 'Send the country of residence as a two-letter code.' }, 400)
  }
  const stored = JSON.parse(order.result_json) as PublicResult
  const input = JSON.parse(order.input_json) as ChanceInput
  const trace = stored.traceFacts ?? { addressesCount: null, htxLinked: false }
  if (input.exchange !== 'htx' && trace.htxLinked !== true) {
    return json({ ok: false, code: 'country_not_needed', error: 'This check does not need a country of residence.' }, 409)
  }
  const recommendation = recommendationWithCountry(input, stored.verdict, trace, raw.trim().toUpperCase())
  const next: PublicResult = { ...stored, recommendation }
  const saved = await updatePaidResult(env.DB, order.id, JSON.stringify(next))
  if (!saved) return json({ ok: false, code: 'not_found', error: 'The result was not stored.' }, 404)
  const fresh = await getOrder(env.DB, order.id)
  if (!fresh) return json({ ok: false, code: 'not_found', error: 'That invoice is not on this server.' }, 404)
  return json(orderView(env, fresh), 200)
}

async function readOrder(env: Env, orderId: string): Promise<Response> {
  const order = await getOrder(env.DB, orderId)
  if (!order) return json({ ok: false, code: 'not_found', error: 'That invoice is not on this server.' }, 404)
  return json(orderView(env, order), 200)
}

function orderView(env: Env, order: NonNullable<Awaited<ReturnType<typeof getOrder>>>): Record<string, unknown> {
  const chain = isPaymentChain(order.chain) ? order.chain : paymentChainOf(env)
  const view: Record<string, unknown> = {
    ok: true,
    orderId: order.id,
    status: order.status,
    paid: order.status === 'paid',
    chain,
    token: USDC_CONTRACT[chain],
    recipient: env.THAW_USDC_ADDRESS?.trim() ?? '',
    amountAtomic: order.amount_atomic,
    amountUsd: (Number(order.amount_atomic) / 1_000_000).toFixed(6),
    priceUsd: (order.price_micro / 1_000_000).toFixed(2),
    feeCreditMicro: order.fee_credit_micro,
  }
  if (order.status === 'paid' && order.result_json) view.result = JSON.parse(order.result_json)
  return view
}

async function openCase(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'json', error: 'Could not read the request.' }, 400)
  }
  const row = body && typeof body === 'object' ? (body as { orderId?: unknown; tier?: unknown; userConfirmedLowChance?: unknown }) : {}
  if (typeof row.orderId !== 'string' || (row.tier !== 'light' && row.tier !== 'full')) {
    return json({ ok: false, code: 'input', error: 'Send orderId and tier light or full.' }, 400)
  }
  const order = await getOrder(env.DB, row.orderId)
  if (!order || order.status !== 'paid' || !order.result_json) {
    return json({ ok: false, code: 'unpaid', error: 'A case opens only after the check is paid.' }, 402)
  }
  const stored = JSON.parse(order.result_json) as {
    verdict?: string
    recommendation?: {
      tier?: string
      lightAllowed?: boolean
      lightBlockedNote?: string | null
      status?: string
      reason?: string
      reasonId?: string
      flags?: string[]
      canOpenCase?: boolean
    }
  }
  const verdict = stored.verdict
  const confirmedLow = row.userConfirmedLowChance === true
  if (verdict === 'low' && !confirmedLow) {
    return json({ ok: false, code: 'blocked_low_chance', error: 'A low chance stays closed until you confirm you still want the file.' }, 403)
  }
  if (verdict !== 'high' && verdict !== 'medium' && verdict !== 'low') {
    return json({ ok: false, code: 'verdict', error: 'We do not open a file for this notice.' }, 403)
  }
  const recommended = stored.recommendation
  if (recommended?.status === 'refused' || (recommended?.canOpenCase === false && recommended.status !== 'blocked_low_chance')) {
    return json({ ok: false, code: recommended.reasonId ?? recommended.status ?? 'verdict', error: recommended.reason ?? 'That file is not available for this check.' }, 403)
  }
  if (recommended?.flags?.includes('HTX_COUNTRY_REQUIRED')) {
    return json({ ok: false, code: 'blocked_need_country', error: recommended.reason ?? NEED_COUNTRY_NOTE }, 403)
  }
  if (recommended && (recommended.tier === 'light' || recommended.tier === 'full')) {
    const choice = chooseTier(
      choiceResult(recommended.tier, recommended.lightAllowed !== false, recommended.lightBlockedNote ?? null),
      row.tier,
    )
    if (!choice.ok) {
      return json({ ok: false, code: choice.error, error: choice.note ?? 'That file is not available for this check.' }, 403)
    }
  }
  const existing = await getCaseForOrder(env.DB, order.id)
  if (existing) {
    if (existing.tier && existing.tier !== row.tier) {
      return json({ ok: false, code: 'tier', error: 'This check already has a case on the other tier.' }, 409)
    }
    return json(await casePayload(env, existing, true), 200)
  }
  const fallback = row.tier === 'light' ? '49' : '79'
  const priceMicro = parseUsdToMicro(row.tier === 'light' ? env.THAW_CASE_LIGHT_USD : env.THAW_CASE_FULL_USD, fallback)
  if (priceMicro == null) return json({ ok: false, code: 'price', error: 'The case price could not be read.' }, 500)
  const fee = Math.min(order.fee_credit_micro, priceMicro)
  const net = priceMicro - fee
  const chain = paymentChainOf(env)
  const recipient = env.THAW_USDC_ADDRESS?.trim() ?? ''
  if (net > 0 && !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    return json({ ok: false, code: 'payment_not_configured', error: 'The USDC address is not set.' }, 503)
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID()
    const amountAtomic = net === 0 ? null : uniqueAtomic(net)
    const ok = await insertCaseInvoice(env.DB, {
      id,
      orderId: order.id,
      tier: row.tier,
      priceMicro,
      feeCreditMicro: fee,
      netMicro: net,
      createdAt: Date.now(),
      status: net === 0 ? 'paid' : 'awaiting_payment',
      chain: net === 0 ? null : chain,
      amountAtomic,
      lowConfirmedAt: verdict === 'low' ? Date.now() : null,
    })
    if (!ok) continue
    const saved = await getCase(env.DB, id)
    if (!saved) return json({ ok: false, code: 'internal', error: 'The case was not stored.' }, 500)
    const caseToken = await issueCaseToken(env, saved.id)
    if (saved.status === 'paid') await settlePaidCase(env, saved.id)
    const fresh = await getCase(env.DB, id)
    return json({ ...(await casePayload(env, fresh ?? saved, false)), caseToken }, 201)
  }
  return json({ ok: false, code: 'amount', error: 'Could not reserve a unique amount. Try again.' }, 503)
}

async function reviewCase(request: Request, env: Env, caseId: string): Promise<Response> {
  const expected = env.THAW_REVIEW_TOKEN?.trim() ?? ''
  const got = request.headers.get('x-review-token') ?? ''
  if (!expected || !sameText(expected, got)) return json({ ok: false, code: 'review', error: 'A reviewer has to accept the draft before it is shown.' }, 403)
  const row = await getCase(env.DB, caseId)
  if (!row) return json({ ok: false, code: 'not_found', error: 'Case not found.' }, 404)
  if (!(await caseTokenOk(request, row))) return json({ ok: false, code: 'case_token', error: 'Send the case token from when the case was opened.' }, 401)
  let work: Record<string, unknown> = {}
  try {
    work = row.work_json ? (JSON.parse(row.work_json) as Record<string, unknown>) : {}
  } catch {
    work = {}
  }
  work.stage = 'ready'
  await saveCaseWork(env.DB, caseId, 'ready', JSON.stringify(work))
  const fresh = await getCase(env.DB, caseId)
  return json(await casePayload(env, fresh ?? row, false), 200)
}

async function readCase(request: Request, env: Env, caseId: string): Promise<Response> {
  const row = await getCase(env.DB, caseId)
  if (!row) return json({ ok: false, code: 'not_found', error: 'Case not found.' }, 404)
  if (!(await caseTokenOk(request, row))) return json({ ok: false, code: 'case_token', error: 'Send the case token from when the case was opened.' }, 401)
  return json(await casePayload(env, row, false), 200)
}

async function confirmCase(request: Request, env: Env, caseId: string): Promise<Response> {
  const row = await getCase(env.DB, caseId)
  if (!row) return json({ ok: false, code: 'not_found', error: 'Case not found.' }, 404)
  if (row.status === 'paid') return json(await casePayload(env, row, false), 200)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'json', error: 'Could not read the request.' }, 400)
  }
  const txHash = body && typeof body === 'object' ? (body as { txHash?: unknown }).txHash : undefined
  if (typeof txHash !== 'string') return json({ ok: false, code: 'tx', error: 'Send the transfer hash as txHash.' }, 400)
  const chain = row.chain && isPaymentChain(row.chain) ? row.chain : null
  const recipient = env.THAW_USDC_ADDRESS?.trim() ?? ''
  if (!chain || !row.amount_atomic || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    return json({ ok: false, code: 'payment_not_configured', error: 'Payment is not configured.' }, 503)
  }
  const checked = await verifyUsdcTransfer(paymentRpc(chain, env.ALCHEMY_API_KEY, fetch, chain === 'base' ? env.THAW_RPC_URL_BASE : env.THAW_RPC_URL_ARBITRUM), {
    chain,
    txHash,
    recipient,
    amountAtomic: BigInt(row.amount_atomic),
    minConfirmations: confirmationsOf(env),
  })
  if (!checked.ok) return json({ ok: false, code: checked.reason, error: 'That transfer does not match this case.' }, 402)
  const stored = await consumeCasePayment(env.DB, { chain, txHash, orderId: row.order_id, caseId: row.id })
  if (!stored) return json({ ok: false, code: 'reused', error: 'That transfer was already used.' }, 409)
  const paid = await getCase(env.DB, row.id)
  if (!paid) return json({ ok: false, code: 'not_found', error: 'Case not found.' }, 404)
  await settlePaidCase(env, paid.id)
  const settled = await getCase(env.DB, paid.id)
  return json(await casePayload(env, settled ?? paid, false), 200)
}

async function casePayload(env: Env, row: CaseRow, existing: boolean): Promise<Record<string, unknown>> {
  const order = await getOrder(env.DB, row.order_id)
  let verdict: string | null = null
  if (order?.result_json) {
    try {
      verdict = (JSON.parse(order.result_json) as { verdict?: string }).verdict ?? null
    } catch {
      verdict = null
    }
  }
  const cover = verdict === 'low' ? LOW_CHANCE_WARNINGS.find((item) => item.place === 'case_cover_note') : undefined
  return {
    ...caseView(env, row, existing),
    verdict,
    coverNote: cover?.text ?? null,
    lowConfirmedAt: row.low_confirmed_at,
  }
}

async function issueCaseToken(env: Env, caseId: string): Promise<string> {
  const token = `thc_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`
  await setCaseToken(env.DB, caseId, await sha256(token))
  return token
}

async function caseTokenOk(request: Request, row: CaseRow): Promise<boolean> {
  if (!row.case_token_hash) return false
  const header = request.headers.get('x-case-token') ?? ''
  const bearer = request.headers.get('authorization') ?? ''
  const presented = header || (bearer.toLowerCase().startsWith('bearer ') ? bearer.slice(7).trim() : '')
  if (!presented) return false
  return sameText(await sha256(presented), row.case_token_hash)
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sameText(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let diff = 0
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i)
  return diff === 0
}

async function settlePaidCase(env: Env, caseId: string): Promise<void> {
  const row = await getCase(env.DB, caseId)
  const order = row ? await getOrder(env.DB, row.order_id) : null
  if (!row || !order || row.status !== 'paid') return
  let input: { exchange?: string; chain?: string; deposit?: string; amount?: string; asset?: string; date?: string }
  try {
    input = JSON.parse(order.input_json) as typeof input
  } catch {
    input = {}
  }
  const chain = input.chain === 'tron' || input.chain === 'ethereum' || input.chain === 'arbitrum' || input.chain === 'base' ? input.chain : 'tron'
  const tier = row.tier === 'full' ? 'full' : 'light'
  const dailyCap = Number(env.THAW_KITE_DAILY_CAP_USD ?? '10')
  const dailyCapMicro = Number.isFinite(dailyCap) && dailyCap > 0 ? Math.round(dailyCap * 1_000_000) : DEFAULT_DAILY_CAP_MICRO
  const expires = env.KITE_SESSION_EXPIRES_AT ? Number(env.KITE_SESSION_EXPIRES_AT) : null
  const executor = env.KITE_HTTP_EXECUTE_URL ? createHttpKiteExecutor(fetch, env.KITE_HTTP_EXECUTE_URL) : createRunnerExecutor()
  try {
    const work = await runPaidCase(
      {
        caseId,
        tier,
        exchange: input.exchange ?? 'exchange',
        chain,
        deposit: input.deposit ?? '',
        amount: input.amount ?? '',
        asset: input.asset ?? '',
        date: input.date ?? '',
        transfers: await traceTransfers(env, chain, input),
        depositTimeMs: null,
      },
      {
        now: () => Date.now(),
        kiteEnabled: env.THAW_KITE_ENABLED === '1',
        sessionId: env.KITE_SESSION_ID,
        sessionExpiresAt: expires != null && Number.isFinite(expires) ? expires : null,
        dailyCapMicro,
        caseSpentMicro: await spentMicro(env.DB, { caseId }),
        daySpentMicro: await spentMicro(env.DB, { since: Date.now() - 86_400_000 }),
        executor,
        serv: env.SERV_API_KEY ? createFetchComplete() : null,
        recordSpend: (spend) => insertSpend(env.DB, spend),
      },
    )
    await saveCaseWork(env.DB, caseId, work.stage, JSON.stringify(work))
  } catch (err) {
    console.error('case pipeline failed', err instanceof Error ? err.name : 'error')
    await saveCaseWork(env.DB, caseId, 'waiting_kite', JSON.stringify({ stage: 'waiting_kite', waitReason: 'runner_required', timeline: ['The case is paid. The paper pipeline did not finish.'] }))
  }
}

async function traceTransfers(
  env: Env,
  chain: 'tron' | 'ethereum' | 'arbitrum' | 'base',
  input: { deposit?: string; amount?: string; asset?: string; date?: string },
): Promise<Array<{ address: string; raw: string; timeMs: number | null; chain: typeof chain }>> {
  const keyed = chain === 'tron' ? Boolean(env.TRONGRID_API_KEY) : Boolean(env.ETHERSCAN_API_KEY || env.ALCHEMY_API_KEY)
  if (!keyed || !input.deposit || !input.amount || !input.asset || !input.date) return []
  try {
    const hop = await lookupFirstHop(
      { chain, deposit: input.deposit, amount: input.amount, asset: input.asset, date: input.date },
      fetch,
      { etherscanApiKey: env.ETHERSCAN_API_KEY, trongridApiKey: env.TRONGRID_API_KEY, alchemyTransfers: Boolean(env.ALCHEMY_API_KEY) },
    )
    const addresses = [hop.sender, ...hop.hop1].filter((item): item is string => Boolean(item))
    return addresses.map((address) => ({ address, raw: '0', timeMs: null, chain }))
  } catch {
    return []
  }
}

function caseView(env: Env, row: CaseRow, existing: boolean): Record<string, unknown> {
  const chain = row.chain && isPaymentChain(row.chain) ? row.chain : null
  return {
    ok: true,
    caseId: row.id,
    orderId: row.order_id,
    tier: row.tier,
    status: row.status,
    paid: row.status === 'paid',
    existing,
    priceMicro: row.price_micro,
    feeCreditMicro: row.fee_credit_micro,
    netMicro: row.net_micro,
    priceUsd: (row.price_micro / 1_000_000).toFixed(2),
    feeUsd: (row.fee_credit_micro / 1_000_000).toFixed(2),
    netUsd: (row.net_micro / 1_000_000).toFixed(2),
    chain,
    token: chain ? USDC_CONTRACT[chain] : null,
    recipient: env.THAW_USDC_ADDRESS?.trim() ?? '',
    amountAtomic: row.amount_atomic,
    amountUsd: row.amount_atomic ? (Number(row.amount_atomic) / 1_000_000).toFixed(6) : null,
    stage: row.stage || (row.status === 'paid' ? 'paid' : 'awaiting_payment'),
    ...publicWork(row),
  }
}

function publicWork(row: CaseRow): Record<string, unknown> {
  if (!row.work_json) return {}
  try {
    const work = JSON.parse(row.work_json) as {
      stage?: string
      waitReason?: string | null
      timeline?: string[]
      screened?: number
      skipped?: number
      trigger?: { text?: string; source?: string }
      appeal?: { subject?: string; body?: string } | null
      pdfBase64?: string
    }
    const ready = work.stage === 'ready'
    return {
      waitReason: work.waitReason ?? null,
      timeline: work.timeline ?? [],
      screened: work.screened ?? 0,
      skipped: work.skipped ?? 0,
      trigger: work.trigger?.text ?? null,
      appeal: ready ? work.appeal : null,
      pdfBase64: work.pdfBase64 ?? null,
    }
  } catch {
    return {}
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    try {
      if (new URL(request.url).pathname === '/mcp') return mcpFetch(request, env, ctx)
      const api = await handleApi(request, env)
      if (api) return api
      return env.ASSETS.fetch(request)
    } catch (err) {
      console.error('worker failed', err instanceof Error ? err.name : 'error')
      return json({ ok: false, code: 'internal', error: 'The request failed.' }, 500)
    }
  },
}
