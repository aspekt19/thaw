import '@fontsource/geist-sans/latin-400.css'
import '@fontsource/geist-sans/latin-500.css'
import '@fontsource/geist-sans/latin-600.css'
import '@fontsource/geist-sans/latin-700.css'
import '@fontsource/geist-mono/latin-500.css'
import { EXPLAIN, RAISE, REASON } from '../chance/rules.ts'
import { LIGHT_PICK_NOTE, downgradeWarning, type RuleId } from '../chance/tier.ts'

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
  wrong_amount: 'The amount does not match. Send the exact figure, including the fraction.',
  confirmations: 'The transfer needs more confirmations. Leave this page open.',
  rpc: 'The chain check did not answer. We will try again.',
  reused: 'That transfer was already used on another invoice.',
  payment_not_configured: 'This server has no USDC address, so it cannot open an invoice.',
  unpaid: 'Open a case only after the check is paid.',
  verdict: 'A file opens only when the chance is high or medium.',
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
    tier: 'light' | 'full'
    reasonId: RuleId
    reason: string
    missing: string
    priceUsd: number
    note: string
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
}

const ORDER_KEY = 'thaw.order'
const CASE_KEY = 'thaw.case'
const TX_KEY = 'thaw.tx'
const CASE_TX_KEY = 'thaw.caseTx'

let pollTimer = 0
let routed = false

const clientId = document.querySelector<HTMLInputElement>('#clientId')
if (clientId) clientId.value = browserId()

document.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((button) => {
  button.addEventListener('click', () => {
    const tier = button.dataset.pick === 'full' ? 'full' : 'light'
    setTier(tier)
    document.getElementById('remainder')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  })
})

document.querySelectorAll<HTMLButtonElement>('#remainder .tier').forEach((button) => {
  button.addEventListener('click', () => setTier(button.dataset.tier === 'full' ? 'full' : 'light'))
})

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

function setTier(tier: 'light' | 'full'): void {
  document.querySelectorAll<HTMLButtonElement>('#remainder .tier').forEach((button) => {
    button.classList.toggle('on', button.dataset.tier === tier)
  })
  const price = tier === 'full' ? 79 : 49
  const remainder = price - 1
  const line = document.querySelector('#remainder-line')
  if (line) line.textContent = `$${price} file, minus the $1 check, leaves $${remainder}.00 before the unique fraction.`
  nudge(line)
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
    if (key === 'priorExchangeRejection') out[key] = true
    else out[key] = value
  })
  for (const [key, list] of lists) out[key] = list
  if (!out.fundsSources) out.fundsSources = []
  if (!out.evidence) out.evidence = []
  if (!out.priorExchangeRejection) out.priorExchangeRejection = false
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
    lead: 'Send this exact amount of USDC on Base. A round $1 will not match. The check fee is credited if you open a file on this same check.',
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
      'Use the exact amount, including the fraction after the dollar.',
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
  root.append(subhead('Next step'))
  root.append(paragraph(nextStep(result.verdict)))
  root.append(paragraph('This is document preparation, not legal advice. We do not promise that the withdrawal will be released. Only the exchange decides. We decline sanctions cases.'))
  if ((result.verdict === 'high' || result.verdict === 'medium') && result.recommendation?.tier) {
    root.append(recommendationBlock(result.recommendation))
  }
  stamp(root)
}

function recommendationBlock(rec: NonNullable<Result['recommendation']>): HTMLElement {
  const box = document.createElement('section')
  box.className = 'recommend'
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

  const picks = document.createElement('div')
  picks.className = 'copy-row'
  const light = tierPick('light', 'Light file, $49', rec.tier === 'light')
  const full = tierPick('full', 'Full file, $79', rec.tier === 'full')
  picks.append(light, full)
  box.append(picks)

  const extra = document.createElement('div')
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
  open.textContent = rec.tier === 'full' ? 'Open the Full file, $79' : 'Open the Light file, $49'
  let chosen: 'light' | 'full' = rec.tier
  const refresh = () => {
    light.classList.toggle('on', chosen === 'light')
    full.classList.toggle('on', chosen === 'full')
    const down = rec.tier === 'full' && chosen === 'light'
    const up = rec.tier === 'light' && chosen === 'full'
    warning.hidden = !down && !up
    confirm.hidden = !down
    if (down) warning.textContent = downgradeWarning(rec.reasonId)
    if (up) warning.textContent = LIGHT_PICK_NOTE
    open.textContent = chosen === 'full' ? 'Open the Full file, $79' : 'Open the Light file, $49'
    open.disabled = down && !checkbox.checked
  }
  light.addEventListener('click', () => { chosen = 'light'; refresh() })
  full.addEventListener('click', () => { chosen = 'full'; refresh() })
  checkbox.addEventListener('change', refresh)
  open.addEventListener('click', () => void openCase(chosen, open))
  extra.append(warning, confirm, open)
  box.append(extra)
  refresh()
  return box
}

function tierPick(tier: 'light' | 'full', label: string, on: boolean): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = on ? 'tier on' : 'tier'
  button.dataset.tier = tier
  button.textContent = label
  return button
}

function nextStep(verdict: string): string {
  if (verdict === 'high' || verdict === 'medium') {
    return 'You can open a light file at $49 or a full file at $79. The check you paid is subtracted. The remainder is a second USDC invoice, and the file stays unpaid until that transfer is verified.'
  }
  if (verdict === 'low') return 'We will not open a file on a low chance.'
  return 'We will not prepare papers for this notice.'
}

async function openCase(tier: 'light' | 'full', button: HTMLButtonElement): Promise<void> {
  const id = sessionStorage.getItem(ORDER_KEY)
  if (!id) return
  button.disabled = true
  const response = await fetch('/api/cases', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ orderId: id, tier }),
  })
  const body = (await response.json()) as CaseInvoice
  button.disabled = false
  if (!body.caseId) {
    const root = document.querySelector('#result-root')
    const note = document.createElement('p')
    note.className = 'warn'
    note.textContent = say(body.code, body.error)
    root?.append(note)
    return
  }
  sessionStorage.setItem(CASE_KEY, body.caseId)
  sessionStorage.removeItem(CASE_TX_KEY)
  location.hash = 'case'
}

async function paintCase(): Promise<void> {
  stopPoll()
  const root = document.querySelector('#case-root')
  const id = sessionStorage.getItem(CASE_KEY)
  if (!root) return
  root.replaceChildren()
  if (!id) {
    root.append(heading('No file invoice'), paragraph('Open a file from a high or medium result.'))
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
    return
  }
  if (row.paid) {
    root.append(heading('The remainder is paid'), paragraph(`${tierName(row.tier)} is paid. The check credit was ${row.feeUsd ?? ''} USD of the ${row.priceUsd ?? ''} USD price.`))
    root.append(paragraph('Preparing the papers in the browser is not on this page yet. Payment does not mean the withdrawal will be released.'))
    return
  }
  root.append(invoiceBlock({
    title: 'Pay the remainder',
    lead: `${tierName(row.tier)} is ${row.priceUsd} USD. The check credit is ${row.feeUsd} USD. You pay the rest, plus a unique fraction under $0.10.`,
    amount: row.amountUsd ? `${row.amountUsd} USDC` : '',
    rows: [
      ['Network', row.chain ?? 'base'],
      ['USDC contract', row.token ?? ''],
      ['Send to', row.recipient ?? ''],
      ['Price', row.priceUsd ? `${row.priceUsd} USD` : ''],
      ['Check already paid', row.feeUsd ? `${row.feeUsd} USD` : ''],
      ['Remainder before the fraction', row.netUsd ? `${row.netUsd} USD` : ''],
      ['Exact amount', row.amountUsd ? `${row.amountUsd} USDC` : ''],
      ['Atomic units', row.amountAtomic ?? ''],
      ['File', row.caseId],
    ],
    steps: [
      'Send USDC on Base from your own wallet.',
      'Match the exact amount. The credit is already subtracted.',
      'Paste the new transaction hash. The hash that paid the check cannot pay this invoice.',
      'The file is marked paid only after the chain check passes.',
    ],
    hashKey: CASE_TX_KEY,
    onSubmit: (tx) => confirm(`/api/cases/${id}/confirm`, tx, CASE_TX_KEY),
  }))
  pollTimer = window.setInterval(() => void refreshCase(id), 4000)
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

function nudge(el: Element | null): void {
  if (!(el instanceof HTMLElement) || !prefersMotion()) return
  el.animate(
    [
      { opacity: 0.35, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
  )
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

const BEATS = ['notice', 'trace', 'rules', 'verdict', 'papers'] as const

function startDemo(): void {
  const root = document.querySelector('#demo')
  const typed = document.querySelector('#demo-type')
  if (!root || !typed) return
  const beats = Array.from(root.querySelectorAll<HTMLElement>('.beat'))
  const dots = Array.from(root.querySelectorAll<HTMLElement>('.beat-dots i'))
  const full = typed.textContent ?? ''
  if (!prefersMotion()) return
  let index = 0
  let timer = 0
  const showBeat = (next: number) => {
    beats.forEach((beat, i) => beat.classList.toggle('on', i === next))
    dots.forEach((dot, i) => dot.classList.toggle('on', i === next))
  }
  const typeNotice = () => {
    typed.textContent = ''
    let n = 0
    const step = () => {
      n += 1
      typed.textContent = full.slice(0, n)
      if (n < full.length) timer = window.setTimeout(step, 28)
      else timer = window.setTimeout(advance, 900)
    }
    step()
  }
  const advance = () => {
    index = (index + 1) % BEATS.length
    showBeat(index)
    if (BEATS[index] === 'notice') typeNotice()
    else timer = window.setTimeout(advance, 2400)
  }
  showBeat(0)
  typeNotice()
  window.addEventListener('pagehide', () => window.clearTimeout(timer))
}
