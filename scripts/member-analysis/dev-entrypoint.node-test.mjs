import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test(
  'legacy dev entrypoint forwards parameters, exit codes and errors',
  {
    skip: process.platform !== 'win32'
  },
  () => {
    const root = mkdtempSync(path.join(tmpdir(), 'akari-dev-entrypoint-test-'))
    try {
      mkdirSync(path.join(root, 'member-analysis'))
      const entry = path.join(root, 'start-member-analysis-dev.ps1')
      copyFileSync(
        fileURLToPath(new URL('../start-member-analysis-dev.ps1', import.meta.url)),
        entry
      )
      // Replace the delegate in the disposable fixture, never launch Electron or Yarn.
      writeFileSync(
        path.join(root, 'member-analysis/start-member-analysis-dev.ps1'),
        `
param([string]$Python, [switch]$NoWatch, [switch]$CheckOnly)
if ($Python -eq 'synthetic-failure') { throw 'SYNTHETIC_DEV_FAILURE' }
@{ Python = $Python; NoWatch = [bool]$NoWatch; CheckOnly = [bool]$CheckOnly } | ConvertTo-Json -Compress
exit 37
`
      )
      const run = (python) => {
        const result = spawnSync(
          'powershell',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            entry,
            '-Python',
            python,
            '-NoWatch',
            '-CheckOnly'
          ],
          { encoding: 'utf8', windowsHide: true }
        )
        if (result.error) throw result.error
        return result
      }
      const forwarded = run('synthetic runtime path')
      assert.equal(forwarded.status, 37, forwarded.stderr)
      assert.deepEqual(JSON.parse(forwarded.stdout.trim()), {
        Python: 'synthetic runtime path',
        NoWatch: true,
        CheckOnly: true
      })
      const failure = run('synthetic-failure')
      assert.equal(failure.status, 1)
      assert.match(failure.stderr, /SYNTHETIC_DEV_FAILURE/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  }
)
