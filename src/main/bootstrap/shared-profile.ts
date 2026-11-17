import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export const SHARED_PROFILE_MARKER = 'ccb-shared-profile.json'
// Change the epoch before introducing an incompatible persisted format. Shared profiles
// deliberately pin these versions instead of silently migrating a daily profile.
const compatibility = { storage: 15, catalog: 2, analysis: 2, ranks: 4, derivation: '5' }

interface ProfileApp {
  isPackaged: boolean
  getPath(name: 'appData' | 'userData'): string
  setPath(name: 'userData', value: string): void
}

/** Main-only, machine-local opt-in. Custom/synthetic userData is never redirected. */
export function selectSharedProfile(app: ProfileApp): string | null {
  const appData = app.getPath('appData')
  const target = join(appData, 'League Akari CCB')
  const current = resolve(app.getPath('userData'))
  const defaultPath = app.isPackaged ? target : join(appData, 'league-akari')
  if (current !== resolve(defaultPath)) return null
  const marker = join(target, SHARED_PROFILE_MARKER)
  if (!existsSync(marker)) return null
  if (
    lstatSync(target).isSymbolicLink() ||
    realpathSync(target) !== join(realpathSync(appData), 'League Akari CCB') ||
    lstatSync(marker).isSymbolicLink() ||
    !lstatSync(marker).isFile() ||
    lstatSync(marker).size > 4096
  )
    throw new Error('Invalid CCB shared profile location')
  const value = JSON.parse(readFileSync(marker, 'utf8'))
  if (
    value?.schemaVersion !== 1 ||
    value?.compatibilityEpoch !== 1 ||
    value?.state !== 'ready' ||
    Object.entries(compatibility).some(([key, version]) => value.compatibility?.[key] !== version)
  )
    throw new Error('CCB shared profile is incompatible or its merge is incomplete')
  app.setPath('userData', target)
  return target
}

/** Must run after the Electron profile lock, before any shard opens storage. */
export function checkSharedProfileCompatibility(root: string): void {
  const check = (relativePath: string, verify: (database: DatabaseSync) => boolean) => {
    const path = join(root, relativePath)
    if (!existsSync(path)) throw new Error('Shared database is missing; recovery is required')
    let part = root
    for (const segment of relative(root, path).split(sep)) {
      part = join(part, segment)
      if (lstatSync(part).isSymbolicLink()) throw new Error('Invalid shared database location')
    }
    if (lstatSync(path).nlink > 1) throw new Error('Invalid shared database location')
    const database = new DatabaseSync(path, { readOnly: true })
    try {
      if (!verify(database)) throw new Error('CCB shared data requires a compatible application')
    } finally {
      database.close()
    }
  }
  check('LeagueAkari.db', (db) => {
    const row = db.prepare("SELECT value FROM Metadata WHERE key='version'").get()
    return Number(row?.value) === compatibility.storage
  })
  for (const [name, version] of [
    ['catalog', compatibility.catalog],
    ['analysis', compatibility.analysis],
    ['opponent-ranks', compatibility.ranks]
  ] as const) {
    check(`member-analysis/db/${name}.sqlite3`, (db) => {
      if (db.prepare('PRAGMA user_version').get()?.user_version !== version) return false
      return (
        name !== 'analysis' ||
        db.prepare("SELECT value FROM metadata WHERE key='derivation_version'").get()?.value ===
          compatibility.derivation
      )
    })
  }
}
