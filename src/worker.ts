import { clientIp, createFetchComplete } from '@thaw/guard'
import { liveBanList } from './chance/banlist.ts'
import { createServHooks, runChanceCheck, type ChanceDeps } from './chance/check.ts'
import { PAID_PATH_PRICE_USD } from './chance/constants.ts'
import { defaultLimitConfig } from './chance/limits.ts'
import { parseChanceInput, type ChanceInput } from './chance/parse.ts'
import { captchaRequired, verifyCaptchaToken } from './captcha.ts'
import { createRpc, rpcUrls, type RpcChain } from './chain/evm-rpc.ts'
import { consumeCasePayment, consumePayment, d1LimitStore, getCase, getCaseForOrder, getOrder, insertCaseInvoice, insertOrder, type CaseRow } from './db/d1-store.ts'
import type { SqlDb } from './db/sql.ts'
import { LOW_CHANCE_WARNINGS } from './chance/tier.ts'
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
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Нужен POST.' }, 405)
    return createOrder(request, env)
  }
  const confirm = /^\/(?:api|v1)\/check-orders\/([^/]+)\/confirm$/.exec(path)
  if (confirm) {
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Нужен POST.' }, 405)
    return confirmOrder(request, env, decodeURIComponent(confirm[1] ?? ''))
  }
  const orderRead = /^\/(?:api|v1)\/check-orders\/([^/]+)$/.exec(path)
  if (orderRead) {
    if (request.method !== 'GET') return json({ ok: false, code: 'method', error: 'Нужен GET.' }, 405)
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
  const caseRead = /^\/(?:api|v1)\/cases\/([^/]+)$/.exec(path)
  if (caseRead) {
    if (request.method !== 'GET') return json({ ok: false, code: 'method', error: 'Use GET.' }, 405)
    return readCase(env, decodeURIComponent(caseRead[1] ?? ''))
  }
  if (path === '/api/check-chance' || path === '/v1/check-chance') {
    return json(
      { ok: false, code: 'payment_required', error: 'Сначала создайте заказ через POST /api/check-orders и оплатите его.' },
      402,
    )
  }
  return null
}

async function createOrder(request: Request, env: Env): Promise<Response> {
  const recipient = env.THAW_USDC_ADDRESS?.trim() ?? ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    return json({ ok: false, code: 'payment_not_configured', error: 'Адрес для USDC не задан.' }, 503)
  }
  let priceMicro: number
  try {
    priceMicro = checkPriceMicro(env.THAW_CHECK_PRICE_USD)
  } catch {
    return json({ ok: false, code: 'price', error: 'Цена проверки должна быть не меньше 1.00 USD.' }, 500)
  }
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'json', error: 'Не удалось прочитать запрос.' }, 400)
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
  return json({ ok: false, code: 'amount', error: 'Не удалось выделить уникальную сумму. Повторите.' }, 503)
}

async function confirmOrder(request: Request, env: Env, orderId: string): Promise<Response> {
  const order = await getOrder(env.DB, orderId)
  if (!order) return json({ ok: false, code: 'not_found', error: 'Заказ не найден.' }, 404)
  if (order.status === 'paid' && order.result_json) return json(JSON.parse(order.result_json), 200)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'json', error: 'Не удалось прочитать запрос.' }, 400)
  }
  const txHash = body && typeof body === 'object' ? (body as { txHash?: unknown }).txHash : undefined
  if (typeof txHash !== 'string') return json({ ok: false, code: 'tx', error: 'Нужен txHash перевода.' }, 400)
  const chain = isPaymentChain(order.chain) ? order.chain : null
  const recipient = env.THAW_USDC_ADDRESS?.trim() ?? ''
  if (!chain || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
    return json({ ok: false, code: 'payment_not_configured', error: 'Оплата не настроена.' }, 503)
  }
  const checked = await verifyUsdcTransfer(paymentRpc(chain, env.ALCHEMY_API_KEY, fetch, chain === 'base' ? env.THAW_RPC_URL_BASE : env.THAW_RPC_URL_ARBITRUM), {
    chain,
    txHash,
    recipient,
    amountAtomic: BigInt(order.amount_atomic),
    minConfirmations: confirmationsOf(env),
  })
  if (!checked.ok) return json({ ok: false, code: checked.reason, error: 'Перевод не подошёл к этому заказу.' }, 402)
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
  if (!stored) return json({ ok: false, code: 'reused', error: 'Этот перевод уже использован.' }, 409)
  return json(result, 200)
}

async function readOrder(env: Env, orderId: string): Promise<Response> {
  const order = await getOrder(env.DB, orderId)
  if (!order) return json({ ok: false, code: 'not_found', error: 'Заказ не найден.' }, 404)
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
  const verdict = (JSON.parse(order.result_json) as { verdict?: string }).verdict
  const confirmedLow = row.userConfirmedLowChance === true
  if (verdict === 'low' && !confirmedLow) {
    return json({ ok: false, code: 'blocked_low_chance', error: 'A low chance stays closed until you confirm you still want the file.' }, 403)
  }
  if (verdict !== 'high' && verdict !== 'medium' && verdict !== 'low') {
    return json({ ok: false, code: 'verdict', error: 'We do not open a file for this notice.' }, 403)
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
    return json(await casePayload(env, saved, false), 201)
  }
  return json({ ok: false, code: 'amount', error: 'Could not reserve a unique amount. Try again.' }, 503)
}

async function readCase(env: Env, caseId: string): Promise<Response> {
  const row = await getCase(env.DB, caseId)
  if (!row) return json({ ok: false, code: 'not_found', error: 'Case not found.' }, 404)
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
  return json(await casePayload(env, paid, false), 200)
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
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const api = await handleApi(request, env)
      if (api) return api
      return env.ASSETS.fetch(request)
    } catch (err) {
      console.error('worker failed', err instanceof Error ? err.name : 'error')
      return json({ ok: false, code: 'internal', error: 'Запрос не выполнен.' }, 500)
    }
  },
}
