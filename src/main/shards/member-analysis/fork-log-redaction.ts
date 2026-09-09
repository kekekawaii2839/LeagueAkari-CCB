import type { Logger } from 'winston'

import { redactForkLogPayload } from './redaction'

const LEVEL_METHODS = ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'] as const

export function installForkLogRedaction(logger: Logger) {
  for (const level of LEVEL_METHODS) {
    const original = logger[level]
    if (typeof original !== 'function') continue
    logger[level] = ((...args: unknown[]) =>
      original.apply(logger, args.map(redactForkLogPayload) as any)) as typeof original
  }
  return logger
}
