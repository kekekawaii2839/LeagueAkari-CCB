import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const akariRoot = process.cwd()
const workspaceRoot = path.dirname(akariRoot)
const predictionLabRoot = path.join(akariRoot, 'packages', 'prediction-lab')

// The exact pinned Yarn distribution, not a vendor-directory or size exemption.
// Trusted source: main d3c0fcd8a6270aec1a843ca25782f7711421d618 and its Lab
// gitlink 5a8bc09504dd09048e6f8fd0e2779bec9e3ed7eb contain identical LF bytes.
// The second hash is derived only by LF -> CRLF conversion of that same blob,
// matching Git's Windows text checkout. Never derive trust from current candidates.
const pinnedToolPath = '.yarn/releases/yarn-4.18.0.cjs'
const pinnedToolHashes = new Set([
  'fb8b1d20be72a0b544a35bcec4c7ed0ff55a9b173c01f191b02ba164b2051db5',
  'e05616b2fb117f770896dcfe06912521f0f6de0fdc1be174dd1146fc74639abb'
])
let pinnedToolCandidates = 0

if (
  process.argv.slice(2).some((arg) => !['--worktree', '--index'].includes(arg)) ||
  (process.argv.includes('--worktree') && process.argv.includes('--index'))
) {
  throw new Error('Use --index (exact staged blobs), --worktree, or no option (both)')
}
const scanIndex = !process.argv.includes('--worktree')
const scanWorktree = !process.argv.includes('--index')

function git(repoRoot, args, encoding = 'utf8') {
  return execFileSync('git', ['-c', `safe.directory=${repoRoot.replaceAll('\\', '/')}`, ...args], {
    cwd: repoRoot,
    encoding,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  })
}
function listGitCandidates(repoRoot) {
  if (!fs.existsSync(path.join(repoRoot, '.git'))) return []
  const candidates = []
  const display = (file) => path.relative(workspaceRoot, path.join(repoRoot, file))
  if (scanIndex) {
    for (const record of git(repoRoot, ['ls-files', '--stage', '-z']).split('\0').filter(Boolean)) {
      const match = record.match(/^(\d+) ([a-f0-9]+) ([0-3])\t([\s\S]+)$/)
      if (!match) throw new Error('Cannot parse Git index')
      const [, fileMode, oid, stage, file] = match
      // Gitlinks are scanned in their independent checkout below, not as text blobs.
      if (fileMode === '160000') continue
      if (stage !== '0') throw new Error(`Unmerged index candidate: ${display(file)}`)
      candidates.push({ repoRoot, file, display: display(file), source: 'index', oid })
    }
  }
  if (scanWorktree) {
    for (const file of new Set(
      git(repoRoot, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        .split('\0')
        .filter(Boolean)
    )) {
      candidates.push({ repoRoot, file, display: display(file), source: 'worktree' })
    }
  }
  return candidates
}

// A gitlink/nested repository hides its contents from the parent ls-files scan.
// Inspect its own index and untracked candidates, including an unborn preparation checkout.
const candidates = [
  ...listGitCandidates(akariRoot),
  ...listGitCandidates(workspaceRoot),
  ...listGitCandidates(predictionLabRoot)
]
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
  .map(({ display, source }) => `${display} [${source}]`)

for (const { repoRoot, file, display, source, oid } of candidates) {
  const normalized = file.replaceAll('\\', '/')
  const isAkariProtectedText =
    repoRoot === akariRoot &&
    [
      'src/main/shards/member-analysis/',
      'src/shared/shards/member-analysis/',
      'src/renderer/src-main-window/shards/member-analysis/',
      'src/renderer/src-main-window/views/member-analysis/',
      'docs/fork/',
      'packages/prediction-lab/'
    ].some((root) => normalized.startsWith(root))
  const isWorkspaceSource =
    repoRoot === workspaceRoot &&
    !normalized.includes('/') &&
    /\.(?:py|mjs|ts|tsx)$/i.test(normalized)
  const isPredictionLabText = repoRoot === predictionLabRoot
  // Documentation outside docs/fork (including workspace guidance and Skills) is also
  // a publication candidate. Git supplies the boundary: do not walk ignored data or
  // dependencies, and do not treat generated/vendor Markdown as maintained guidance.
  const isMaintainedMarkdown =
    /\.(?:md|mdx|markdown)$/i.test(normalized) &&
    !/(^|\/)(?:node_modules|vendor|\.yarn|out|dist|build|storybook-static|\.runtime|userData)(\/|$)/i.test(
      normalized
    )
  if (
    normalized !== pinnedToolPath &&
    !isAkariProtectedText &&
    !isWorkspaceSource &&
    !isPredictionLabText &&
    !isMaintainedMarkdown
  )
    continue

  let bytes
  if (source === 'index') {
    bytes = git(repoRoot, ['cat-file', 'blob', oid], null)
  } else {
    const fullPath = path.join(repoRoot, file)
    if (!fs.existsSync(fullPath)) continue
    // Never follow a publication candidate symlink outside the source checkout.
    const stat = fs.lstatSync(fullPath)
    if (!stat.isFile()) continue
    bytes = fs.readFileSync(fullPath)
  }
  if (
    normalized === pinnedToolPath &&
    pinnedToolHashes.has(createHash('sha256').update(bytes).digest('hex'))
  ) {
    pinnedToolCandidates++
    continue
  }
  if (bytes.length > 2_000_000) {
    violations.push(`${display}: protected text exceeds scan limit [${source}]`)
    continue
  }
  const content = bytes.toString('utf8')
  for (const { name, pattern } of sensitiveTextPatterns) {
    if (pattern.test(content)) violations.push(`${display}: ${name} [${source}]`)
  }
}

if (violations.length) {
  throw new Error(`Member-analysis data leak guard failed:\n${violations.join('\n')}`)
}

console.log(
  `Member-analysis data leak guard passed for ${candidates.length} candidates; target=${scanIndex && scanWorktree ? 'index + worktree' : scanIndex ? 'index (exact staged blobs)' : 'worktree only (not commit assurance)'} across workspace, Akari and Prediction Lab repositories; exact pinned-tool byte exceptions=${pinnedToolCandidates}`
)
