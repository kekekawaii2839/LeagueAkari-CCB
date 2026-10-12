import { LeaguesLedgeHttpApi } from '@shared/http-api-axios-helper/sgp/leagues-ledge'
import axios, { AxiosError } from 'axios'
import axiosRetry from 'axios-retry'
import { describe, expect, test } from 'vitest'

describe('rank collection transport retry ownership', () => {
  test('bounded callers disable nested retries while ordinary callers retain the existing policy', async () => {
    let attempts = 0
    const http = axios.create({
      adapter: async (config) => {
        attempts++
        throw new AxiosError(
          'synthetic service unavailable',
          'ERR_BAD_RESPONSE',
          config,
          {},
          {
            status: 503,
            statusText: 'Unavailable',
            data: {},
            headers: {},
            config
          }
        )
      }
    })
    axiosRetry(http, { retries: 2, retryDelay: () => 0 })
    const api = new LeaguesLedgeHttpApi(http)
    await expect(
      api.getRankedStatsByPuuid('synthetic-opponent', { retry: false })
    ).rejects.toMatchObject({ response: { status: 503 } })
    expect(attempts).toBe(1)
    attempts = 0
    await expect(api.getRankedStatsByPuuid('synthetic-opponent')).rejects.toMatchObject({
      response: { status: 503 }
    })
    expect(attempts).toBe(3)
  })
})
