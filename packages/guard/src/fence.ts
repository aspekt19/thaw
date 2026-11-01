/**
 * Thaw's own fence for untrusted notice text.
 * AllowLatch serv.ts (fence / servInjectionCheck) at commit f33257d was not
 * in the published package and the private repo was not readable. This is not
 * that function. It only wraps text so a later prompt can treat it as data.
 */

const OPEN = '<untrusted_user_text>'
const CLOSE = '</untrusted_user_text>'

export function fenceUntrusted(text: string): string {
  const safe = text.replaceAll(CLOSE, '<\\/untrusted_user_text>')
  return `${OPEN}\n${safe}\n${CLOSE}`
}
