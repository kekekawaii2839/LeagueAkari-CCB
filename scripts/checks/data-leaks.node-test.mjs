import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
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

function stage(root, file) {
  assert.equal(run('git', ['add', '--', file], root).status, 0)
}

test('exact index blobs and worktree bytes are independently labelled across all repositories', () => {
  withRepositories(({ workspace, akari }) => {
    const lab = path.join(akari, 'packages/prediction-lab')
    mkdirSync(lab, { recursive: true })
    assert.equal(run('git', ['init', '--quiet'], lab).status, 0)
    for (const root of [workspace, akari, lab]) {
      const file = path.join(root, 'fixture.md')
      writeFileSync(file, '"SyntheticPlayer#DEMO"')
      stage(root, 'fixture.md')
      writeFileSync(file, 'safe working tree')
    }
    for (const entry of entrypoints) {
      const index = run(process.execPath, [entry, '--index'], akari)
      assert.equal(index.status, 1)
      assert.match(index.stderr, /fixture\.md: Riot ID \[index\]/)
      assert.equal(index.stderr.includes('SyntheticPlayer#DEMO'), false)
      const worktree = run(process.execPath, [entry, '--worktree'], akari)
      assert.equal(worktree.status, 0, worktree.stderr)
      assert.match(worktree.stdout, /worktree only \(not commit assurance\)/)
      assert.equal(run(process.execPath, [entry], akari).status, 1)
    }
    for (const root of [workspace, akari, lab]) {
      writeFileSync(path.join(root, 'fixture.md'), 'safe staged bytes')
      stage(root, 'fixture.md')
      writeFileSync(path.join(root, 'fixture.md'), '"SyntheticPlayer#DEMO"')
    }
    assert.equal(run(process.execPath, [entrypoints[0], '--index'], akari).status, 0)
    const result = run(process.execPath, [entrypoints[0], '--worktree'], akari)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Riot ID \[worktree\]/)
  })
})

test('add, modify, delete and rename inspect actual staged candidates, even when disk diverges', () => {
  withRepositories(({ akari }) => {
    const entry = entrypoints[0]
    const scan = () => run(process.execPath, [entry, '--index'], akari)
    writeFileSync(path.join(akari, 'fixture.md'), 'safe')
    stage(akari, 'fixture.md')
    assert.equal(scan().status, 0)
    writeFileSync(path.join(akari, 'fixture.md'), '"SyntheticPlayer#DEMO"')
    stage(akari, 'fixture.md')
    unlinkSync(path.join(akari, 'fixture.md'))
    assert.equal(scan().status, 1, 'unstaged deletion must not hide staged bytes')
    stage(akari, 'fixture.md')
    assert.equal(scan().status, 0, 'staged deletion removes candidate')
    writeFileSync(path.join(akari, 'original.md'), '"SyntheticPlayer#DEMO"')
    stage(akari, 'original.md')
    renameSync(path.join(akari, 'original.md'), path.join(akari, 'renamed.md'))
    stage(akari, 'original.md')
    stage(akari, 'renamed.md')
    writeFileSync(path.join(akari, 'renamed.md'), 'safe disk')
    const result = scan()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /renamed\.md: Riot ID \[index\]/)
    assert.equal(result.stderr.includes('original.md'), false)
  })
})

test('unmerged index stages cannot be mistaken for a publishable snapshot', () => {
  withRepositories(({ akari }) => {
    writeFileSync(path.join(akari, 'fixture.md'), 'safe')
    stage(akari, 'fixture.md')
    const oid = run('git', ['rev-parse', ':fixture.md'], akari).stdout.trim()
    const update = spawnSync('git', ['update-index', '--index-info'], {
      cwd: akari,
      input: `100644 ${oid} 1\tconflict.md\n`,
      encoding: 'utf8',
      windowsHide: true
    })
    assert.equal(update.status, 0, update.stderr)
    const result = run(process.execPath, [entrypoints[0], '--index'], akari)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Unmerged index candidate/)
  })
})

test('only exact fixed Yarn distribution bytes are exempt; altered tools and other large sources fail closed', () => {
  const distribution = readFileSync(path.join(scriptsRoot, '../.yarn/releases/yarn-4.18.0.cjs'))
  const hash = (bytes) => createHash('sha256').update(bytes).digest('hex')
  const trusted = [
    'fb8b1d20be72a0b544a35bcec4c7ed0ff55a9b173c01f191b02ba164b2051db5',
    'e05616b2fb117f770896dcfe06912521f0f6de0fdc1be174dd1146fc74639abb'
  ]
  assert.ok(
    trusted.includes(hash(distribution)),
    'fixture input must already match an independently fixed hash'
  )
  const lf = Buffer.from(distribution.toString('utf8').replaceAll('\r\n', '\n'))
  assert.equal(hash(lf), trusted[0])
  withRepositories(({ akari }) => {
    const lab = path.join(akari, 'packages/prediction-lab')
    mkdirSync(path.join(lab, '.yarn/releases'), { recursive: true })
    assert.equal(run('git', ['init', '--quiet'], lab).status, 0)
    const mainTool = path.join(akari, '.yarn/releases/yarn-4.18.0.cjs')
    mkdirSync(path.dirname(mainTool), { recursive: true })
    writeFileSync(mainTool, lf)
    stage(akari, '.yarn/releases/yarn-4.18.0.cjs')
    const target = path.join(lab, '.yarn/releases/yarn-4.18.0.cjs')
    const scan = () => run(process.execPath, [entrypoints[0]], akari)
    writeFileSync(target, lf)
    stage(lab, '.yarn/releases/yarn-4.18.0.cjs')
    let result = scan()
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /exact pinned-tool byte exceptions=4/)
    writeFileSync(target, Buffer.from(lf.toString('utf8').replace(/\r?\n/g, '\r\n')))
    assert.equal(scan().status, 0)
    const changed = Buffer.from(lf)
    changed[0] ^= 1
    writeFileSync(target, changed)
    assert.equal(scan().status, 1, 'same path with altered bytes is not a trusted tool')
    writeFileSync(target, lf)
    writeFileSync(mainTool, changed)
    assert.equal(scan().status, 1, 'the Akari tool path is guarded as well as Lab')
    writeFileSync(mainTool, lf)
    writeFileSync(target, Buffer.concat([lf, Buffer.from('\n"SyntheticPlayer#DEMO"')]))
    stage(lab, '.yarn/releases/yarn-4.18.0.cjs')
    writeFileSync(target, lf)
    result = scan()
    assert.equal(result.status, 1, 'trusted disk bytes cannot conceal modified staged tool bytes')
    assert.match(result.stderr, /exceeds scan limit \[index\]/)
    writeFileSync(target, lf)
    stage(lab, '.yarn/releases/yarn-4.18.0.cjs')
    writeFileSync(path.join(lab, 'other-tool.cjs'), lf)
    result = scan()
    assert.equal(result.status, 1, 'identical vendor bytes at another path are not exempt')
    assert.match(result.stderr, /other-tool\.cjs: protected text exceeds scan limit/)
    unlinkSync(path.join(lab, 'other-tool.cjs'))
    writeFileSync(path.join(lab, 'oversized-source.ts'), Buffer.alloc(2_000_001, 65))
    result = scan()
    assert.equal(result.status, 1)
    assert.match(result.stderr, /oversized-source\.ts: protected text exceeds scan limit/)
  })
})
