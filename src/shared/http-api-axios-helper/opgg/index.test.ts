import type { AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { OpggHttpApiAxiosHelper } from './index'

describe('OpggHttpApiAxiosHelper', () => {
  it('requests lane matchup stats with the same region, role, tier, patch and cancellation signal', async () => {
    const get = vi.fn().mockResolvedValue({ data: {} })
    const helper = new OpggHttpApiAxiosHelper({ defaults: {}, get } as unknown as AxiosInstance)
    const signal = new AbortController().signal
    await helper.getCounterStats('kr', 266, 'top', 24, {
      tier: 'diamond_plus',
      version: '16.22',
      signal
    })
    expect(get).toHaveBeenCalledWith('/api/kr/champions/ranked/266/top/counters/24', {
      params: { tier: 'diamond_plus', version: '16.22' },
      signal
    })
  })
  it('passes the selected matchup champion to ranked detail requests', async () => {
    const get = vi.fn().mockResolvedValue({ data: { data: {} } })
    const httpClient = {
      defaults: {},
      get
    } as unknown as AxiosInstance
    const signal = new AbortController().signal

    const helper = new OpggHttpApiAxiosHelper(httpClient)

    await helper.getChampion('global', 'ranked', 39, 'top', {
      tier: 'emerald_plus',
      version: '16.17',
      targetChampionId: 24,
      signal
    })

    expect(get).toHaveBeenCalledWith('/api/global/champions/ranked/39/top', {
      params: {
        tier: 'emerald_plus',
        version: '16.17',
        target_champion: 24
      },
      signal
    })
  })

  it('requests ARAM Mayhem tiers with the OP.GG content type', async () => {
    const get = vi.fn().mockResolvedValue({ data: { data: [] } })
    const httpClient = {
      defaults: {},
      get
    } as unknown as AxiosInstance
    const signal = new AbortController().signal

    const helper = new OpggHttpApiAxiosHelper(httpClient)

    await helper.getAramMayhemTiers({ signal })

    expect(get).toHaveBeenCalledWith('/api/contents/tiers', {
      params: {
        type: 'aram_mayhem'
      },
      signal
    })
  })
})
