import { defineConfig, type Plugin } from 'vite'
import { handleRequest, defaultDeps } from './src/http/handle.ts'

function thawApi(): Plugin {
  return {
    name: 'thaw-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0]
        if (path !== '/api/check-chance' && path !== '/v1/check-chance') {
          next()
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: false, code: 'method', error: 'Нужен POST.' }))
          return
        }
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(Buffer.from(chunk))
        const headers = new Headers()
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') headers.set(key, value)
          else if (Array.isArray(value) && value[0]) headers.set(key, value[0])
        }
        const request = new Request('http://127.0.0.1/api/check-chance', {
          method: 'POST',
          headers,
          body: Buffer.concat(chunks),
        })
        const response = await handleRequest(request, defaultDeps())
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
