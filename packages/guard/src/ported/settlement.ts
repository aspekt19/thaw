/**
 * After a pay call errors or times out, the payment may still have settled on-chain (the signed EIP-3009
 * authorization stays valid for the seller's window). This hook looks for the USDC transfer on-chain.
 * It needs an RPC URL (KITE_SETTLEMENT_RPC_URL). Without one, or when nothing is found, the outcome stays
 * "unknown" and the amount keeps counting against the daily limit: not finding a transfer yet does not
 * prove it will not settle later.
 */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

export type SettlementQuery = {
  txHash?: string | null
  asset?: string | null
  from?: string | null
  payTo?: string | null
  amountAtomic?: string | null
  /** How many recent blocks to scan for the transfer (default 900). */
  lookbackBlocks?: number
}

export type SettlementResult = { status: 'settled' | 'not_found' | 'unknown'; txHash: string | null; note: string }

let fetchOverride: typeof fetch | null = null
export function __setSettlementFetchForTests(f: typeof fetch | null): void {
  fetchOverride = f
}

const addr = (a: string | null | undefined) => (a && /^0x[0-9a-fA-F]{40}$/.test(a) ? a.toLowerCase() : null)
const topicFor = (a: string) => `0x${'0'.repeat(24)}${a.slice(2)}`

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const r = await (fetchOverride ?? fetch)(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8_000),
  })
  const j = (await r.json()) as { result?: T; error?: { message?: string } }
  if (!r.ok || j.error) throw new Error(`rpc ${method} failed`)
  return j.result as T
}

export async function checkSettlement(q: SettlementQuery, rpcUrl: string | undefined = process.env.KITE_SETTLEMENT_RPC_URL?.trim()): Promise<SettlementResult> {
  if (!rpcUrl) return { status: 'unknown', txHash: null, note: 'No settlement RPC configured; the amount counts as spent until you check it.' }
  try {
    if (q.txHash && /^0x[0-9a-fA-F]{64}$/.test(q.txHash)) {
      const rec = await rpc<{ status?: string } | null>(rpcUrl, 'eth_getTransactionReceipt', [q.txHash])
      if (rec?.status === '0x1') return { status: 'settled', txHash: q.txHash, note: 'Transaction confirmed on-chain.' }
      return { status: rec ? 'not_found' : 'unknown', txHash: q.txHash, note: rec ? 'Transaction reverted.' : 'Transaction not mined yet.' }
    }
    const asset = addr(q.asset)
    const from = addr(q.from)
    const to = addr(q.payTo)
    if (!asset || !from || !to) return { status: 'unknown', txHash: null, note: 'Not enough payment details to look for the transfer.' }
    const head = parseInt(await rpc<string>(rpcUrl, 'eth_blockNumber', []), 16)
    const fromBlock = Math.max(0, head - (q.lookbackBlocks ?? 900))
    const logs = await rpc<Array<{ data?: string; transactionHash?: string }>>(rpcUrl, 'eth_getLogs', [
      { address: asset, fromBlock: `0x${fromBlock.toString(16)}`, toBlock: 'latest', topics: [TRANSFER_TOPIC, topicFor(from), topicFor(to)] },
    ])
    const want = q.amountAtomic && /^\d+$/.test(q.amountAtomic) ? BigInt(q.amountAtomic) : null
    const hit = logs.find((l) => (want == null ? true : l.data != null && BigInt(l.data) === want))
    if (hit) return { status: 'settled', txHash: hit.transactionHash ?? null, note: 'Found the matching transfer on-chain.' }
    return { status: 'not_found', txHash: null, note: 'No matching transfer yet. It can still settle until the signature window ends.' }
  } catch {
    return { status: 'unknown', txHash: null, note: 'Settlement RPC did not answer.' }
  }
}
