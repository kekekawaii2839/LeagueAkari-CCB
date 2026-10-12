import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

/** Freeze actual maintained source before study creation. A change stops enrollment, never resets it. */
export function nativePredictionFingerprint(projectRoot: string) {
  const files: string[] = []
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (lstatSync(path).isSymbolicLink()) throw Error('Prediction source fingerprint rejected')
      if (entry.isDirectory()) walk(path)
      else if (/\.(?:ts|mts|mjs|json)$/.test(entry.name)) files.push(path)
    }
  }
  for (const directory of [
    'packages/prediction-lab/src',
    'packages/prediction-lab/runner',
    'src/main/shards/member-analysis'
  ])
    walk(join(projectRoot, directory))
  for (const path of [
    'electron.vite.config.ts',
    'src/renderer/src-main-window/shards/member-analysis/index.ts',
    'src/shared/shards/member-analysis/prediction.ts'
  ])
    files.push(join(projectRoot, path))
  return {
    code: hash(
      JSON.stringify(
        files
          .sort()
          .map((path) => [
            relative(projectRoot, path).replaceAll('\\', '/'),
            hash(readFileSync(path, 'utf8'))
          ])
      )
    ),
    protocol: hash(
      readFileSync(
        join(projectRoot, 'packages/prediction-lab/manifests/prospective-capture-pilot-v1.json'),
        'utf8'
      )
    )
  }
}
