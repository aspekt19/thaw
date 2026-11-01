/**
 * JSON-RPC for EVM reads.
 * Alchemy hosts, from Alchemy docs read 2026-11-01:
 * eth-mainnet.g.alchemy.com, base-mainnet.g.alchemy.com, arb-mainnet.g.alchemy.com, path /v2/{apiKey}.
 * Public fallbacks, from the same Alchemy network page:
 * Base https://mainnet.base.org and Arbitrum https://arb1.arbitrum.io/rpc.
 * No public Ethereum URL was listed there, so Ethereum falls through only when an operator sets THAW_RPC_URL_ETHEREUM.
 * alchemy_getAssetTransfers is documented for Ethereum and the L2s named on that method page, including Base and Arbitrum.
 */

export type RpcChain = 'ethereum' | 'base' | 'arbitrum'

const ALCHEMY_HOST: Record<RpcChain, string> = {
  ethereum: 'eth-mainnet.g.alchemy.com',
  base: 'base-mainnet.g.alchemy.com',
  arbitrum: 'arb-mainnet.g.alchemy.com',
}

const PUBLIC_RPC: Partial<Record<RpcChain, string>> = {
  base: 'https://mainnet.base.org',
  arbitrum: 'https://arb1.arbitrum.io/rpc',
}

export type RpcCall = (method: string, params: unknown[]) => Promise<unknown>

export function rpcUrls(chain: RpcChain, env: { alchemyKey?: string; overrideUrl?: string }): string[] {
  const urls: string[] = []
  const key = env.alchemyKey?.trim()
  if (key) urls.push(`https://${ALCHEMY_HOST[chain]}/v2/${key}`)
  if (env.overrideUrl?.trim()) urls.push(env.overrideUrl.trim())
  const pub = PUBLIC_RPC[chain]
  if (pub && !urls.includes(pub)) urls.push(pub)
  return urls
}

export function createRpc(urls: string[], fetchImpl: typeof fetch = fetch): RpcCall {
  return async (method, params) => {
    let last = 'no rpc url'
    for (const url of urls) {
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: AbortSignal.timeout(8_000),
        })
        if (!response.ok) {
          last = `HTTP ${response.status}`
          continue
        }
        const body = (await response.json()) as { result?: unknown; error?: { message?: string } }
        if (body.error) {
          last = body.error.message ?? 'rpc error'
          continue
        }
        return body.result
      } catch {
        last = 'rpc request failed'
      }
    }
    throw new Error(last)
  }
}

export type AssetTransfer = {
  hash: string
  from: string
  to: string | null
  rawValue: string | null
  decimals: number | null
  contract: string | null
  asset: string | null
  timeMs: number | null
}

/** One page of alchemy_getAssetTransfers. category erc20 is in the documented enum. */
export async function alchemyErc20To(call: RpcCall, toAddress: string, contract?: string | null): Promise<AssetTransfer[] | null> {
  let result: unknown
  try {
    result = await call('alchemy_getAssetTransfers', [
      {
        toAddress,
        category: ['erc20'],
        excludeZeroValue: true,
        withMetadata: true,
        order: 'desc',
        maxCount: '0x64',
        ...(contract ? { contractAddresses: [contract] } : {}),
      },
    ])
  } catch {
    return null
  }
  if (!result || typeof result !== 'object') return null
  const transfers = (result as { transfers?: unknown }).transfers
  if (!Array.isArray(transfers)) return null
  const out: AssetTransfer[] = []
  for (const row of transfers) {
    if (!row || typeof row !== 'object') continue
    const item = row as Record<string, unknown>
    if (typeof item.hash !== 'string' || typeof item.from !== 'string') continue
    const raw = item.rawContract
    let rawValue: string | null = null
    let decimals: number | null = null
    let contractAddress: string | null = null
    if (raw && typeof raw === 'object') {
      const contractRow = raw as Record<string, unknown>
      if (typeof contractRow.value === 'string' && /^0x[0-9a-fA-F]+$/.test(contractRow.value)) {
        rawValue = BigInt(contractRow.value).toString(10)
      }
      if (typeof contractRow.decimal === 'string' && /^0x[0-9a-fA-F]+$/.test(contractRow.decimal)) {
        decimals = Number(BigInt(contractRow.decimal))
      }
      if (typeof contractRow.address === 'string') contractAddress = contractRow.address.toLowerCase()
    }
    const meta = item.metadata
    let timeMs: number | null = null
    if (meta && typeof meta === 'object') {
      const stamp = (meta as { blockTimestamp?: unknown }).blockTimestamp
      if (typeof stamp === 'string') {
        const parsed = Date.parse(stamp)
        if (!Number.isNaN(parsed)) timeMs = parsed
      }
    }
    out.push({
      hash: item.hash,
      from: item.from.toLowerCase(),
      to: typeof item.to === 'string' ? item.to.toLowerCase() : null,
      rawValue,
      decimals,
      contract: contractAddress,
      asset: typeof item.asset === 'string' ? item.asset : null,
      timeMs,
    })
  }
  return out
}
