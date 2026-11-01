const form = document.querySelector<HTMLFormElement>('#check-form')
const result = document.querySelector<HTMLElement>('#result')
const submit = document.querySelector<HTMLButtonElement>('#submit')
const clientId = document.querySelector<HTMLInputElement>('#clientId')

if (clientId) clientId.value = browserId()

const LABELS: Record<string, string> = {
  high: 'Высокий шанс',
  medium: 'Средний шанс',
  low: 'Низкий шанс',
  cannot_help: 'Помочь не сможем',
}

form?.addEventListener('submit', (event) => {
  event.preventDefault()
  void send()
})

async function send(): Promise<void> {
  if (!form || !result || !submit) return
  submit.disabled = true
  result.replaceChildren()
  try {
    const response = await fetch(form.action, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(payload()),
    })
    const body = (await response.json()) as Record<string, unknown>
    render(result, body)
  } catch {
    const p = document.createElement('p')
    p.className = 'error'
    p.textContent = 'Не удалось отправить форму.'
    result.append(p)
  } finally {
    submit.disabled = false
  }
}

function payload(): Record<string, unknown> {
  const data = new FormData(form ?? undefined)
  const out: Record<string, unknown> = {}
  data.forEach((value, key) => {
    if (typeof value !== 'string' || value === '') return
    if (key === 'priorRefusal') out[key] = true
    else out[key] = value
  })
  if (!out.priorRefusal) out.priorRefusal = false
  return out
}

function render(root: HTMLElement, body: Record<string, unknown>): void {
  if (body.ok !== true) {
    const p = document.createElement('p')
    p.className = 'error'
    p.textContent = typeof body.error === 'string' ? body.error : 'Проверка не выполнена.'
    root.append(p)
    return
  }
  const verdict = typeof body.verdict === 'string' ? body.verdict : ''
  const title = document.createElement('h2')
  title.textContent = LABELS[verdict] ?? 'Результат'
  if (verdict === 'high') title.className = 'verdict-high'
  root.append(title)
  addParagraph(root, body.explanation)
  if (body.cached === true) addParagraph(root, 'Этот депозит уже проверяли за последние сутки. Показан сохранённый результат.')
  addList(root, 'Почему', body.reasons)
  addList(root, 'Что может повысить шанс', body.whatWouldRaiseChance)
  addParagraph(root, body.disclaimer)
}

function addParagraph(root: HTMLElement, value: unknown): void {
  if (typeof value !== 'string' || value === '') return
  const p = document.createElement('p')
  p.textContent = value
  root.append(p)
}

function addList(root: HTMLElement, title: string, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return
  const h = document.createElement('h3')
  h.textContent = title
  const list = document.createElement('ul')
  for (const item of value) {
    if (typeof item !== 'string') continue
    const li = document.createElement('li')
    li.textContent = item
    list.append(li)
  }
  root.append(h, list)
}

function browserId(): string {
  const key = 'thaw.clientId'
  try {
    const existing = localStorage.getItem(key)
    if (existing && /^[A-Za-z0-9_-]{8,64}$/.test(existing)) return existing
    const created = crypto.randomUUID()
    localStorage.setItem(key, created)
    return created
  } catch {
    return ''
  }
}
