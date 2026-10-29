import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAuthHandler } from './_lib/auth.js'

// Set APP_PASSWORD in the Vercel project. GET = status, POST = sign in, DELETE = sign out.
const handler = createAuthHandler()

export default function auth(req: IncomingMessage, res: ServerResponse) {
  return handler(req, res)
}
