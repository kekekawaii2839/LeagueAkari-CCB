import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const labPath = 'packages/prediction-lab'

function git(root, ...args) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }).trim()
  } catch {
    return null
  }
}

export function readPredictionLabState(root) {
  const lab = path.resolve(root, labPath)
  const present = existsSync(lab) && !lstatSync(lab).isSymbolicLink()
  const top = present ? git(lab, 'rev-parse', '--show-toplevel') : null
  const stage = git(root, 'ls-files', '--stage', '--', labPath) ?? ''
  const gitlink = stage.match(/^160000 ([a-f0-9]{40}) 0\tpackages\/prediction-lab$/m)?.[1] ?? null
  const modules = path.join(root, '.gitmodules')
  const url = existsSync(modules)
    ? git(root, 'config', '--file', modules, '--get', 'submodule.prediction-lab.url')
    : null
  const configuredPath = existsSync(modules)
    ? git(root, 'config', '--file', modules, '--get', 'submodule.prediction-lab.path')
    : null
  return {
    sourceReady:
      present &&
      ['package.json', 'src/metrics.ts', 'runner/opportunity-ledger.mjs', 'build.mjs'].every(
        (file) => existsSync(path.join(lab, file))
      ),
    independent: top !== null && path.resolve(top) === lab && existsSync(path.join(lab, '.git')),
    head: present ? git(lab, 'rev-parse', '--verify', 'HEAD') : null,
    gitlink,
    dirty: present ? (git(lab, 'status', '--porcelain=v1', '-uall') ?? 'unavailable') !== '' : true,
    parentTracksSource: stage.split('\n').some((line) => line && !line.startsWith('160000 ')),
    configured: Boolean(url) && configuredPath === labPath
  }
}

export function evaluatePredictionLabState(state, requirePinned = false) {
  const errors = []
  const pending = []
  if (!state.sourceReady)
    errors.push('Lab sources are missing or linked; initialize the real checkout')
  if (!state.independent) errors.push('Lab is not an independent Git checkout')
  if (state.parentTracksSource) errors.push('Parent index still tracks Lab source files')
  if (!state.head) pending.push('Lab has no initial commit')
  if (!state.gitlink) pending.push('Akari has no staged gitlink')
  else if (state.gitlink !== state.head) errors.push('Lab HEAD differs from the Akari gitlink')
  if (!state.configured) pending.push('Submodule URL/path is not configured')
  if (state.dirty) pending.push('Lab has uncommitted changes')
  if (requirePinned) errors.push(...pending)
  return {
    ok: errors.length === 0,
    pinned: errors.length === 0 && pending.length === 0,
    errors,
    pending
  }
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const result = evaluatePredictionLabState(
    readPredictionLabState(process.cwd()),
    process.argv.includes('--require-pinned')
  )
  if (!result.ok) {
    console.error(`Prediction Lab integration check failed:\n${result.errors.join('\n')}`)
    process.exitCode = 1
  } else {
    console.log(
      result.pinned
        ? 'Prediction Lab submodule is pinned and clean'
        : 'Prediction Lab preparation is present; NOT a pinned submodule'
    )
    for (const item of result.pending) console.log(`Pending: ${item}`)
  }
}
