/**
 * Spaces calls to stay under a provider's request limits. Defaults suit FYERS Standard (5/sec, 50/min): going over
 * the per-minute limit more than 3 times in a day blocks the account for the rest of the day, so leave headroom.
 */
export class RateLimiter {
  private stamps: number[] = []

  constructor(
    private perSecond = 4,
    private perMinute = 40,
    // Monotonic: immune to wall-clock adjustments, which would otherwise let calls through early or stall them.
    private clock: () => number = () => performance.now(),
    private sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
  ) {}

  async take(): Promise<void> {
    for (;;) {
      const now = this.clock()
      this.stamps = this.stamps.filter(t => now - t < 60_000)
      const lastSecond = this.stamps.filter(t => now - t < 1000)
      let wait = 0
      if (this.stamps.length >= this.perMinute) wait = this.stamps[0] + 60_000 - now
      else if (lastSecond.length >= this.perSecond) wait = lastSecond[0] + 1000 - now
      if (wait <= 0) {
        this.stamps.push(now)
        return
      }
      await this.sleep(wait + 5)
    }
  }
}
