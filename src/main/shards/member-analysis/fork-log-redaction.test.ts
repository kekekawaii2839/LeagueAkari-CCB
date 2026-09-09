import { describe, expect, test, vi } from 'vitest'

import { installForkLogRedaction } from './fork-log-redaction'

describe('fork-wide log redaction installation', () => {
  test('sanitizes upstream namespace messages before the logger transport', () => {
    const info = vi.fn()
    const logger = { info } as any
    installForkLogRedaction(logger)
    const secret = ['long', 'session', 'credential'].join('-')
    logger.info({ namespace: 'sgp-main', message: `Session Token: ${secret}` })
    expect(info).toHaveBeenCalledWith({
      namespace: 'sgp-main',
      message: 'Session Token: [REDACTED]'
    })
  })
})
