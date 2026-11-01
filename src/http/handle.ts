import { assertJsonBodySize, checkBodySize, checkRateLimit, clientIp, createFetchComplete } from '@thaw/guard'
import { liveBanList } from '../chance/banlist.ts'
import { createServHooks, runChanceCheck, type ChanceDeps } from '../chance/check.ts'
import { PAID_PATH_PRICE_USD } from '../chance/constants.ts'
import { asAsyncStore, createStore, defaultLimitConfig } from '../chance/limits.ts'
import { parseChanceInput } from '../chance/parse.ts'
import { captchaRequired, verifyCaptchaToken } from '../captcha.ts'

let shared: ChanceDeps | undefined

export function defaultDeps(): ChanceDeps {
  if (shared) return shared
  shared = {
    now: () => Date.now(),
    fetch,
    serv: process.env.SERV_API_KEY ? createServHooks(createFetchComplete()) : null,
    banlist: liveBanList(),
    store: asAsyncStore(createStore()),
    limits: defaultLimitConfig(),
    captchaRequired: captchaRequired(),
    verifyCaptcha: (token) => verifyCaptchaToken(token),
    paidPathEnabled: process.env.THAW_PAID_PATH_ENABLED === '1',
    paidPathPriceUsd: PAID_PATH_PRICE_USD,
    id: () => crypto.randomUUID(),
    burst: (key) => checkRateLimit(key),
    etherscanApiKey: process.env.ETHERSCAN_API_KEY,
    trongridApiKey: process.env.TRONGRID_API_KEY,
    receiptSecret: process.env.THAW_RECEIPT_SECRET?.trim() || undefined,
  }
  return shared
}

export async function postCheck(request: Request): Promise<Response> {
  return handleRequest(request, defaultDeps())
}

export async function handleRequest(request: Request, deps: ChanceDeps): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, code: 'method', error: 'Нужен POST.' }, 405)
  }
  const raw = await request.text()
  try {
    assertJsonBodySize(raw)
  } catch {
    return json({ ok: false, code: 'body', error: 'Слишком большой запрос.' }, 413)
  }
  let payload: unknown
  try {
    payload = await payloadFrom(raw, request.headers.get('content-type'))
  } catch {
    return json({ ok: false, code: 'json', error: 'Не удалось прочитать запрос.' }, 400)
  }
  const size = checkBodySize(payload)
  if (!size.ok) return json({ ok: false, code: 'body', error: 'Слишком большой запрос.' }, size.status)
  const input = parseChanceInput(payload)
  if (!input.ok) return json({ ok: false, code: 'input', error: input.error }, 400)
  const ip = clientIp({ headers: headerRecord(request) })
  try {
    const result = await runChanceCheck(input.value, ip, deps)
    return json(result, result.ok ? 200 : result.status)
  } catch (err) {
    console.error('check-chance failed', err instanceof Error ? err.name : 'error')
    return json({ ok: false, code: 'internal', error: 'Проверка не выполнена.' }, 500)
  }
}

async function payloadFrom(raw: string, contentType: string | null): Promise<unknown> {
  if (contentType?.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw))
  }
  return JSON.parse(raw) as unknown
}

function headerRecord(request: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return headers
}

function json(body: unknown, status: number): Response {
  return Response.json(body, { status })
}
