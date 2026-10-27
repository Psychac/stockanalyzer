import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRelay } from '../_lib/breezeRelay.js'

// Set BREEZE_RELAY_CODE in the Vercel project to require callers to send it; leave unset for no code.
const relay = createRelay({ accessCode: process.env.BREEZE_RELAY_CODE || undefined })

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return relay.ping(req, res)
}
