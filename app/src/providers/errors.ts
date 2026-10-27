export type ProviderErrorKind = 'auth' | 'rate' | 'network' | 'api'

/** Failure from any live provider. `auth` and `rate` stop a load early; retrying would only make them worse. */
export class ProviderError extends Error {
  constructor(message: string, readonly kind: ProviderErrorKind, readonly code: number | null = null) {
    super(message)
    this.name = 'ProviderError'
  }
}
