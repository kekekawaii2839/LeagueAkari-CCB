import type { AxiosInstance } from 'axios'
import { describe, expect, it, vi } from 'vitest'

import { OpggHttpApiAxiosHelper } from './index'

describe('OpggHttpApiAxiosHelper', () => {
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
