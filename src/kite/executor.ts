/**
 * Kite's public docs (https://docs.gokite.ai/api-reference, read 2026-11-02) say there is
 * no public HTTP API yet. Paid calls go through the kpass CLI. A Worker cannot spawn kpass,
 * so the default executor does not call the network and does not use account allowance.
 * An external runner that already has kpass and the same KITE_SESSION_ID can implement KiteExecutor.
 * That runner must call `kpass session execute --session-id "$KITE_SESSION_ID"` and must never pass `--use-allowance`.
 * If Kite later publishes session execute over HTTP, set KITE_HTTP_EXECUTE_URL and use createHttpKiteExecutor.
 * The request always sends the explicit session id.
 */

export type KiteJob = {
  sessionId: string
  method: string
  url: string
  body?: string
  idempotencyKey: string
}

export type KiteCallResult =
  | { ok: true; status: number; body: unknown; amountMicro: number }
  | { ok: false; code: 'runner_required' | 'http_unpublished' | 'session_expired' | 'session_exhausted' | 'transport'; message: string }

export interface KiteExecutor {
  readonly kind: 'runner' | 'http' | 'mock'
  execute(job: KiteJob): Promise<KiteCallResult>
}

export function createRunnerExecutor(): KiteExecutor {
  return {
    kind: 'runner',
    async execute(job) {
      return {
        ok: false,
        code: 'runner_required',
        message: `Kite has no documented HTTP session execute. A runner must call kpass session execute --session-id ${job.sessionId} --method ${job.method} --url ${job.url}. Do not pass --use-allowance.`,
      }
    },
  }
}

export function createHttpKiteExecutor(fetchImpl: typeof fetch, executeUrl: string | undefined): KiteExecutor {
  return {
    kind: 'http',
    async execute(job) {
      if (!executeUrl) {
        return {
          ok: false,
          code: 'http_unpublished',
          message: 'KITE_HTTP_EXECUTE_URL is empty. Public Kite docs do not publish a session-execute URL.',
        }
      }
      try {
        const response = await fetchImpl(executeUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            session_id: job.sessionId,
            method: job.method,
            url: job.url,
            body: job.body ?? null,
            idempotency_key: job.idempotencyKey,
          }),
        })
        const body = await response.json().catch(() => null)
        const row = body && typeof body === 'object' ? (body as { code?: string; amount_micro?: number; amountMicro?: number }) : {}
        if (row.code === 'session_expired' || row.code === 'session_total_exceeded') {
          return { ok: false, code: row.code === 'session_expired' ? 'session_expired' : 'session_exhausted', message: 'The Kite session cannot pay.' }
        }
        if (!response.ok) return { ok: false, code: 'transport', message: `Kite HTTP ${response.status}` }
        const amount = row.amount_micro ?? row.amountMicro
        if (typeof amount !== 'number') return { ok: false, code: 'transport', message: 'Kite HTTP did not return amount_micro.' }
        return { ok: true, status: response.status, body, amountMicro: amount }
      } catch {
        return { ok: false, code: 'transport', message: 'Kite HTTP did not answer.' }
      }
    },
  }
}
