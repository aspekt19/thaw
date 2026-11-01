import type { Category } from './constants.ts'

/**
 * Phrases named in the plan (English examples and the one quoted Russian
 * sentence, plus the Russian word «санкции» used there as the category).
 * Other exchange wording is not in this list. TODO: a checked phrase list
 * per exchange was marked unverified in the plan, so it is not included.
 */

type Rule = { category: Category; test: (text: string) => boolean }

function has(needle: string): (text: string) => boolean {
  return (text) => text.includes(needle)
}

function word(needle: string): (text: string) => boolean {
  const re = new RegExp(`(?:^|[^a-z0-9])${needle}(?:[^a-z0-9]|$)`, 'i')
  return (text) => re.test(text)
}

const RULES: Rule[] = [
  { category: 'law_enforcement', test: has('law enforcement') },
  { category: 'law_enforcement', test: has('court order') },
  { category: 'law_enforcement', test: word('seizure') },
  { category: 'law_enforcement', test: has('lea request') },
  { category: 'law_enforcement', test: has('по запросу правоохранительных органов') },
  { category: 'sanctions', test: word('ofac') },
  { category: 'sanctions', test: word('sanctioned') },
  { category: 'sanctions', test: has('санкции') },
  { category: 'theft', test: has('reported as stolen') },
  { category: 'theft', test: has('fraud victim report') },
  { category: 'final_closure', test: has('permanently closed') },
  { category: 'final_closure', test: word('offboarded') },
  { category: 'final_closure', test: has('final decision') },
  { category: 'source_of_funds', test: has('source of funds') },
  { category: 'additional_verification', test: has('additional verification') },
  { category: 'edd', test: word('edd') },
  { category: 'travel_rule', test: has('travel rule') },
  { category: 't_plus_n', test: has('t+n') },
  { category: 'risk_control', test: has('risk control') },
]

export function categoriesInNotice(notice: string): Category[] {
  const text = notice.toLowerCase()
  const found = new Set<Category>()
  for (const rule of RULES) {
    if (rule.test(text)) found.add(rule.category)
  }
  return [...found]
}
