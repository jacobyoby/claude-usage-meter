import { expect, mock, test } from 'claude-code/testing'
import type { On, SessionMeasureInput } from 'claude-code'

const BAND = {
  plugin: 'usage-meter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

const NOW = Date.parse('2026-11-01T10:00:00Z')

const MEASURED: SessionMeasureInput = {
  context: { tokens: 84_000, window: 200_000, percent: 42 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 85, resetsAt: '2026-11-01T12:05:00Z' },
    { kind: 'seven_day', percentUsed: 31 },
  ],
  cost: { usd: 1.234 },
  changed: ['context', 'rateLimits', 'cost'],
}

/** Stands for the engine beneath the plugin: these events answer as a session would. */
const engine = (on: On, usage: Omit<SessionMeasureInput, 'changed'>) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.usage', () => ({ value: { startedAt: NOW, ...usage } }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine</Text>
  })
}

const START = { cwd: '/', surface: 'desktop', isInteractive: true } as const

test('the band shows context, limits and cost after a measurement', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { context: { window: 200_000 }, rateLimits: [] })
  await $.session.measure(MEASURED)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const text = async (pattern: RegExp) => (await ui.find({ type: 'Text', text: pattern }))?.text
    expect(await text(/^context$/)).toBe('context')
    expect(await text(/^▰+▱*$/)).toBe('▰▰▰▱▱▱')
    expect(await text(/^42%$/)).toBe('42%')
    expect((await ui.find({ type: 'Text', text: /^85%$/ }))?.props.color).toBe('warning')
    expect(await text(/^↻/)).toBe('↻ 2h 5m')
    expect(await text(/^31%$/)).toBe('31%')
    expect(await text(/^\$/)).toBe('$1.23')
    await ui.unmount()
  }
})

test('nothing is drawn before the first measurement', async ($, on) => {
  engine(on, { context: { window: 200_000 }, rateLimits: [] })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('session.start seeds the band but never replaces a newer measurement', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { context: { window: 200_000, percent: 10 }, rateLimits: [], cost: { usd: 0.5 } })

  await $.session.start(START)
  let ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^10%$/ }))?.text).toBe('10%')
  await ui.unmount()

  await $.session.measure(MEASURED)
  await $.session.start(START)
  ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^42%$/ }))?.text).toBe('42%')
  expect(await ui.find({ type: 'Text', text: /^10%$/ })).toBeUndefined()
  await ui.unmount()
})

test('/clear drops the old conversation figures', async ($, on) => {
  engine(on, { context: { window: 200_000 }, rateLimits: [] })
  await $.session.measure(MEASURED)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine')
  await ui.unmount()
})

test('countdowns run while idle and an expired window draws as reset', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  engine(on, { context: { window: 200_000 }, rateLimits: [] })
  await $.session.start(START)
  await $.session.measure({
    ...MEASURED,
    rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: '2026-11-01T10:30:00Z' }],
  })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /^↻/ }))?.text).toBe('↻ 30m')

  await clock.advance(10 * 60_000)
  expect((await ui.find({ type: 'Text', text: /^↻/ }))?.text).toBe('↻ 20m')

  await clock.advance(25 * 60_000)
  expect(await ui.find({ type: 'Text', text: /^↻/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^97%$/ })).toBeUndefined()
  expect((await ui.find({ type: 'Text', text: /^0%$/ }))?.text).toBe('0%')
  await ui.unmount()
})

test('a fraction of a cent reads as under a cent', async ($, on) => {
  mock.clock(on, { now: NOW })
  engine(on, { context: { window: 200_000 }, rateLimits: [] })
  await $.session.measure({ ...MEASURED, cost: { usd: 0.004 } })
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /\$/ }))?.text).toBe('<$0.01')
  await ui.unmount()
})
