export type LimitReading = { kind: string; percentUsed: number; resetsAt?: string }

/** The figures the band draws, as the last `session.measure` reported them. */
export type UsageReading = {
  contextPercent?: number
  limits: LimitReading[]
  usd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      reading: UsageReading | null
      /** Bumped once a minute so countdowns and expired windows redraw while idle. */
      tick: number
    }
  }
}
