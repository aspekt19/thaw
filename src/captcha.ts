/**
 * Server-side captcha hook.
 * Siteverify: POST https://challenges.cloudflare.com/turnstile/v0/siteverify
 * with secret and response. Documented response field: success.
 * The browser widget script URL was not in that server-side page, so the
 * page does not load a widget. TODO: embed the widget once its script URL
 * is taken from the client integration page.
 * Off unless THAW_TURNSTILE_SECRET is set.
 */

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export function captchaRequired(): boolean {
  return Boolean(process.env.THAW_TURNSTILE_SECRET?.trim())
}

export async function verifyCaptchaToken(
  token: string | undefined,
  fetchImpl: typeof fetch = fetch,
  secret = process.env.THAW_TURNSTILE_SECRET?.trim(),
): Promise<boolean> {
  if (!secret || !token) return false
  let response: Response
  try {
    response = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return false
  }
  if (!response.ok) return false
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return false
  }
  return Boolean(body && typeof body === 'object' && (body as { success?: unknown }).success === true)
}
