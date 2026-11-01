import '@fontsource/inter-tight/latin-500.css'
import '@fontsource/inter-tight/latin-700.css'
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-600.css'
import { EXPLAIN, RAISE, REASON } from '../chance/rules.ts'
import { LIGHT_BLOCKED_NOTE, LIGHT_PICK_NOTE, LOW_CHANCE_WARNINGS, NEED_COUNTRY_NOTE, REASON_LINE, TRAVEL_RULE_VERIFY_NOTE, choiceResult, chooseTier, downgradeWarning, upgradeOfferText, type LowChancePlace, type RuleId } from '../chance/tier.ts'

const REASON_EN: Record<string, string> = {
  [REASON.police]: 'The notice says the hold is for the police or a court.',
  [REASON.sanctions]: 'The notice mentions sanctions.',
  [REASON.theft]: 'The notice links the funds to theft or a victim report.',
  [REASON.closure]: 'The notice says the account is finally closed.',
  [REASON.servStop]: 'The notice was classed as a case we decline, and the rules kept that.',
  [REASON.banned]: 'The address check returned a ban. That answer does not split a blacklist from sanctions.',
  [REASON.ordinary]: 'The notice reads as an ordinary source-of-funds check, with no stop phrase from the list.',
  [REASON.vague]: 'The notice has no familiar ordinary-check phrase and no stop phrase from the list.',
  [REASON.banOff]: 'Paid address checks are off, so the rules will not call this a high chance.',
  [REASON.banUnpaid]: 'The address check was not paid, so there is no result and this cannot be a high chance.',
  [REASON.banUnknown]: 'The address check did not answer, so this cannot be a high chance.',
  [REASON.banBase]: 'The USDT address list does not document Base, so we do not send a Base address there. That keeps this from a high chance.',
  [REASON.lookupFail]: 'The deposit could not be read on chain.',
  [REASON.hopFail]: 'The first hop could not be read.',
  [REASON.amountMismatch]: 'The amount does not match the transfer on chain.',
  [REASON.dateMismatch]: 'The date does not match the block date, compared as a UTC calendar day.',
  [REASON.amountUnknown]: 'The amount could not be checked on chain.',
  [REASON.dateUnknown]: 'The date could not be checked on chain.',
  [REASON.p2pNone]: 'P2P with no records is harder to support.',
  [REASON.p2pSome]: 'P2P with some records is not a high chance under these rules.',
  [REASON.prior]: 'An appeal was already refused.',
  [REASON.origin]: 'These rules treat only a purchase on another exchange as a high chance.',
  [REASON.exchangeIgnored]: 'Per-exchange hopeless templates are not in the rules. That list was not verified.',
  [REASON.pageLimit]: 'The first hop is up to ten incoming transfers from one page of history, not the whole history.',
  [RAISE.statement]: 'A bank or exchange statement that shows the purchase.',
  [RAISE.p2p]: 'P2P trade history and the messages with the counterparty.',
  [RAISE.video]: 'A video of the withdrawal from the source platform.',
  [RAISE.tax]: 'A tax return that shows the income.',
  [RAISE.explainGap]: 'An explanation of why the amount or the date does not match.',
  [RAISE.ban]: 'A sanctions and blacklist check on the sender and the first hop.',
  [RAISE.lawyer]: 'A police or court hold needs a lawyer. Our papers do not replace one.',
  [RAISE.noHelp]: 'Our papers do not raise the chance here. Do not pay anyone who promises a release.',
  [EXPLAIN.high]: 'This looks like an ordinary check. Those requests are usually answered with papers. We cannot guarantee the outcome.',
  [EXPLAIN.medium]: 'There is an indirect risk in the history of the funds. The chance depends on how fully you can show where they came from.',
  [EXPLAIN.low]: 'The chance is low. The reasons say what is in the way, and what could help.',
  [EXPLAIN.cannot_help]: 'Our papers will not help this notice. Do not pay anyone who promises a release.',
}

const PAY_ERROR: Record<string, string> = {
  not_mined: 'That transaction is not in a block yet. Leave this page open.',
  failed: 'The transaction failed on chain.',
  no_transfer: 'No matching USDC transfer was found in that transaction.',
  wrong_token: 'That transfer is not USDC on this network.',
  wrong_recipient: 'The USDC did not go to the address on this invoice.',
  wrong_amount: 'The amount does not match. Send the exact amount shown.',
  confirmations: 'The transfer needs more confirmations. Leave this page open.',
  rpc: 'The chain check did not answer. We will try again.',
  reused: 'That transfer was already used on another invoice.',
  payment_not_configured: 'This server has no USDC address, so it cannot open an invoice.',
  unpaid: 'Open a case only after the check is paid.',
  verdict: 'We do not open a file for this notice.',
  blocked_low_chance: 'A low chance stays closed until you confirm you still want the file.',
  LIGHT_NOT_ALLOWED: LIGHT_BLOCKED_NOTE,
  NO_CASE: 'We do not open a file for this notice.',
  blocked_need_country: NEED_COUNTRY_NOTE,
  HTX_UK_EU_CLIENT: "We can't take HTX-related cases for UK or EU residents, so we can't open a case for you. This is not legal advice.",
  tier: 'This check already has a file on the other price.',
  input: 'Check the form. Something required is missing or not in the right shape.',
  json: 'The server could not read that request.',
  amount: 'Could not reserve a unique amount. Try again.',
  tx: 'Paste the transaction hash.',
  not_found: 'That invoice is not on this server.',
  price: 'The price on the server could not be read.',
  method: 'Wrong request.',
}

const LEVEL: Record<string, string> = {
  high: 'High chance',
  medium: 'Medium chance',
  low: 'Low chance',
  cannot_help: 'We cannot take this',
}

type Order = {
  ok?: boolean
  code?: string
  error?: string
  orderId?: string
  status?: string
  paid?: boolean
  chain?: string
  token?: string
  recipient?: string
  amountAtomic?: string
  amountUsd?: string
  priceUsd?: string
  feeCreditMicro?: number
  result?: Result
}

type Result = {
  ok?: boolean
  verdict?: string
  reasons?: string[]
  whatWouldRaiseChance?: string[]
  explanation?: string
  disclaimer?: string
  depositExplorer?: string | null
  recommendation?: {
    tier: 'light' | 'full' | null
    reasonId: RuleId | 'NOT_ELIGIBLE' | 'HTX_UK_EU_CLIENT'
    reason: string
    missing: string
    priceUsd: number
    note: string
    status?: 'ok' | 'blocked_low_chance' | 'blocked_need_country' | 'refused'
    canOpenCase?: boolean
    lowChance?: { required: boolean; warnings: Array<{ place: LowChancePlace; text: string }> }
    lightAllowed?: boolean
    lightBlockedNote?: string | null
    flags?: string[]
  } | null
}

type CaseInvoice = {
  ok?: boolean
  code?: string
  error?: string
  caseId?: string
  orderId?: string
  tier?: string
  status?: string
  paid?: boolean
  priceUsd?: string
  feeUsd?: string
  netUsd?: string
  netMicro?: number
  chain?: string | null
  token?: string | null
  recipient?: string
  amountAtomic?: string | null
  amountUsd?: string | null
  verdict?: string | null
  coverNote?: string | null
  lowConfirmedAt?: number | null
}

const ORDER_KEY = 'thaw.order'
const CASE_KEY = 'thaw.case'
const PENDING_KEY = 'thaw.pendingCase'
const TX_KEY = 'thaw.tx'
const CASE_TX_KEY = 'thaw.caseTx'

let pollTimer = 0
let routed = false

const clientId = document.querySelector<HTMLInputElement>('#clientId')
if (clientId) clientId.value = browserId()

document.querySelector('#check-form')?.addEventListener('submit', (event) => {
  event.preventDefault()
  void sendCheck()
})

document.querySelector('#priorExchangeRejection')?.addEventListener('change', (event) => {
  const on = (event.currentTarget as HTMLInputElement).checked
  document.querySelector('#rounds-field')?.toggleAttribute('hidden', !on)
})

window.addEventListener('hashchange', route)
route()

const COUNTRIES: Array<[string, string]> = [
  ['AT', 'Austria'], ['BE', 'Belgium'], ['BG', 'Bulgaria'], ['HR', 'Croatia'], ['CY', 'Cyprus'],
  ['CZ', 'Czechia'], ['DK', 'Denmark'], ['EE', 'Estonia'], ['FI', 'Finland'], ['FR', 'France'],
  ['DE', 'Germany'], ['GR', 'Greece'], ['HU', 'Hungary'], ['IE', 'Ireland'], ['IT', 'Italy'],
  ['LV', 'Latvia'], ['LT', 'Lithuania'], ['LU', 'Luxembourg'], ['MT', 'Malta'], ['NL', 'Netherlands'],
  ['PL', 'Poland'], ['PT', 'Portugal'], ['RO', 'Romania'], ['SK', 'Slovakia'], ['SI', 'Slovenia'],
  ['ES', 'Spain'], ['SE', 'Sweden'], ['GB', 'United Kingdom'], ['NO', 'Norway'], ['CH', 'Switzerland'],
  ['IS', 'Iceland'], ['LI', 'Liechtenstein'], ['TR', 'Turkey'], ['US', 'United States'], ['CA', 'Canada'],
  ['AU', 'Australia'], ['AE', 'United Arab Emirates'], ['SG', 'Singapore'], ['JP', 'Japan'], ['KR', 'South Korea'],
  ['BR', 'Brazil'], ['IN', 'India'], ['UA', 'Ukraine'], ['GE', 'Georgia'], ['KZ', 'Kazakhstan'],
]

function fillCountries(): void {
  const select = document.querySelector<HTMLSelectElement>('#clientCountry')
  if (!select || select.options.length > 1) return
  const blank = document.createElement('option')
  blank.value = ''
  blank.textContent = 'Select a country'
  select.append(blank)
  for (const [code, name] of COUNTRIES) {
    const option = document.createElement('option')
    option.value = code
    option.textContent = name
    select.append(option)
  }
}

function showPlace(): void {
  const exchange = document.querySelector<HTMLSelectElement>('#exchange')?.value
  const linked = document.querySelector<HTMLInputElement>('#htxLinked')?.checked === true
  const needed = exchange === 'htx' || linked
  document.querySelector('#place-fields')?.toggleAttribute('hidden', !needed)
  const country = document.querySelector<HTMLSelectElement>('#clientCountry')
  if (country) country.required = needed
}

fillCountries()
document.querySelector('#exchange')?.addEventListener('change', showPlace)
document.querySelector('#htxLinked')?.addEventListener('change', showPlace)
showPlace()

function stopPoll(): void {
  window.clearInterval(pollTimer)
  pollTimer = 0
}

function route(): void {
  stopPoll()
  const id = location.hash.replace(/^#/, '') || 'top'
  const first = !routed
  routed = true
  if (id === 'top' || id === 'prices' || id === 'questions' || id === 'how' || id === 'path') {
    show('home', !first && visibleView() !== 'home')
    if (id !== 'top') document.getElementById(id)?.scrollIntoView()
    return
  }
  const views = ['check', 'invoice', 'result', 'case', 'terms', 'privacy']
  if (views.includes(id)) {
    show(id, !first)
    if (id === 'invoice') void paintInvoice()
    if (id === 'result') void paintResult()
    if (id === 'case') void paintCase()
    return
  }
  show('home', !first && visibleView() !== 'home')
}

function visibleView(): string | undefined {
  return document.querySelector<HTMLElement>('[data-view]:not([hidden])')?.dataset.view
}

function prefersMotion(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function show(name: string, animate: boolean): void {
  const apply = () => {
    document.querySelectorAll<HTMLElement>('[data-view]').forEach((view) => {
      view.toggleAttribute('hidden', view.dataset.view !== name)
    })
    if (name !== 'home') window.scrollTo(0, 0)
  }
  if (animate && prefersMotion() && typeof document.startViewTransition === 'function') document.startViewTransition(apply)
  else apply()
}

async function sendCheck(): Promise<void> {
  const form = document.querySelector<HTMLFormElement>('#check-form')
  const submit = document.querySelector<HTMLButtonElement>('#submit')
  const error = document.querySelector('#form-error')
  if (!form || !submit || !error) return
  submit.disabled = true
  error.textContent = ''
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload(form)),
    })
    const body = (await response.json()) as Order
    if (body.orderId) {
      sessionStorage.setItem(ORDER_KEY, body.orderId)
      sessionStorage.removeItem(TX_KEY)
      location.hash = 'invoice'
      return
    }
    error.textContent = say(body.code, body.error)
  } catch {
    error.textContent = 'The form did not send. Try again.'
  } finally {
    submit.disabled = false
  }
}

function payload(form: HTMLFormElement): Record<string, unknown> {
  const data = new FormData(form)
  const out: Record<string, unknown> = {}
  const lists = new Map<string, string[]>()
  data.forEach((value, key) => {
    if (typeof value !== 'string' || value === '') return
    if (key === 'fundsSources' || key === 'evidence') {
      const list = lists.get(key) ?? []
      list.push(value)
      lists.set(key, list)
      return
    }
    if (key === 'priorExchangeRejection' || key === 'htxLinked') out[key] = true
    else out[key] = value
  })
  for (const [key, list] of lists) out[key] = list
  if (!out.fundsSources) out.fundsSources = []
  if (!out.evidence) out.evidence = []
  if (!out.clientCountry) delete out.clientCountry
  if (!out.priorExchangeRejection) out.priorExchangeRejection = false
  if (!out.htxLinked) out.htxLinked = false
  if (!out.priorExchangeRejection) delete out.priorRoundsCount
  return out
}

async function paintInvoice(): Promise<void> {
  stopPoll()
  const root = document.querySelector('#invoice-root')
  const id = sessionStorage.getItem(ORDER_KEY)
  if (!root) return
  root.replaceChildren()
  if (!id) {
    root.append(heading('No invoice yet'), paragraph('Start with the chance check. The invoice is created when the form is accepted.'))
    root.append(link('Check the chance', '#check'))
    return
  }
  const order = await getJson<Order>(`/api/check-orders/${id}`)
  if (!order?.orderId) {
    root.append(heading('Invoice not found'), paragraph(say(order?.code, order?.error)))
    return
  }
  if (order.paid && order.result) {
    location.hash = 'result'
    return
  }
  root.append(invoiceBlock({
    title: 'Pay the check',
    lead: 'Send exactly this amount of USDC on Base. The check fee is credited if you open a file on this same check.',
    amount: order.amountUsd ? `${order.amountUsd} USDC` : '',
    rows: [
      ['Network', order.chain ?? 'base'],
      ['USDC contract', order.token ?? ''],
      ['Send to', order.recipient ?? ''],
      ['Exact amount', order.amountUsd ? `${order.amountUsd} USDC` : ''],
      ['Atomic units', order.amountAtomic ?? ''],
      ['Invoice', order.orderId ?? ''],
    ],
    steps: [
      'In your own wallet, switch to Base.',
      'Send USDC, not ETH, to the address above.',
      'Send exactly the amount shown.',
      'Paste the transaction hash below. We read the transfer on chain. We never ask for a key or a seed phrase.',
    ],
    hashKey: TX_KEY,
    onSubmit: (tx) => confirm(`/api/check-orders/${id}/confirm`, tx, TX_KEY),
  }))
  pollTimer = window.setInterval(() => void refreshOrder(id), 4000)
}

async function refreshOrder(id: string): Promise<void> {
  const tx = sessionStorage.getItem(TX_KEY)
  if (tx) await confirm(`/api/check-orders/${id}/confirm`, tx, TX_KEY, true)
  const order = await getJson<Order>(`/api/check-orders/${id}`)
  const status = document.querySelector('#pay-status')
  if (!status || !order) return
  if (order.paid) {
    setStatus('Paid. Opening the result.', 'done')
    location.hash = 'result'
    return
  }
  if (!tx) setStatus('Waiting for the transfer.', 'wait')
}

async function paintResult(): Promise<void> {
  const root = document.querySelector('#result-root')
  const id = sessionStorage.getItem(ORDER_KEY)
  if (!root) return
  root.replaceChildren()
  if (!id) {
    root.append(heading('No result yet'), paragraph('Run the check first.'))
    return
  }
  const order = await getJson<Order>(`/api/check-orders/${id}`)
  const result = order?.result
  if (!order?.paid || !result?.verdict) {
    root.append(heading('The check is not paid'), paragraph('The result appears after the USDC transfer is verified.'))
    root.append(link('Back to the invoice', '#invoice'))
    return
  }
  const level = LEVEL[result.verdict] ?? result.verdict
  const title = heading(level)
  title.classList.add('verdict-level')
  root.append(title)
  root.append(paragraph(english(result.explanation) || 'The level comes from the rules on the notice and the public transfer.'))
  root.append(subhead('Reasons'))
  root.append(list(result.reasons ?? []))
  const raises = result.whatWouldRaiseChance ?? []
  if (raises.length) {
    root.append(subhead('What would raise the chance'))
    root.append(list(raises))
  }
  if (result.depositExplorer) {
    const explorer = document.createElement('p')
    const anchor = document.createElement('a')
    anchor.href = result.depositExplorer
    anchor.target = '_blank'
    anchor.rel = 'noreferrer'
    anchor.textContent = 'Open this deposit on the explorer'
    explorer.append(anchor)
    root.append(explorer)
  }
  const gate = result.recommendation
  const needsCountry = gate?.flags?.includes('HTX_COUNTRY_REQUIRED') === true
  const refused = gate?.status === 'refused'
  root.append(subhead('Next step'))
  root.append(paragraph(nextStep(result.verdict, gate)))
  if (!refused && !needsCountry) {
    root.append(paragraph('This is document preparation, not legal advice. We do not promise that the withdrawal will be released. Only the exchange decides. We decline sanctions cases.'))
  }
  if (gate?.flags?.includes('TRAVEL_RULE_VERIFY_FIRST')) root.append(noteBox(TRAVEL_RULE_VERIFY_NOTE))
  if (gate?.tier && !refused && !needsCountry && result.verdict !== 'cannot_help') {
    root.append(recommendationBlock(gate))
  }
  stamp(root)
}

function noteBox(text: string): HTMLElement {
  const note = document.createElement('p')
  note.className = 'warn-box'
  note.textContent = text
  return note
}

function recommendationBlock(rec: NonNullable<Result['recommendation']>): HTMLElement {
  if (rec.tier !== 'light' && rec.tier !== 'full') return document.createElement('section')
  const recommended = rec.tier
  const low = rec.lowChance?.required === true
  const box = document.createElement('section')
  box.className = 'recommend'
  if (low) {
    const chance = document.createElement('p')
    chance.className = 'warn-box'
    chance.textContent = lowText(rec, 'chance_result')
    box.append(chance)
  }
  const title = document.createElement('h2')
  title.textContent = rec.tier === 'full' ? 'We recommend the Full file' : 'We recommend the Light file'
  const price = document.createElement('p')
  price.className = 'sum'
  price.textContent = rec.tier === 'full' ? '$79' : '$49'
  const why = document.createElement('p')
  why.textContent = rec.reason
  const note = document.createElement('p')
  note.textContent = rec.note
  box.append(title, price, why, note)

  const offer = document.createElement('div')
  const picks = document.createElement('div')
  picks.className = 'copy-row'
  const light = tierPick('light', 'Light file, $49', rec.tier === 'light')
  const full = tierPick('full', 'Full file, $79', rec.tier === 'full')
  picks.append(light, full)

  const extra = document.createElement('div')
  const blocked = document.createElement('p')
  blocked.className = 'warn-box'
  blocked.hidden = true
  const warning = document.createElement('p')
  warning.className = 'warn-box'
  warning.hidden = true
  const confirm = document.createElement('label')
  confirm.className = 'field check'
  confirm.hidden = true
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  const confirmText = document.createElement('span')
  confirmText.textContent = 'I understand the Light file leaves that out, and I still want it.'
  confirm.append(checkbox, confirmText)
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'action cta'
  const stop = document.createElement('button')
  stop.type = 'button'
  stop.className = 'ghost'
  stop.textContent = 'No, stop here'
  stop.hidden = !low
  const stopped = document.createElement('p')
  stopped.hidden = true
  stopped.textContent = 'We will not open a file unless you choose to continue.'
  let chosen: 'light' | 'full' = recommended
  let halted = false
  const refresh = () => {
    const choice = chooseTier(choiceResult(recommended, rec.lightAllowed !== false, rec.lightBlockedNote ?? null), chosen)
    if (!choice.ok) chosen = recommended
    const applied = chooseTier(choiceResult(recommended, rec.lightAllowed !== false, rec.lightBlockedNote ?? null), chosen)
    offer.hidden = halted
    stopped.hidden = !halted
    light.disabled = rec.lightAllowed === false
    light.classList.toggle('on', chosen === 'light')
    full.classList.toggle('on', chosen === 'full')
    blocked.hidden = rec.lightAllowed !== false
    blocked.textContent = rec.lightBlockedNote ?? ''
    warning.hidden = !applied.needsConfirmation && applied.override !== 'light_to_full'
    confirm.hidden = !applied.needsConfirmation
    if (applied.needsConfirmation && rec.reasonId in REASON_LINE) warning.textContent = downgradeWarning(rec.reasonId as RuleId)
    if (applied.override === 'light_to_full') warning.textContent = LIGHT_PICK_NOTE
    open.textContent = low ? 'Yes, continue' : chosen === 'full' ? 'Open the Full file, $79' : 'Open the Light file, $49'
    open.disabled = applied.needsConfirmation && !checkbox.checked
  }
  light.addEventListener('click', () => {
    const choice = chooseTier(choiceResult(recommended, rec.lightAllowed !== false, rec.lightBlockedNote ?? null), 'light')
    if (choice.ok) chosen = 'light'
    refresh()
  })
  full.addEventListener('click', () => {
    const choice = chooseTier(choiceResult(recommended, rec.lightAllowed !== false, rec.lightBlockedNote ?? null), 'full')
    if (choice.ok) chosen = 'full'
    refresh()
  })
  checkbox.addEventListener('change', refresh)
  open.addEventListener('click', () => {
    if (low) {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify({ orderId: sessionStorage.getItem(ORDER_KEY), tier: chosen }))
      sessionStorage.removeItem(CASE_KEY)
      location.hash = 'case'
      return
    }
    void openCase(chosen, open, false)
  })
  stop.addEventListener('click', () => { halted = true; refresh() })
  extra.append(blocked, warning, confirm, open, stop)
  offer.append(picks, extra)
  box.append(offer, stopped)
  refresh()
  return box
}

function lowText(rec: NonNullable<Result['recommendation']>, place: LowChancePlace): string {
  return rec.lowChance?.warnings.find((item) => item.place === place)?.text
    ?? LOW_CHANCE_WARNINGS.find((item) => item.place === place)?.text
    ?? ''
}

function tierPick(tier: 'light' | 'full', label: string, on: boolean): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = on ? 'tier on' : 'tier'
  button.dataset.tier = tier
  button.textContent = label
  return button
}

function nextStep(verdict: string, gate?: Result['recommendation']): string {
  if (gate?.flags?.includes('HTX_COUNTRY_REQUIRED')) return gate.reason || NEED_COUNTRY_NOTE
  if (gate?.status === 'refused') return gate.reason
  if (verdict === 'high' || verdict === 'medium') {
    return 'You can open a light file at $49 or a full file at $79. The check you paid is subtracted. The remainder is a second USDC invoice, and the file stays unpaid until that transfer is verified.'
  }
  if (verdict === 'low') return 'A low chance can still open a Full file, only after you read the warning and confirm. We do not promise the exchange will release the withdrawal.'
  return 'We will not prepare papers for this notice.'
}

async function openCase(tier: 'light' | 'full', button: HTMLButtonElement, confirmedLow: boolean): Promise<void> {
  const id = sessionStorage.getItem(ORDER_KEY)
  if (!id) return
  button.disabled = true
  const response = await fetch('/api/cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderId: id, tier, userConfirmedLowChance: confirmedLow }),
  })
  const body = (await response.json()) as CaseInvoice
  button.disabled = false
  if (!body.caseId) {
    const root = document.querySelector(location.hash === '#case' ? '#case-root' : '#result-root')
    const note = document.createElement('p')
    note.className = 'warn'
    note.textContent = say(body.code, body.error)
    root?.append(note)
    return
  }
  sessionStorage.setItem(CASE_KEY, body.caseId)
  sessionStorage.removeItem(CASE_TX_KEY)
  sessionStorage.removeItem(PENDING_KEY)
  if (location.hash === '#case') void paintCase()
  else location.hash = 'case'
}

async function paintCase(): Promise<void> {
  stopPoll()
  const root = document.querySelector('#case-root')
  const id = sessionStorage.getItem(CASE_KEY)
  if (!root) return
  root.replaceChildren()
  if (!id) {
    const pending = readPending()
    if (pending) {
      await paintLowGate(root, pending)
      return
    }
    root.append(heading('No file invoice'), paragraph('Open a file from the chance result.'))
    return
  }
  const row = await getJson<CaseInvoice>(`/api/cases/${id}`)
  if (!row?.caseId) {
    root.append(heading('File not found'), paragraph(say(row?.code, row?.error)))
    return
  }
  if (row.paid && !row.amountAtomic) {
    root.append(heading('The file is paid'), paragraph('The check fee covered the whole price, so there is no second transfer.'))
    root.append(paragraph('Preparing the papers in the browser is not on this page yet.'))
    appendCaseNotes(root, row)
    return
  }
  if (row.paid) {
    root.append(heading('The remainder is paid'), paragraph(`${tierName(row.tier)} is paid. The check credit was ${row.feeUsd ?? ''} USD of the ${row.priceUsd ?? ''} USD price.`))
    root.append(paragraph('Preparing the papers in the browser is not on this page yet. Payment does not mean the withdrawal will be released.'))
    appendCaseNotes(root, row)
    return
  }
  root.append(invoiceBlock({
    title: 'Pay the remainder',
    lead: `${tierName(row.tier)} is ${row.priceUsd} USD. The check credit is ${row.feeUsd} USD. Send exactly the amount shown.`,
    amount: row.amountUsd ? `${row.amountUsd} USDC` : '',
    rows: [
      ['Network', row.chain ?? 'base'],
      ['USDC contract', row.token ?? ''],
      ['Send to', row.recipient ?? ''],
      ['Price', row.priceUsd ? `${row.priceUsd} USD` : ''],
      ['Check already paid', row.feeUsd ? `${row.feeUsd} USD` : ''],
      ['Price after the check credit', row.netUsd ? `${row.netUsd} USD` : ''],
      ['Exact amount', row.amountUsd ? `${row.amountUsd} USDC` : ''],
      ['Atomic units', row.amountAtomic ?? ''],
      ['File', row.caseId],
    ],
    steps: [
      'Send USDC on Base from your own wallet.',
      'Send exactly the amount shown. The check credit is already subtracted.',
      'Paste the new transaction hash. The hash that paid the check cannot pay this invoice.',
      'The file is marked paid only after the chain check passes.',
    ],
    hashKey: CASE_TX_KEY,
    onSubmit: (tx) => confirm(`/api/cases/${id}/confirm`, tx, CASE_TX_KEY),
  }))
  appendCaseNotes(root, row)
  pollTimer = window.setInterval(() => void refreshCase(id), 4000)
}

function appendCaseNotes(root: Element, row: CaseInvoice): void {
  if (row.coverNote) {
    const note = document.createElement('p')
    note.className = 'warn-box'
    note.textContent = row.coverNote
    root.append(note)
  }
  if (row.tier === 'light') root.append(paragraph(upgradeOfferText()))
}

function readPending(): { orderId: string; tier: 'light' | 'full' } | null {
  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as { orderId?: unknown; tier?: unknown }
    if (typeof parsed.orderId !== 'string' || (parsed.tier !== 'light' && parsed.tier !== 'full')) return null
    if (parsed.orderId !== sessionStorage.getItem(ORDER_KEY)) return null
    return { orderId: parsed.orderId, tier: parsed.tier }
  } catch {
    return null
  }
}

async function paintLowGate(root: Element, pending: { orderId: string; tier: 'light' | 'full' }): Promise<void> {
  const order = await getJson<Order>(`/api/check-orders/${pending.orderId}`)
  const warnings = order?.result?.recommendation?.lowChance?.warnings ?? LOW_CHANCE_WARNINGS
  const checkout = warnings.find((item) => item.place === 'checkout')?.text ?? ''
  const boxText = warnings.find((item) => item.place === 'checkout_checkbox')?.text ?? ''
  root.append(heading('Confirm before the file opens'))
  root.append(paragraph(pending.tier === 'full' ? 'Full file, $79. The check you already paid is subtracted. The file stays unpaid until the remainder is verified.' : 'Light file, $49. The check you already paid is subtracted. The file stays unpaid until the remainder is verified.'))
  const warning = document.createElement('p')
  warning.className = 'warn-box'
  warning.textContent = checkout
  const confirm = document.createElement('label')
  confirm.className = 'field check'
  const checkbox = document.createElement('input')
  checkbox.type = 'checkbox'
  const text = document.createElement('span')
  text.textContent = boxText
  confirm.append(checkbox, text)
  const open = document.createElement('button')
  open.type = 'button'
  open.className = 'action cta'
  open.textContent = 'Open the file'
  open.disabled = true
  checkbox.addEventListener('change', () => { open.disabled = !checkbox.checked })
  open.addEventListener('click', () => {
    if (!checkbox.checked) return
    void openCase(pending.tier, open, true)
  })
  root.append(warning, confirm, open)
  if (pending.tier === 'light') root.append(paragraph(upgradeOfferText()))
  stamp(root)
}

async function refreshCase(id: string): Promise<void> {
  const tx = sessionStorage.getItem(CASE_TX_KEY)
  if (tx) await confirm(`/api/cases/${id}/confirm`, tx, CASE_TX_KEY, true)
  const row = await getJson<CaseInvoice>(`/api/cases/${id}`)
  const title = document.querySelector('#case-root h1')?.textContent ?? ''
  if (row?.paid && !/paid/i.test(title)) void paintCase()
}

function invoiceBlock(opts: {
  title: string
  lead: string
  amount: string
  rows: Array<[string, string]>
  steps: string[]
  hashKey: string
  onSubmit: (tx: string) => Promise<void>
}): HTMLElement {
  const wrap = document.createElement('div')
  wrap.className = 'invoice'
  const left = document.createElement('div')
  left.append(heading(opts.title), paragraph(opts.lead))
  const amount = document.createElement('p')
  amount.className = 'amount arrive'
  amount.textContent = opts.amount
  left.append(amount)
  const steps = document.createElement('ol')
  steps.className = 'steps'
  opts.steps.forEach((step, index) => {
    const li = document.createElement('li')
    li.className = 'arrive'
    li.style.setProperty('--i', String(index + 1))
    li.textContent = step
    steps.append(li)
  })
  left.append(steps)
  const right = document.createElement('div')
  const facts = document.createElement('dl')
  facts.className = 'meta'
  for (const [name, value] of opts.rows) {
    const row = document.createElement('div')
    const dt = document.createElement('dt')
    dt.textContent = name
    const dd = document.createElement('dd')
    dd.textContent = value
    row.append(dt, dd)
    facts.append(row)
  }
  const copies = document.createElement('div')
  copies.className = 'copy-row'
  const amountRow = opts.rows.find(([name]) => name === 'Exact amount')
  const toRow = opts.rows.find(([name]) => name === 'Send to')
  if (amountRow) copies.append(copyButton('Copy the amount', amountRow[1].replace(' USDC', '')))
  if (toRow) copies.append(copyButton('Copy the address', toRow[1]))
  const form = document.createElement('form')
  form.className = 'stack'
  const label = document.createElement('label')
  label.htmlFor = 'tx-hash'
  label.textContent = 'Transaction hash'
  const input = document.createElement('input')
  input.id = 'tx-hash'
  input.required = true
  input.autocomplete = 'off'
  input.spellcheck = false
  input.value = sessionStorage.getItem(opts.hashKey) ?? ''
  const button = document.createElement('button')
  button.className = 'action cta'
  button.type = 'submit'
  button.textContent = 'I sent it'
  const status = document.createElement('p')
  status.id = 'pay-status'
  status.className = 'status is-wait'
  const dot = document.createElement('span')
  dot.className = 'live-dot'
  dot.setAttribute('aria-hidden', 'true')
  const statusText = document.createElement('span')
  statusText.className = 'status-text'
  statusText.textContent = input.value ? 'Checking the transaction.' : 'Waiting for the transfer.'
  status.append(dot, statusText)
  form.append(label, input, button)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const tx = input.value.trim()
    if (!tx) return
    sessionStorage.setItem(opts.hashKey, tx)
    void opts.onSubmit(tx)
  })
  right.append(facts, copies, form, status)
  wrap.append(left, right)
  return wrap
}

async function confirm(url: string, tx: string, key: string, quiet = false): Promise<void> {
  sessionStorage.setItem(key, tx)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ txHash: tx }),
  })
  const body = (await response.json()) as { code?: string; error?: string; paid?: boolean; ok?: boolean; verdict?: string }
  if (response.ok && (body.paid || body.verdict)) {
    setStatus('Paid.', 'done')
    if (url.includes('/cases/')) {
      if (location.hash === '#case') void paintCase()
      else location.hash = 'case'
    } else if (location.hash !== '#result') location.hash = 'result'
    return
  }
  const waiting = body.code === 'not_mined' || body.code === 'confirmations' || body.code === 'rpc'
  if (!quiet || waiting) setStatus(say(body.code, body.error), waiting ? 'wait' : 'bad')
}

function copyButton(label: string, value: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'action ghost'
  button.textContent = label
  button.addEventListener('click', () => {
    void navigator.clipboard?.writeText(value).then(() => {
      button.textContent = 'Copied'
    }).catch(() => {
      button.textContent = 'Select the figure and copy it'
    })
  })
  return button
}

function heading(text: string): HTMLHeadingElement {
  const h = document.createElement('h1')
  h.textContent = text
  return h
}

function subhead(text: string): HTMLHeadingElement {
  const h = document.createElement('h2')
  h.textContent = text
  return h
}

function paragraph(text: string): HTMLParagraphElement {
  const p = document.createElement('p')
  p.textContent = text
  return p
}

function list(items: string[]): HTMLElement {
  const ul = document.createElement('ul')
  ul.className = 'reasons'
  for (const item of items) {
    const li = document.createElement('li')
    li.textContent = english(item)
    ul.append(li)
  }
  return ul
}

function link(text: string, href: string): HTMLAnchorElement {
  const a = document.createElement('a')
  a.className = 'action cta'
  a.href = href
  a.textContent = text
  return a
}

function english(text: string | undefined): string {
  if (!text) return ''
  return REASON_EN[text] ?? text
}

function say(code: string | undefined, fallback: string | undefined): string {
  if (code && PAY_ERROR[code]) return PAY_ERROR[code]
  return fallback || 'That did not work.'
}

function tierName(tier: string | undefined): string {
  return tier === 'full' ? 'The full file' : 'The light file'
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    return (await response.json()) as T
  } catch {
    return null
  }
}

function browserId(): string {
  const key = 'thaw.client'
  const saved = localStorage.getItem(key)
  if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved
  const next = crypto.randomUUID().replace(/-/g, '')
  localStorage.setItem(key, next)
  return next
}

function stamp(root: Element): void {
  Array.from(root.children).forEach((el, index) => {
    if (!(el instanceof HTMLElement) || el.classList.contains('verdict-level')) return
    el.classList.add('arrive')
    el.style.setProperty('--i', String(index))
  })
}

function setStatus(text: string, mode: 'wait' | 'bad' | 'done'): void {
  const status = document.querySelector('#pay-status')
  if (!status) return
  const label = status.querySelector('.status-text')
  if (label) label.textContent = text
  status.classList.toggle('is-wait', mode === 'wait')
  status.classList.toggle('is-bad', mode === 'bad')
  status.classList.toggle('is-done', mode === 'done')
}

function rise(): void {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-rise]'))
  const mark = (el: HTMLElement) => {
    const siblings = el.parentElement ? Array.from(el.parentElement.querySelectorAll<HTMLElement>(':scope > [data-rise]')) : [el]
    el.style.setProperty('--i', String(Math.max(0, siblings.indexOf(el))))
    el.classList.add('go')
  }
  if (!('IntersectionObserver' in window)) {
    nodes.forEach(mark)
    return
  }
  const seen = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      mark(entry.target as HTMLElement)
      seen.unobserve(entry.target)
    }
  }, { threshold: 0.2 })
  nodes.forEach((node) => seen.observe(node))
}

rise()
startDemo()

function startDemo(): void {
  const root = document.querySelector('#demo')
  if (!root) return
  const sheets = Array.from(root.querySelectorAll<HTMLElement>('.sheet'))
  const marks = Array.from(root.querySelectorAll<HTMLElement>('.sheet-mark'))
  if (!sheets.length || !prefersMotion()) return
  let index = 0
  let timer = 0
  const show = (next: number) => {
    sheets.forEach((sheet, i) => sheet.classList.toggle('on', i === next))
    marks.forEach((mark, i) => mark.classList.toggle('on', i === next))
  }
  const advance = () => {
    index = (index + 1) % sheets.length
    show(index)
    timer = window.setTimeout(advance, 3400)
  }
  show(0)
  timer = window.setTimeout(advance, 3400)
  window.addEventListener('pagehide', () => window.clearTimeout(timer))
}
