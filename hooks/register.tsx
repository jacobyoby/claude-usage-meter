import { atom, read, update } from 'claude-code'
import type { Register, SessionUsage, Timer } from 'claude-code'

import type { LimitReading, UsageReading } from '../types'

/** Percentages at or past these draw in the warning and error colors. */
const WARN_PERCENT = 80
const ERROR_PERCENT = 95
/** Cells in each meter. */
const METER_CELLS = 6
const REDRAW_MS = 60_000

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5h',
  seven_day: '7d',
  spend_limit: 'spend',
}

type Level = 'success' | 'warning' | 'error'

const levelOf = (percent: number): Level =>
  percent >= ERROR_PERCENT ? 'error' : percent >= WARN_PERCENT ? 'warning' : 'success'

/** The meter's filled and empty cells for a percentage, clamped to 0..100. */
const meterCells = (percent: number): { filled: string; empty: string } => {
  const filled = Math.round((Math.min(Math.max(percent, 0), 100) / 100) * METER_CELLS)
  return { filled: '▰'.repeat(filled), empty: '▱'.repeat(METER_CELLS - filled) }
}

type Gauge = { key: string; label: string; percent: number; reset?: string }

const reading = atom({ plugin: 'usage-meter', key: 'reading' } as const, null)
const tick = atom({ plugin: 'usage-meter', key: 'tick' } as const, 0)

const toReading = (usage: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): UsageReading => ({
  contextPercent: usage.context.percent,
  limits: usage.rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
  usd: usage.cost?.usd,
})

/** Minutes until `resetsAt`, or undefined when it is absent or not a date. */
const minutesUntil = (resetsAt: string | undefined, now: number): number | undefined => {
  if (resetsAt === undefined) return undefined
  const ms = Date.parse(resetsAt) - now
  return Number.isNaN(ms) ? undefined : Math.round(ms / 60_000)
}

/** "3d 4h", "2h 5m" or "30m". */
const durationText = (minutes: number): string => {
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes % 60}m`
  return `${minutes}m`
}

/** A window past its reset has started over, so its old percentage is drawn as 0. */
const limitGauge = (limit: LimitReading, now: number): Gauge => {
  const label = LIMIT_LABELS[limit.kind] ?? limit.kind
  const minutes = minutesUntil(limit.resetsAt, now)
  if (minutes === undefined) return { key: limit.kind, label, percent: limit.percentUsed }
  if (minutes <= 0) return { key: limit.kind, label, percent: 0 }
  return { key: limit.kind, label, percent: limit.percentUsed, reset: durationText(minutes) }
}

const costText = (usd: number): string => (usd > 0 && usd < 0.005 ? '<$0.01' : `$${usd.toFixed(2)}`)

export const register: Register = on => {
  let redraw: Timer | undefined

  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    // A measurement that landed while usage() was in flight is newer: keep it.
    await update($, reading, current => current ?? toReading(usage))
    redraw?.cancel()
    redraw = $.clock.every(REDRAW_MS, () => void update($, tick, n => n + 1))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, reading, () => toReading(e))
    return next(e)
  })

  // `/clear` ends the conversation with no session.start after it: its figures go with it.
  on('session.end', async ($, e, next) => {
    await update($, reading, () => null)
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const current = await read($, reading)
    if (e.props.hasSurvey || current === null) return next(e)

    // Read only to redraw on each minute's tick.
    await read($, tick)
    const now = await $.clock.now()
    const gauges: Gauge[] = [
      ...(current.contextPercent === undefined
        ? []
        : [{ key: 'context', label: 'context', percent: current.contextPercent }]),
      ...current.limits.map(limit => limitGauge(limit, now)),
    ]
    if (gauges.length === 0 && current.usd === undefined) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} alignItems="center">
        {gauges.map(gauge => {
          const level = levelOf(gauge.percent)
          const cells = meterCells(gauge.percent)
          return (
            <Box key={gauge.key} flexDirection="row" columnGap={1} alignItems="center">
              <Text color="subtle" size="footnote" weight="medium">
                {gauge.label}
              </Text>
              <Text>
                <Text color={level}>{cells.filled}</Text>
                <Text color="inactive">{cells.empty}</Text>
              </Text>
              <Text color={level === 'success' ? 'text' : level} weight="semibold" tabular>
                {`${gauge.percent}%`}
              </Text>
              {gauge.reset === undefined ? null : (
                <Text color="subtle" size="footnote" tabular>
                  {`↻ ${gauge.reset}`}
                </Text>
              )}
            </Box>
          )
        })}
        {current.usd === undefined ? null : (
          <Text color="subtle" weight="medium" tabular>
            {costText(current.usd)}
          </Text>
        )}
      </Box>
    )
  })
}
