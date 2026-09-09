import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const akariRoot = process.cwd()
const workspaceRoot = path.dirname(akariRoot)

function listGitCandidates(repoRoot) {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) return []
  const gitArgs = [
    '-c',
    `safe.directory=${repoRoot.replaceAll('\\', '/')}`,
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z'
  ]
  return execFileSync('git', gitArgs, { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .map((file) => ({
      repoRoot,
      file,
      display: path.relative(workspaceRoot, path.join(repoRoot, file))
    }))
}

const candidates = [...listGitCandidates(akariRoot), ...listGitCandidates(workspaceRoot)]
const prohibitedPath =
  /(^|\/)(raw_data|analysis_output|outputs|exports|cache|caches|__pycache__)(\/|$)|\.log(?:\.|$)|\.(?:sqlite3?|db-wal|db-shm|py[co])$/i
const sensitiveTextPatterns = [
  {
    name: 'Riot ID',
    pattern: /['"][\p{L}\p{N}_. -]{3,32}#[A-Za-z0-9]{3,5}['"]/u
  },
  { name: 'PUUID-like identifier', pattern: /\b[A-Za-z0-9_-]{70,90}\b/ },
  { name: 'credential assignment', pattern: /\b(?:token|authorization)\s*[:=]\s*['"][^'"]{12,}/i }
]

const violations = candidates
  .filter(({ file }) => prohibitedPath.test(file.replaceAll('\\', '/')))
  .map(({ display }) => display)

for (const { repoRoot, file, display } of candidates) {
  const normalized = file.replaceAll('\\', '/')
  const isAkariProtectedText =
    repoRoot === akariRoot &&
    [
      'src/main/shards/member-analysis/',
      'src/shared/shards/member-analysis/',
      'src/renderer/src-main-window/shards/member-analysis/',
      'src/renderer/src-main-window/views/member-analysis/',
      'docs/fork/'
    ].some((root) => normalized.startsWith(root))
  const isWorkspaceSource =
    repoRoot === workspaceRoot &&
    !normalized.includes('/') &&
    /\.(?:py|mjs|ts|tsx)$/i.test(normalized)
  if (!isAkariProtectedText && !isWorkspaceSource) continue

  const fullPath = path.join(repoRoot, file)
  if (!fs.existsSync(fullPath)) continue
  const stat = fs.statSync(fullPath)
  if (!stat.isFile() || stat.size > 2_000_000) continue
  const content = fs.readFileSync(fullPath, 'utf8')
  for (const { name, pattern } of sensitiveTextPatterns) {
    if (pattern.test(content)) violations.push(`${display}: ${name}`)
  }
}

if (violations.length) {
  throw new Error(`Member-analysis data leak guard failed:\n${violations.join('\n')}`)
}

console.log(
  `Member-analysis data leak guard passed for ${candidates.length} tracked/candidate files across workspace and Akari repositories`
)
