import type { IncomingMessage, ServerResponse } from 'node:http'
import { createRelay } from '../_lib/breezeRelay.js'

const relay = createRelay()

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return relay.callback(req, res)
}
