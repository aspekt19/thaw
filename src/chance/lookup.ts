import { alchemyErc20To, type RpcCall } from '../chain/evm-rpc.ts'
import { EVM_CHAIN_IDS, TRANSFER_TOPIC, type Chain } from './constants.ts'
import { classifyDeposit, normalizeTronAddress, sameAddress } from './address.ts'
import { compareAmount, compareDate } from './money.ts'

export type Match = 'match' | 'mismatch' | 'unknown'

export type HopLookup = {
  status: 'ok' | 'unavailable' | 'ambiguous'
  detail: string
  sender: string | null
  hop1: string[]
  firstHopOk: boolean
  amountMatch: Match
  dateMatch: Match
}

type FetchLike = typeof fetch

const TRON_BASE = 'https://api.trongrid.io'
const ETHERSCAN = 'https://api.etherscan.io/v2/api'
const HOP_LIMIT = 10

type Transfer = {
  txId: string
  from: string
  to: string
  raw: string
  decimals: number | null
  symbol: string | null
  contract: string | null
  timeMs: number | null
}

function shortDetail(value: unknown): string {
  if (typeof value !== 'string') return 'unexpected response'
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.slice(0, 180) || 'unexpected response'
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

function tronHeaders(apiKey: string | undefined): Headers {
  const headers = new Headers({ accept: 'application/json' })
  if (apiKey) headers.set('TRON-PRO-API-KEY', apiKey)
  return headers
}

function asTransferFromEvent(row: unknown): Transfer | null {
  if (!row || typeof row !== 'object') return null
  const event = row as Record<string, unknown>
  if (event.event_name !== 'Transfer') return null
  const result = event.result
  if (!result || typeof result !== 'object') return null
  const fields = result as Record<string, unknown>
  const fromRaw = typeof fields.from === 'string' ? fields.from : null
  const toRaw = typeof fields.to === 'string' ? fields.to : null
  const value = typeof fields.value === 'string' ? fields.value : null
  if (!fromRaw || !toRaw || !value || !/^\d+$/.test(value)) return null
  const from = normalizeTronAddress(fromRaw)
  const to = normalizeTronAddress(toRaw)
  if (!from || !to) return null
  const txId = typeof event.transaction_id === 'string' ? event.transaction_id : ''
  const timeMs = typeof event.block_timestamp === 'number' ? event.block_timestamp : null
  const contractRaw = typeof event.contract_address === 'string' ? event.contract_address : null
  const contract = contractRaw ? normalizeTronAddress(contractRaw) ?? contractRaw : null
  return { txId, from, to, raw: value, decimals: null, symbol: null, contract, timeMs }
}

function asTransferFromTrc20(row: unknown): Transfer | null {
  if (!row || typeof row !== 'object') return null
  const item = row as Record<string, unknown>
  if (item.type !== 'Transfer') return null
  if (typeof item.from !== 'string' || typeof item.to !== 'string' || typeof item.value !== 'string') return null
  if (!/^\d+$/.test(item.value)) return null
  const token = item.token_info
  let decimals: number | null = null
  let symbol: string | null = null
  let contract: string | null = null
  if (token && typeof token === 'object') {
    const info = token as Record<string, unknown>
    if (typeof info.decimals === 'number') decimals = info.decimals
    if (typeof info.symbol === 'string') symbol = info.symbol
    if (typeof info.address === 'string') contract = normalizeTronAddress(info.address) ?? info.address
  }
  return {
    txId: typeof item.transaction_id === 'string' ? item.transaction_id : '',
    from: item.from,
    to: item.to,
    raw: item.value,
    decimals,
    symbol,
    contract,
    timeMs: typeof item.block_timestamp === 'number' ? item.block_timestamp : null,
  }
}

export function parseTronEventList(body: unknown): Transfer[] | null {
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (row.success === false) return null
  if (!Array.isArray(row.data)) return null
  return row.data.map(asTransferFromEvent).filter((item): item is Transfer => item !== null)
}

export function parseTronTrc20List(body: unknown): Transfer[] | null {
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  if (row.success === false) return null
  if (!Array.isArray(row.data)) return null
  return row.data.map(asTransferFromTrc20).filter((item): item is Transfer => item !== null)
}

function topicAddress(topic: unknown): string | null {
  if (typeof topic !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(topic)) return null
  return `0x${topic.slice(-40)}`.toLowerCase()
}

export function parseEvmReceiptTransfers(body: unknown): { block: string | null; transfers: Transfer[] } | null {
  if (!body || typeof body !== 'object') return null
  const row = body as Record<string, unknown>
  const result = row.result
  if (!result || typeof result !== 'object') return null
  const receipt = result as Record<string, unknown>
  const block = typeof receipt.blockNumber === 'string' ? receipt.blockNumber : null
  if (!Array.isArray(receipt.logs)) return { block, transfers: [] }
  const transfers: Transfer[] = []
  for (const log of receipt.logs) {
    if (!log || typeof log !== 'object') continue
    const entry = log as Record<string, unknown>
    const topics = Array.isArray(entry.topics) ? entry.topics : []
    if (typeof topics[0] !== 'string' || topics[0].toLowerCase() !== TRANSFER_TOPIC) continue
    const from = topicAddress(topics[1])
    const to = topicAddress(topics[2])
    const data = typeof entry.data === 'string' ? entry.data : ''
    if (!from || !to || !/^0x[0-9a-fA-F]{64}$/.test(data)) continue
    const contract = typeof entry.address === 'string' ? entry.address.toLowerCase() : null
    transfers.push({
      txId: typeof receipt.transactionHash === 'string' ? receipt.transactionHash : '',
      from,
      to,
      raw: BigInt(data).toString(10),
      decimals: null,
      symbol: null,
      contract,
      timeMs: null,
    })
  }
  return { block, transfers }
}

export function parseEvmTokenPage(body: unknown): Transfer[] | 'error' {
  if (!body || typeof body !== 'object') return 'error'
  const row = body as Record<string, unknown>
  if (!Array.isArray(row.result)) {
    if (row.status === '0' && typeof row.message === 'string' && /no transactions/i.test(row.message)) return []
    return 'error'
  }
  const transfers: Transfer[] = []
  for (const item of row.result) {
    if (!item || typeof item !== 'object') continue
    const tx = item as Record<string, unknown>
    if (typeof tx.from !== 'string' || typeof tx.to !== 'string' || typeof tx.value !== 'string') continue
    if (!/^\d+$/.test(tx.value)) continue
    const decimals = typeof tx.tokenDecimal === 'string' ? Number(tx.tokenDecimal) : null
    const seconds = typeof tx.timeStamp === 'string' ? Number(tx.timeStamp) : null
    transfers.push({
      txId: typeof tx.hash === 'string' ? tx.hash : '',
      from: tx.from.toLowerCase(),
      to: tx.to.toLowerCase(),
      raw: tx.value,
      decimals: decimals !== null && Number.isInteger(decimals) ? decimals : null,
      symbol: typeof tx.tokenSymbol === 'string' ? tx.tokenSymbol : null,
      contract: typeof tx.contractAddress === 'string' ? tx.contractAddress.toLowerCase() : null,
      timeMs: seconds !== null && Number.isFinite(seconds) ? seconds * 1000 : null,
    })
  }
  return transfers
}

export function parseEvmBlockTime(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null
  const result = (body as Record<string, unknown>).result
  if (!result || typeof result !== 'object') return null
  const stamp = (result as Record<string, unknown>).timestamp
  if (typeof stamp !== 'string' || !/^0x[0-9a-fA-F]+$/.test(stamp)) return null
  return Number(BigInt(stamp)) * 1000
}

function pickOne(transfers: Transfer[], asset: string): Transfer | 'ambiguous' | null {
  if (transfers.length === 0) return null
  if (transfers.length === 1) return transfers[0] ?? null
  const wanted = asset.toLowerCase()
  const matched = transfers.filter((item) => item.symbol?.toLowerCase() === wanted)
  if (matched.length === 1) return matched[0] ?? null
  return 'ambiguous'
}

function topSenders(chain: Chain, incoming: Transfer[], sender: string, contract: string | null, asset: string): string[] {
  const filtered = incoming.filter((item) => {
    if (sameAddress(chain, item.from, sender)) return false
    if (contract) return Boolean(item.contract) && sameAddress(chain, item.contract as string, contract)
    return Boolean(item.symbol) && item.symbol?.toLowerCase() === asset.toLowerCase()
  })
  const ranked = [...filtered].sort((a, b) => {
    const left = BigInt(a.raw)
    const right = BigInt(b.raw)
    if (left === right) return 0
    return left > right ? -1 : 1
  })
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of ranked) {
    const key = chain === 'tron' ? item.from : item.from.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item.from)
    if (out.length === HOP_LIMIT) break
  }
  return out
}

function finish(
  deposit: Transfer,
  hop1: string[],
  firstHopOk: boolean,
  statedAmount: string,
  statedDate: string,
  detail: string,
): HopLookup {
  const amountMatch =
    deposit.decimals === null ? 'unknown' : compareAmount(statedAmount, deposit.raw, deposit.decimals)
  const dateMatch = compareDate(statedDate, deposit.timeMs)
  return {
    status: 'ok',
    detail,
    sender: deposit.from,
    hop1,
    firstHopOk,
    amountMatch,
    dateMatch,
  }
}

async function getJson(fetchImpl: FetchLike, url: string, headers?: Headers): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(10_000) })
  return { ok: response.ok, status: response.status, body: await readJson(response) }
}

export async function lookupFirstHop(
  input: { chain: Chain; deposit: string; amount: string; asset: string; date: string },
  fetchImpl: FetchLike,
  keys: { etherscanApiKey?: string; trongridApiKey?: string; evmCall?: RpcCall; alchemyTransfers?: boolean },
): Promise<HopLookup> {
  const kind = classifyDeposit(input.chain, input.deposit)
  if (!kind) {
    return {
      status: 'unavailable',
      detail: 'deposit does not match this chain',
      sender: null,
      hop1: [],
      firstHopOk: false,
      amountMatch: 'unknown',
      dateMatch: 'unknown',
    }
  }
  if (input.chain === 'tron') return lookupTron(input, kind, fetchImpl, keys.trongridApiKey)
  const evm = evmChain(input.chain)
  if (evm && keys.evmCall) {
    const viaRpc = await lookupEvmRpc(input, kind, keys.evmCall, keys.alchemyTransfers === true, evm)
    if (viaRpc.status !== 'unavailable' || !keys.etherscanApiKey) return viaRpc
  }
  if (!keys.etherscanApiKey) {
    return {
      status: 'unavailable',
      detail: 'ETHERSCAN_API_KEY is not set',
      sender: null,
      hop1: [],
      firstHopOk: false,
      amountMatch: 'unknown',
      dateMatch: 'unknown',
    }
  }
  return lookupEvm(input, kind, fetchImpl, keys.etherscanApiKey)
}

async function lookupTron(
  input: { chain: Chain; deposit: string; amount: string; asset: string; date: string },
  kind: 'address' | 'tx',
  fetchImpl: FetchLike,
  apiKey: string | undefined,
): Promise<HopLookup> {
  const headers = tronHeaders(apiKey)
  if (kind === 'address') {
    const sender = input.deposit.trim()
    const page = await incomingTron(fetchImpl, headers, sender)
    if (!page) {
      return {
        status: 'unavailable',
        detail: 'TronGrid did not return incoming transfers',
        sender,
        hop1: [],
        firstHopOk: false,
        amountMatch: 'unknown',
        dateMatch: 'unknown',
      }
    }
    return {
      status: 'ok',
      detail: 'Address treated as the sender. Amount and date need a transaction id. One TronGrid page, limit 200.',
      sender,
      hop1: topSenders('tron', page, sender, null, input.asset),
      firstHopOk: true,
      amountMatch: 'unknown',
      dateMatch: 'unknown',
    }
  }

  const txUrl = `${TRON_BASE}/v1/transactions/${input.deposit.trim()}/events?only_confirmed=true`
  const events = await getJson(fetchImpl, txUrl, headers)
  if (!events.ok) {
    return unavailable(`TronGrid events HTTP ${events.status}`)
  }
  const parsed = parseTronEventList(events.body)
  if (!parsed) return unavailable(`TronGrid events: ${shortDetail((events.body as { error?: string } | null)?.error)}`)
  const chosen = pickOne(parsed, input.asset)
  if (chosen === 'ambiguous') return ambiguous('Several TRC-20 transfers in the transaction, and the asset does not pick one.')
  if (!chosen) return unavailable('No TRC-20 Transfer event in the transaction.')

  const page = await incomingTron(fetchImpl, headers, chosen.to)
  const enriched = page?.find((item) => item.txId.toLowerCase() === chosen.txId.toLowerCase())
  const deposit: Transfer = enriched
    ? { ...chosen, decimals: enriched.decimals, symbol: enriched.symbol, raw: enriched.raw }
    : chosen
  const hopPage = await incomingTron(fetchImpl, headers, chosen.from)
  return finish(
    deposit,
    hopPage ? topSenders('tron', hopPage, chosen.from, deposit.contract, input.asset) : [],
    hopPage !== null,
    input.amount,
    input.date,
    'TronGrid transaction events, then one page of incoming TRC-20 (limit 200).',
  )
}

async function incomingTron(fetchImpl: FetchLike, headers: Headers, address: string): Promise<Transfer[] | null> {
  const url = `${TRON_BASE}/v1/accounts/${address}/transactions/trc20?only_to=true&only_confirmed=true&limit=200`
  const response = await getJson(fetchImpl, url, headers)
  if (!response.ok) return null
  return parseTronTrc20List(response.body)
}

async function lookupEvm(
  input: { chain: Chain; deposit: string; amount: string; asset: string; date: string },
  kind: 'address' | 'tx',
  fetchImpl: FetchLike,
  apiKey: string,
): Promise<HopLookup> {
  const chain = evmChain(input.chain) ?? 'ethereum'
  const chainId = EVM_CHAIN_IDS[chain]
  if (kind === 'address') {
    const sender = input.deposit.trim().toLowerCase()
    const page = await tokenPage(fetchImpl, apiKey, chainId, { address: sender })
    if (page === 'error') return unavailable('Etherscan tokentx did not return a list.')
    return {
      status: 'ok',
      detail: 'Address treated as the sender. Amount and date need a transaction id. One tokentx page, offset 100.',
      sender,
      hop1: topSenders(chain, page.filter((item) => item.to === sender), sender, null, input.asset),
      firstHopOk: true,
      amountMatch: 'unknown',
      dateMatch: 'unknown',
    }
  }

  const receiptUrl = etherscanUrl(apiKey, {
    chainid: chainId,
    module: 'proxy',
    action: 'eth_getTransactionReceipt',
    txhash: input.deposit.trim(),
  })
  const receipt = await getJson(fetchImpl, receiptUrl)
  if (!receipt.ok) return unavailable(`Etherscan receipt HTTP ${receipt.status}`)
  const parsed = parseEvmReceiptTransfers(receipt.body)
  if (!parsed) return unavailable('Etherscan receipt had no result.')
  const chosen = pickOne(parsed.transfers, input.asset)
  if (chosen === 'ambiguous') return ambiguous('Several ERC-20 transfers in the receipt, and the asset does not pick one.')
  if (!chosen) return unavailable('No ERC-20 Transfer log in the receipt.')

  let deposit = chosen
  if (parsed.block) {
    const blockNo = BigInt(parsed.block).toString(10)
    const page = await tokenPage(fetchImpl, apiKey, chainId, {
      address: chosen.to,
      startblock: blockNo,
      endblock: blockNo,
    })
    if (page !== 'error') {
      const match = page.find((item) => item.txId.toLowerCase() === input.deposit.trim().toLowerCase())
      if (match) deposit = { ...chosen, ...match, from: match.from, to: match.to }
    }
  }
  if (deposit.timeMs === null && parsed.block) {
    const blockUrl = etherscanUrl(apiKey, {
      chainid: chainId,
      module: 'proxy',
      action: 'eth_getBlockByNumber',
      tag: parsed.block,
      boolean: 'false',
    })
    const block = await getJson(fetchImpl, blockUrl)
    if (block.ok) deposit = { ...deposit, timeMs: parseEvmBlockTime(block.body) }
  }
  const hopPage = await tokenPage(fetchImpl, apiKey, chainId, { address: deposit.from })
  const incoming = hopPage === 'error' ? null : hopPage.filter((item) => item.to === deposit.from.toLowerCase())
  return finish(
    deposit,
    incoming ? topSenders(chain, incoming, deposit.from, deposit.contract, input.asset) : [],
    incoming !== null,
    input.amount,
    input.date,
    'Etherscan receipt, tokentx for decimals, one page of the sender (offset 100).',
  )
}

function etherscanUrl(apiKey: string, query: Record<string, string>): string {
  const url = new URL(ETHERSCAN)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  url.searchParams.set('apikey', apiKey)
  return url.toString()
}

async function tokenPage(
  fetchImpl: FetchLike,
  apiKey: string,
  chainId: string,
  extra: Record<string, string>,
): Promise<Transfer[] | 'error'> {
  const url = etherscanUrl(apiKey, {
    chainid: chainId,
    module: 'account',
    action: 'tokentx',
    page: '1',
    offset: '100',
    sort: 'desc',
    ...extra,
  })
  const response = await getJson(fetchImpl, url)
  if (!response.ok) return 'error'
  return parseEvmTokenPage(response.body)
}

function evmChain(chain: Chain): 'ethereum' | 'arbitrum' | 'base' | null {
  if (chain === 'ethereum' || chain === 'arbitrum' || chain === 'base') return chain
  return null
}

async function lookupEvmRpc(
  input: { chain: Chain; deposit: string; amount: string; asset: string; date: string },
  kind: 'address' | 'tx',
  call: RpcCall,
  alchemyTransfers: boolean,
  chain: 'ethereum' | 'arbitrum' | 'base',
): Promise<HopLookup> {
  if (kind === 'address') {
    if (!alchemyTransfers) {
      return unavailable('This RPC has no transfer index. Set an Alchemy key or pass a transaction id.')
    }
    const sender = input.deposit.trim().toLowerCase()
    const page = await alchemyErc20To(call, sender)
    if (!page) return unavailable('alchemy_getAssetTransfers did not return a list.')
    const asTransfers = page
      .filter((item) => item.to === sender && item.rawValue)
      .map((item) => ({
        txId: item.hash,
        from: item.from,
        to: item.to ?? sender,
        raw: item.rawValue as string,
        decimals: item.decimals,
        symbol: item.asset,
        contract: item.contract,
        timeMs: item.timeMs,
      }))
    return {
      status: 'ok',
      detail: 'Address treated as the sender. One alchemy_getAssetTransfers page (maxCount 0x64). Amount and date need a transaction id.',
      sender,
      hop1: topSenders(chain, asTransfers, sender, null, input.asset),
      firstHopOk: true,
      amountMatch: 'unknown',
      dateMatch: 'unknown',
    }
  }
  let receipt: unknown
  try {
    receipt = await call('eth_getTransactionReceipt', [input.deposit.trim()])
  } catch {
    return unavailable('EVM RPC did not return a receipt.')
  }
  const parsed = parseEvmReceiptTransfers({ result: receipt })
  if (!parsed) return unavailable('EVM receipt had no result.')
  const chosen = pickOne(parsed.transfers, input.asset)
  if (chosen === 'ambiguous') return ambiguous('Several ERC-20 transfers in the receipt, and the asset does not pick one.')
  if (!chosen) return unavailable('No ERC-20 Transfer log in the receipt.')
  let deposit = chosen
  if (deposit.timeMs === null && parsed.block) {
    try {
      const block = await call('eth_getBlockByNumber', [parsed.block, false])
      deposit = { ...deposit, timeMs: parseEvmBlockTime({ result: block }) }
    } catch {
      deposit = { ...deposit, timeMs: null }
    }
  }
  let hop: ReturnType<typeof topSenders> = []
  let hopOk = false
  if (alchemyTransfers) {
    const page = await alchemyErc20To(call, deposit.from, deposit.contract)
    if (page) {
      hopOk = true
      const incoming = page
        .filter((item) => item.to === deposit.from.toLowerCase() && item.rawValue && item.hash.toLowerCase() !== input.deposit.trim().toLowerCase())
        .map((item) => ({
          txId: item.hash,
          from: item.from,
          to: item.to ?? deposit.from,
          raw: item.rawValue as string,
          decimals: item.decimals,
          symbol: item.asset,
          contract: item.contract,
          timeMs: item.timeMs,
        }))
      hop = topSenders(chain, incoming, deposit.from, deposit.contract, input.asset)
    }
  }
  return finish(
    deposit,
    hop,
    hopOk,
    input.amount,
    input.date,
    alchemyTransfers
      ? 'EVM receipt plus one alchemy_getAssetTransfers page (maxCount 0x64).'
      : 'EVM receipt only. The first hop needs Alchemy transfers or an optional Etherscan key.',
  )
}

function unavailable(detail: string): HopLookup {
  return {
    status: 'unavailable',
    detail,
    sender: null,
    hop1: [],
    firstHopOk: false,
    amountMatch: 'unknown',
    dateMatch: 'unknown',
  }
}

function ambiguous(detail: string): HopLookup {
  return {
    status: 'ambiguous',
    detail,
    sender: null,
    hop1: [],
    firstHopOk: false,
    amountMatch: 'unknown',
    dateMatch: 'unknown',
  }
}
