import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from 'yaml'

const root = fileURLToPath(new URL('../../', import.meta.url))
const workflow = parse(readFileSync(path.join(root, '.github/workflows/upstream-sync.yml'), 'utf8'))
const steps = workflow.jobs.sync.steps
const requireRead = steps.find((step) => step.name === 'Require authorized private Lab read access')
const resolvePin = steps.find((step) => step.id === 'lab-pin')
const initialize = steps.find((step) => step.name === 'Initialize private Lab at the fixed gitlink')
const pinned = steps.find(
  (step) => step.name === 'Require pinned and clean Lab before dependency or runtime gates'
)
const run = (command, args, cwd, env = {}) =>
  spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    windowsHide: true
  })

test('workflow fails before checkout when private read prerequisite is missing, without printing credentials', () => {
  assert.equal(steps[0], requireRead)
  assert.equal(requireRead.env.LAB_READ_TOKEN, '${{ secrets.PREDICTION_LAB_READ_TOKEN }}')
  const missing = run('pwsh', ['-NoProfile', '-Command', requireRead.run], root, {
    LAB_READ_TOKEN: ''
  })
  assert.notEqual(missing.status, 0)
  assert.match(missing.stderr, /Missing PREDICTION_LAB_READ_TOKEN prerequisite/)
  const synthetic = 'synthetic-test-credential-not-real'
  const supplied = run('pwsh', ['-NoProfile', '-Command', requireRead.run], root, {
    LAB_READ_TOKEN: synthetic
  })
  assert.equal(supplied.status, 0, supplied.stderr)
  assert.equal((supplied.stdout + supplied.stderr).includes(synthetic), false)
})

test('workflow resolves a staged fixed gitlink and refuses missing pins in isolated repositories', () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'akari-sync-pin-'))
  try {
    assert.equal(run('git', ['init', '--quiet'], temp).status, 0)
    const output = path.join(temp, 'github-output')
    const resolve = () =>
      run('pwsh', ['-NoProfile', '-Command', resolvePin.run], temp, { GITHUB_OUTPUT: output })
    assert.notEqual(resolve().status, 0)
    const sha = 'a'.repeat(40)
    assert.equal(
      run(
        'git',
        ['update-index', '--add', '--cacheinfo', `160000,${sha},packages/prediction-lab`],
        temp
      ).status,
      0
    )
    const metadata = (url) =>
      writeFileSync(
        path.join(temp, '.gitmodules'),
        `[submodule "prediction-lab"]\npath = packages/prediction-lab\nurl = ${url}\n`
      )
    metadata('https://synthetic-untrusted.invalid/other-private-repo.git')
    const untrusted = resolve()
    assert.notEqual(untrusted.status, 0)
    assert.match(untrusted.stderr, /URL differs from the authorized fixed source/)
    metadata('https://github.com/kekekawaii2839/akari-prediction-lab.git')
    const result = resolve()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(readFileSync(output, 'utf8').trim(), `sha=${sha}`)
    // Resolving the pin alone is not acceptance: absent Lab must fail the real strict gate.
    const strict = run(
      process.execPath,
      [path.join(root, 'scripts/checks/check-prediction-lab-submodule.mjs'), '--require-pinned'],
      temp
    )
    assert.notEqual(strict.status, 0)
    assert.match(strict.stderr, /Lab sources are missing/)
    const conflicted = spawnSync('git', ['update-index', '--index-info'], {
      cwd: temp,
      input: `160000 ${sha} 1\tpackages/prediction-lab\n`,
      encoding: 'utf8',
      windowsHide: true
    })
    assert.equal(conflicted.status, 0, conflicted.stderr)
    const unmerged = resolve()
    assert.notEqual(unmerged.status, 0)
    assert.match(unmerged.stderr, /resolved fixed Prediction Lab gitlink is required/)
  } finally {
    assert.equal(path.dirname(path.resolve(temp)), path.resolve(tmpdir()))
    assert.ok(path.basename(temp).startsWith('akari-sync-pin-'))
    rmSync(temp, { recursive: true, force: true })
  }
})

test('private checkout uses the exact resolved revision before install/tests, and retains no read credential', () => {
  assert.equal(initialize.with.repository, 'kekekawaii2839/akari-prediction-lab')
  assert.equal(initialize.with.path, 'packages/prediction-lab')
  assert.equal(initialize.with.ref, '${{ steps.lab-pin.outputs.sha }}')
  assert.equal(initialize.with.token, '${{ secrets.PREDICTION_LAB_READ_TOKEN }}')
  assert.equal(initialize.with['persist-credentials'], false)
  assert.match(pinned.run, /--require-pinned/)
  const order = steps.map((step) => step.name)
  assert.ok(order.indexOf(resolvePin.name) < order.indexOf(initialize.name))
  assert.ok(order.indexOf(initialize.name) < order.indexOf(pinned.name))
  for (const name of [
    'Install dependencies',
    'Run tests and production build',
    'Build and scan the CCB Windows package'
  ])
    assert.ok(order.indexOf(pinned.name) < order.indexOf(name))
})
