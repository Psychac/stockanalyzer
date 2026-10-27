export interface FyersSession {
  appId: string
  accessToken: string
  obtainedAt: number
  /** FYERS tokens lapse at 06:30 IST daily. */
  expiresAt: number
}

/** What we keep between sessions. The secret is optional: the user chooses whether to store it. */
export interface FyersCredentials {
  appId: string
  secret?: string
}

export const FYERS_API = 'https://api-t1.fyers.in'
