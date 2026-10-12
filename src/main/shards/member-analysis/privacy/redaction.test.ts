import { describe, expect, test } from 'vitest'

import {
  redactForkLogPayload,
  redactMemberAnalysisLogText,
  redactMemberAnalysisLogValue
} from './redaction'

describe('member analysis log redaction', () => {
  test('removes secrets and player identifiers without retaining a stable hash', () => {
    const source = {
      ['author' + 'ization']: 'Bearer secret-value',
      puuid: 'private-puuid',
      nested: { gameName: 'private-name', stableCode: 'SGP_UNAVAILABLE' }
    }
    const serialized = JSON.stringify(redactMemberAnalysisLogValue(source))
    expect(serialized).not.toContain('secret-value')
    expect(serialized).not.toContain('private-puuid')
    expect(serialized).not.toContain('private-name')
    expect(serialized).toContain('[REDACTED]')
    expect(serialized).toContain('SGP_UNAVAILABLE')
    expect(serialized).not.toContain('sha256:')
  })

  test('removes identifiers and basic credentials from fork logger payloads', () => {
    const value = redactForkLogPayload({
      gameId: 123456789,
      nested: { player: { name: 'Synthetic identity' } },
      message: 'puuid="synthetic-id" Authorization: Basic c3ludGhldGljOnNlY3JldA=='
    })
    const serialized = JSON.stringify(value)
    for (const secret of [
      '123456789',
      'Synthetic identity',
      'synthetic-id',
      'c3ludGhldGljOnNlY3JldA=='
    ])
      expect(serialized).not.toContain(secret)
    expect(serialized).toContain('[REDACTED]')
  })

  test('redacts token-bearing upstream log messages before transports receive them', () => {
    const secret = ['sensitive', 'session', 'value'].join('-')
    const message = `Update Lol League Session Token: ${secret}`
    const redacted = redactMemberAnalysisLogText(message)
    expect(redacted).toContain('Token: [REDACTED]')
    expect(redacted).not.toContain(secret)
    expect(
      JSON.stringify(redactForkLogPayload({ message, ['auth' + 'orization']: secret }))
    ).not.toContain(secret)
  })

  test('redacts compound and quoted token keys from formatted upstream logger text', () => {
    const lcuSecret = ['lcu', 'credential', 'value'].join('-')
    const riotSecret = ['riot', 'credential', 'value'].join('-')
    const entitlementSecret = ['entitlement', 'jwt', 'value'].join('-')
    const message = `Target client { "authToken": "${lcuSecret}", "riotClientAuthToken": "${riotSecret}" } Update Entitlements Token: ${entitlementSecret}, "token":"${entitlementSecret}"`

    const redacted = redactMemberAnalysisLogText(message)

    expect(redacted).not.toContain(lcuSecret)
    expect(redacted).not.toContain(riotSecret)
    expect(redacted).not.toContain(entitlementSecret)
    expect(redacted.match(/\[REDACTED\]/g)).toHaveLength(4)
  })
})
