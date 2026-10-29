import type { IncomingMessage, ServerResponse } from 'node:http'
import { deployedRelay } from '../_lib/breezeRelay.js'

// BREEZE_RELAY_CODE is required on Vercel (see deployedRelay).
const relay = deployedRelay()

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return relay.ping(req, res)
}
