import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const scriptsRoot = fileURLToPath(new URL('../', import.meta.url))
const entrypoints = [
  path.join(scriptsRoot, 'checks/check-member-analysis-data-leaks.mjs'),
  path.join(scriptsRoot, 'check-member-analysis-data-leaks.mjs')
]

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true })
  if (result.error) throw result.error
  return result
}

function withRepositories(check) {
  const workspace = mkdtempSync(path.join(tmpdir(), 'akari-script-test-'))
  const akari = path.join(workspace, 'akari-src')
  try {
    mkdirSync(akari)
    for (const root of [workspace, akari]) {
      assert.equal(run('git', ['init', '--quiet'], root).status, 0)
      writeFileSync(path.join(root, '.gitignore'), 'raw_data/\n*.log\n')
    }
    check({ workspace, akari })
  } finally {
    // Only remove the unique disposable fixture created by this test.
    rmSync(workspace, { recursive: true, force: true })
  }
}

test('both leak-check entrypoints honor caller cwd and ignore private artifacts', () => {
  withRepositories(({ workspace, akari }) => {
    for (const root of [workspace, akari]) {
      mkdirSync(path.join(root, 'raw_data'))
      writeFileSync(path.join(root, 'raw_data', 'synthetic.json'), '"SyntheticPlayer#DEMO"')
    }
    writeFileSync(path.join(workspace, 'synthetic.py'), 'value = 0\n')
    for (const entry of entrypoints) {
      const result = run(process.execPath, [entry], akari)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /Member-analysis data leak guard passed/)
    }
  })
})

test('both entrypoints still detect candidates in native and parent repositories', () => {
  withRepositories(({ workspace, akari }) => {
    const feature = path.join(akari, 'src/main/shards/member-analysis')
    mkdirSync(feature, { recursive: true })
    writeFileSync(path.join(feature, 'synthetic.ts'), 'const player = "SyntheticPlayer#DEMO"\n')
    writeFileSync(path.join(workspace, 'synthetic.py'), 'token = "synthetic-only-secret"\n')
    for (const entry of entrypoints) {
      const result = run(process.execPath, [entry], akari)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /synthetic\.ts: Riot ID/)
      assert.match(result.stderr, /synthetic\.py: credential assignment/)
    }
  })
})

test('nested independent Lab cannot bypass either entrypoint before a first commit', () => {
  withRepositories(({ akari }) => {
    const lab = path.join(akari, 'packages/prediction-lab')
    mkdirSync(lab, { recursive: true })
    assert.equal(run('git', ['init', '--quiet'], lab).status, 0)
    writeFileSync(path.join(lab, '.gitignore'), '.runtime/\n')
    mkdirSync(path.join(lab, '.runtime'))
    writeFileSync(path.join(lab, '.runtime/ignored.ts'), '"SyntheticPlayer#DEMO"')
    for (const entry of entrypoints) {
      assert.equal(run(process.execPath, [entry], akari).status, 0)
    }
    writeFileSync(path.join(lab, 'synthetic.ts'), 'const player = "SyntheticPlayer#DEMO"\n')
    for (const entry of entrypoints) {
      const result = run(process.execPath, [entry], akari)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /prediction-lab[\\/]synthetic\.ts: Riot ID/)
    }
  })
})

test('maintained Markdown candidates across repositories are checked without echoing values', () => {
  withRepositories(({ workspace, akari }) => {
    const lab = path.join(akari, 'packages/prediction-lab')
    mkdirSync(lab, { recursive: true })
    assert.equal(run('git', ['init', '--quiet'], lab).status, 0)
    const skill = path.join(akari, '.agents/skills/synthetic')
    mkdirSync(skill, { recursive: true })
    const secret = 'synthetic-only-doc-secret'
    writeFileSync(path.join(workspace, 'guide.mdx'), '"SyntheticPlayer#DEMO"\n')
    writeFileSync(path.join(skill, 'SKILL.md'), `token = "${secret}"\n`)
    writeFileSync(path.join(lab, 'guide.markdown'), `authorization = "${secret}"\n`)
    assert.equal(run('git', ['add', 'guide.markdown'], lab).status, 0)
    for (const entry of entrypoints) {
      const result = run(process.execPath, [entry], akari)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /guide\.mdx: Riot ID/)
      assert.match(result.stderr, /SKILL\.md: credential assignment/)
      assert.match(result.stderr, /guide\.markdown: credential assignment/)
      assert.equal(result.stderr.includes(secret), false)
      assert.equal(result.stderr.includes('SyntheticPlayer#DEMO'), false)
    }
  })
})

test('documentation scan honors Git ignores, vendor boundaries and ordinary privacy guidance', () => {
  withRepositories(({ workspace, akari }) => {
    writeFileSync(path.join(workspace, '.gitignore'), 'raw_data/\n*.log\nprivate-notes/\n')
    mkdirSync(path.join(workspace, 'private-notes'))
    writeFileSync(path.join(workspace, 'private-notes/guide.md'), '"SyntheticPlayer#DEMO"\n')
    for (const folder of ['vendor', 'node_modules', 'out', 'userData']) {
      mkdirSync(path.join(akari, folder))
      writeFileSync(path.join(akari, folder, 'guide.md'), '"SyntheticPlayer#DEMO"\n')
    }
    writeFileSync(path.join(akari, 'AGENTS.md'), 'Never commit tokens or player data.\n')
    writeFileSync(path.join(workspace, 'README.md'), 'Only synthetic fixtures belong in Git.\n')
    for (const entry of entrypoints) {
      const result = run(process.execPath, [entry], akari)
      assert.equal(result.status, 0, result.stderr)
    }
    // Ignore does not protect a file already added to the index.
    assert.equal(run('git', ['add', '-f', 'private-notes/guide.md'], workspace).status, 0)
    for (const entry of entrypoints) {
      const result = run(process.execPath, [entry], akari)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /private-notes[\\/]guide\.md: Riot ID/)
    }
  })
})
