import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

function sources(root: string): string[] {
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name)
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|vue)$/.test(name) ? [path] : []
  })
}

describe('member analysis process boundary', () => {
  test('does not introduce a browser or loopback HTTP listener', () => {
    const featureRoot = __dirname
    const text = sources(featureRoot)
      .filter((path) => !path.endsWith('architecture.test.ts'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n')
    expect(text).not.toMatch(/createServer\s*\(|listen\s*\(.*127\.0\.0\.1|LoopbackAdapter/)
  })
})
