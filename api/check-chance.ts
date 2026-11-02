import { postCheck } from '../src/http/handle.ts'

export async function POST(request: Request): Promise<Response> {
  try {
    return await postCheck(request)
  } catch (err) {
    console.error('check-chance failed', err instanceof Error ? err.name : 'error')
    return Response.json({ ok: false, code: 'internal', error: 'The check did not finish.' }, { status: 500 })
  }
}
