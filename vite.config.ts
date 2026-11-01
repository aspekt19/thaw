import { defineConfig, type Plugin } from 'vite'
import { migrationSql } from './src/db/sql.ts'
import { sqliteDb } from './src/db/sqlite.ts'
import { handleApi, type Env } from './src/worker.ts'

const localDb = sqliteDb(migrationSql())
const localEnv: Env = {
  DB: localDb,
  ASSETS: { fetch: async () => new Response('not found', { status: 404 }) },
  THAW_USDC_ADDRESS: process.env.THAW_USDC_ADDRESS,
  THAW_CHECK_PRICE_USD: process.env.THAW_CHECK_PRICE_USD,
  THAW_PAYMENT_CHAIN: process.env.THAW_PAYMENT_CHAIN,
  THAW_PAYMENT_CONFIRMATIONS: process.env.THAW_PAYMENT_CONFIRMATIONS,
  THAW_CASE_LIGHT_USD: process.env.THAW_CASE_LIGHT_USD,
  THAW_CASE_FULL_USD: process.env.THAW_CASE_FULL_USD,
  THAW_PAID_PATH_ENABLED: process.env.THAW_PAID_PATH_ENABLED,
}

function thawApi(): Plugin {
  return {
    name: 'thaw-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (!path.startsWith('/api/') && !path.startsWith('/v1/')) {
          next()
          return
        }
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(key, value)
          else if (Array.isArray(value) && value[0]) headers.set(key, value[0])
        }
        const request = new Request(`http://127.0.0.1${path}`, {
          method: req.method,
          headers,
          body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
        })
        const response = await handleApi(request, localEnv)
        if (!response) {
          next()
          return
        }
        res.statusCode = response.status
        response.headers.forEach((value, key) => res.setHeader(key, value))
        res.end(Buffer.from(await response.arrayBuffer()))
      })
    },
  }
}

export default defineConfig({
  plugins: [thawApi()],
  build: { outDir: 'dist', emptyOutDir: true },
})
