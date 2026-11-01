/**
 * Copied from AllowLatch src/lib/serv-v3.ts at f33257df64e1600c61185ab1a2835e3b9e58f536.
 * Only the text helpers the answer check uses. The OpenServ graph client in that file is not copied.
 */

const OBVIOUS_INJECTION = [
  /ignore\s+(all\s+)?(previous|prior)\s+(instructions|rules|policy|prompts)/i,
  /disregard\s+(all\s+)?(previous|prior|the)\s+(rules|policy|mandate|instructions)/i,
  /\bjailbreak\b/i,
]

const STEALTH_INJECTION = [
  /you are now/i,
  /\[\s*system(?:_override)?[:\s\]]/i,
  /system_override/i,
  /transfer\s+\d+(?:\.\d+)?\s*usdc/i,
  /\bnew (task|instructions|role)\b/i,
  /do not tell (the )?(buyer|user|human)/i,
  /unlimited (usdc|approval|allowance)/i,
  /maxuint256|type\(\s*uint256\s*\)\s*\.\s*max/i,
  /0x095ea7b3/i,
  /override (the )?(policy|criteria|mandate|acceptance)/i,
  /grant unlimited/i,
  /hidden instruction/i,
  /aWdub3JlIHByZXZpb3Vz/i,
]

export function normalizeUntrusted(text: string): string {
  return text
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/<!--([\s\S]*?)-->/g, ' $1 ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text))
}

/** Raw mode only sees blatant overrides. SERV mode also unfolds hidden and zero-width text. */
export function detectInjection(text: string, raw: boolean): boolean {
  if (matchesAny(text, OBVIOUS_INJECTION)) return true
  if (raw) return false
  return matchesAny(normalizeUntrusted(text), [...OBVIOUS_INJECTION, ...STEALTH_INJECTION])
}

export function unwrapJsonText(raw: string): { text: string; modified: boolean; salvageReasons: string[] } {
  let text = String(raw ?? '')
  let modified = false
  const salvageReasons: string[] = []

  // 1. Strip BOM and zero-width characters
  if (/[\uFEFF\u200B-\u200D\u2060]/.test(text)) {
    text = text.replace(/[\uFEFF\u200B-\u200D\u2060]/g, '')
    modified = true
    salvageReasons.push('stripped BOM/zero-width characters')
  }
  text = text.trim()

  // 2. Strip markdown code fences (```json ... ```)
  const fenceMatch = /^\s*```(?:json|javascript|js|ts|txt)?\s*([\s\S]*?)\s*```\s*$/i.exec(text)
  if (fenceMatch && fenceMatch[1]) {
    text = fenceMatch[1].trim()
    modified = true
    salvageReasons.push('stripped markdown code fence')
  } else {
    const inlineFence = /```(?:json|javascript|js|ts)?\s*([\s\S]*?)\s*```/i.exec(text)
    if (inlineFence && inlineFence[1] && inlineFence[1].includes('{')) {
      text = inlineFence[1].trim()
      modified = true
      salvageReasons.push('extracted JSON from inline markdown code block')
    }
  }

  // 3. Strip SSE data: prefix lines
  if (/^data:\s*\{/im.test(text)) {
    const sseLines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.replace(/^data:\s*/, '').trim())
      .filter((l) => l && l !== '[DONE]')
    if (sseLines.length > 0) {
      text = sseLines[sseLines.length - 1]!
      modified = true
      salvageReasons.push('extracted JSON from SSE data stream')
    }
  }

  // 4. Unwrap JSONP callback wrapper: callback({...});
  const jsonpMatch = /^[a-zA-Z_$][\w$.]*\s*\(\s*(\s*\{[\s\S]*\}\s*)\s*\)\s*;?\s*$/.exec(text)
  if (jsonpMatch && jsonpMatch[1]) {
    text = jsonpMatch[1].trim()
    modified = true
    salvageReasons.push('unwrapped JSONP callback')
  }

  // 5. Extract outermost {...} if embedded in prose or HTML wrapper
  if (!text.startsWith('{')) {
    const firstBrace = text.indexOf('{')
    const lastBrace = text.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      text = text.slice(firstBrace, lastBrace + 1).trim()
      modified = true
      salvageReasons.push('extracted embedded JSON object from surrounding prose/HTML')
    }
  } else if (!text.endsWith('}')) {
    const lastBrace = text.lastIndexOf('}')
    if (lastBrace > 0) {
      text = text.slice(0, lastBrace + 1).trim()
      modified = true
      salvageReasons.push('trimmed trailing prose after JSON object')
    }
  }

  // 6. Repair trailing commas before } or ]
  if (/,(\s*[}\]])/.test(text)) {
    text = text.replace(/,(\s*[}\]])/g, '$1')
    modified = true
    salvageReasons.push('removed trailing commas')
  }

  // 7. If JSON.parse still fails, attempt non-fatal syntax repair (NaN/Infinity, single quotes, unquoted keys)
  if (text.startsWith('{') && text.endsWith('}')) {
    try {
      JSON.parse(text)
    } catch {
      let repairedSyntax = text
        .replace(/:\s*(?:NaN|-?Infinity|undefined)\b/g, ': null')
        .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
        .replace(/([{,]\s*)([a-zA-Z_$][\w$-]*)\s*:/g, '$1"$2":')
        .replace(/,(\s*[}\]])/g, '$1')
      try {
        JSON.parse(repairedSyntax)
        text = repairedSyntax
        modified = true
        salvageReasons.push('repaired non-standard JSON syntax (unquoted keys/single quotes/literals)')
      } catch {
        // leave text as-is if still unparseable
      }
    }
  }

  return { text, modified, salvageReasons }
}

export function parseDirtyNumber(val: unknown, targetKey = ''): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return val
  if (typeof val !== 'string') return null
  const trimmed = val.replace(/<[^>]+>/g, '').trim()
  if (!trimmed) return null
  // Avoid treating ISO dates or long hex hashes as plain numbers
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed) || /^0x[0-9a-fA-F]{6,}$/.test(trimmed)) return null

  const normalizedUnderscores = trimmed.replace(/(?<=\d)_(?=\d)/g, '')
  const numMatch = /([-+]?\d[\d,]*(?:\.\d+)?(?:e[-+]?\d+)?)\s*([kKmMbB]\b|%)?/.exec(normalizedUnderscores)
  if (!numMatch || !numMatch[1]) return null

  const cleaned = numMatch[1].replace(/,/g, '')
  let parsed = Number(cleaned)
  if (!Number.isFinite(parsed)) return null

  const suffix = (numMatch[2] || '').toLowerCase()
  if (suffix === 'k') parsed *= 1_000
  else if (suffix === 'm') parsed *= 1_000_000
  else if (suffix === 'b') parsed *= 1_000_000_000
  else if (suffix === '%' && /bps\b|_bps$/i.test(targetKey)) {
    parsed = Math.round(parsed * 100)
  }

  return Number.isFinite(parsed) ? Number(parsed.toFixed(8)) : null
}
