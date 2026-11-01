import { clientIp, createFetchComplete } from '@thaw/guard'
import { liveBanList } from './chance/banlist.ts'
import { createServHooks, runChanceCheck, type ChanceDeps } from './chance/check.ts'
import { PAID_PATH_PRICE_USD } from './chance/constants.ts'
import { defaultLimitConfig } from './chance/limits.ts'
import { parseChanceInput, type ChanceInput } from './chance/parse.ts'
import { captchaRequired, verifyCaptchaToken } from './captcha.ts'
import { createRpc, rpcUrls, type RpcChain } from './chain/evm-rpc.ts'
import { consumePayment, d1LimitStore, getOrder, insertCase, insertOrder } from './db/d1-store.ts'
import type { SqlDb } from './db/sql.ts'
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
  const override = depositChain === 'ethereum' ? env.THAW_RPC_URL_ETHEREUM : depositChain === 'arbitrum' ? env.THAW_RPC_URL_ARBITRUM : undefined
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
  if (path === '/api/cases' || path === '/v1/cases') {
    if (request.method !== 'POST') return json({ ok: false, code: 'method', error: 'Нужен POST.' }, 405)
    return openCase(request, env)
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
        note: 'Переведите ровно эту сумму USDC. Она зачтётся в цену дела, если вы откроете дело по этому заказу.',
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
  const depositChain: RpcChain | null = input.chain === 'ethereum' || input.chain === 'arbitrum' ? input.chain : null
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

async function openCase(request: Request, env: Env): Promise<Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, code: 'json', error: 'Не удалось прочитать запрос.' }, 400)
  }
  const row = body && typeof body === 'object' ? (body as { orderId?: unknown; tier?: unknown }) : {}
  if (typeof row.orderId !== 'string' || (row.tier !== 'light' && row.tier !== 'full')) {
    return json({ ok: false, code: 'input', error: 'Нужны orderId и tier light или full.' }, 400)
  }
  const order = await getOrder(env.DB, row.orderId)
  if (!order || order.status !== 'paid' || !order.result_json) {
    return json({ ok: false, code: 'unpaid', error: 'Дело открывается только по оплаченной проверке.' }, 402)
  }
  const verdict = (JSON.parse(order.result_json) as { verdict?: string }).verdict
  if (verdict !== 'high' && verdict !== 'medium') {
    return json({ ok: false, code: 'verdict', error: 'Дело открывается при высоком или среднем шансе.' }, 403)
  }
  const fallback = row.tier === 'light' ? '49' : '79'
  const priceMicro = parseUsdToMicro(row.tier === 'light' ? env.THAW_CASE_LIGHT_USD : env.THAW_CASE_FULL_USD, fallback)
  if (priceMicro == null) return json({ ok: false, code: 'price', error: 'Цена дела не читается.' }, 500)
  const fee = Math.min(order.fee_credit_micro, priceMicro)
  const net = priceMicro - fee
  const id = crypto.randomUUID()
  await insertCase(env.DB, { id, orderId: order.id, priceMicro, feeCreditMicro: fee, netMicro: net, createdAt: Date.now() })
  return json({ ok: true, caseId: id, orderId: order.id, priceMicro, feeCreditMicro: fee, netMicro: net, paid: false }, 201)
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
