import type { AxiosInstance } from 'axios'
import { expect, it, vi } from 'vitest'

import { LolalyticsPoolSource, decodeSnapshot, parsePairTable } from './source'

it('validates pair counts, rates, duplicates and source schemas', () => {
  expect(parsePairTable(['id', 'wr', 'n'], [[1, 50, 10]])).toEqual([
    { championId: 1, games: 10, reportedWinRate: 0.5 }
  ])
  for (const rows of [
    [[1, NaN, 10]],
    [[1, 50, -1]],
    [
      [1, 50, 10],
      [1, 51, 20]
    ]
  ])
    expect(() => parsePairTable(['id', 'wr', 'n'], rows)).toThrow('source-changed')
  expect(() => decodeSnapshot('<html/>', 'roster')).toThrow('source-changed')
})
it('decodes public snapshot graph references without treating primitive slugs as indices', () => {
  const objs = [
    { champion: '3', patch: '4', page: '5', api: '6' },
    { fields: '7', cid: '8', queue: 420, avgWr: 50 },
    { '412': '9' },
    'thresh',
    '16.22',
    'tierlist',
    {},
    [],
    {},
    'thresh'
  ]
  const result = decodeSnapshot(
    `<script type="qwik/json">${JSON.stringify({ objs })}</script>`,
    'roster'
  )
  expect(result.nav.patch).toBe('16.22')
  expect(result.slugs['412']).toBe('thresh')
})
it('a pre-cancelled source request cannot publish a catalog', async () => {
  const get = vi.fn(async () => ({ data: '' })),
    source = new LolalyticsPoolSource({ get } as unknown as AxiosInstance)
  const abort = new AbortController()
  abort.abort()
  await expect(source.catalog('MID', abort.signal)).rejects.toBeDefined()
  expect(get).not.toHaveBeenCalled()
})

it('requests global Emerald+ and rejects an all-ranks response', async () => {
  const objs = [
    {
      champion: '2',
      patch: '3',
      page: '4',
      api: '5',
      tier: '6',
      region: '6',
      mode: '7',
      lane: '8',
      status: 200
    },
    { fields: '9', cid: 'a', queue: 420, avgWr: 50 },
    'thresh',
    '16.22',
    'tierlist',
    {},
    'all',
    'ranked',
    'support',
    [],
    {}
  ]
  const get = vi.fn(async (_url: string) => ({
    data: `<script type="qwik/json">${JSON.stringify({ objs })}</script>`
  }))
  const source = new LolalyticsPoolSource({ get } as unknown as AxiosInstance)
  await expect(source.catalog('SUP', new AbortController().signal)).rejects.toThrow(
    'source-changed'
  )
  const url = new URL(get.mock.calls[0][0])
  expect(Object.fromEntries(url.searchParams)).toEqual({
    lane: 'support',
    tier: 'emerald_plus',
    region: 'all'
  })
  expect(get).toHaveBeenCalledTimes(1)
})

it('spaces starts across requests without waiting for an in-flight response', async () => {
  const starts: number[] = []
  let finish!: (response: { data: string }) => void
  const held = new Promise<{ data: string }>((resolve) => {
    finish = resolve
  })
  const get = vi.fn(async () => {
    starts.push(performance.now())
    return starts.length === 1 ? held : { data: '' }
  })
  const source = new LolalyticsPoolSource({ get } as unknown as AxiosInstance)
  const signal = new AbortController().signal
  const queued = new AbortController()
  const first = expect(source.catalog('MID', signal)).rejects.toThrow('source-changed')
  const second = expect(source.catalog('TOP', signal)).rejects.toThrow('source-changed')
  const cancelled = expect(source.catalog('SUP', queued.signal)).rejects.toMatchObject({
    name: 'AbortError'
  })
  try {
    expect(get).toHaveBeenCalledTimes(1)
    queued.abort()
    await cancelled
    await second
    expect(get).toHaveBeenCalledTimes(2)
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(495)
  } finally {
    queued.abort()
    finish({ data: '' })
    await first
  }
})
