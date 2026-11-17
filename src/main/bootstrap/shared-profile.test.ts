import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

import {
  SHARED_PROFILE_MARKER,
  checkSharedProfileCompatibility,
  selectSharedProfile
} from './shared-profile'

const roots: string[] = []
function fixture(packaged = false) {
  const root = mkdtempSync(join(tmpdir(), 'ccb-profile-test-'))
  roots.push(root)
  const target = join(root, 'League Akari CCB')
  mkdirSync(target)
  let userData = packaged ? target : join(root, 'league-akari')
  const app = {
    isPackaged: packaged,
    getPath: (name: 'appData' | 'userData') => (name === 'appData' ? root : userData),
    setPath: (_name: 'userData', value: string) => {
      userData = value
    }
  }
  const marker = {
    schemaVersion: 1,
    compatibilityEpoch: 1,
    state: 'ready',
    compatibility: { storage: 15, catalog: 2, analysis: 2, ranks: 4, derivation: '5' }
  }
  const enable = () => writeFileSync(join(target, SHARED_PROFILE_MARKER), JSON.stringify(marker))
  const databases = () => {
    mkdirSync(join(target, 'member-analysis/db'), { recursive: true })
    for (const [file, sql] of [
      [
        'LeagueAkari.db',
        "CREATE TABLE Metadata(key TEXT,value TEXT); INSERT INTO Metadata VALUES('version','15');"
      ],
      ['member-analysis/db/catalog.sqlite3', 'PRAGMA user_version=2;'],
      [
        'member-analysis/db/analysis.sqlite3',
        "PRAGMA user_version=2; CREATE TABLE metadata(key TEXT,value TEXT); INSERT INTO metadata VALUES('derivation_version','5');"
      ],
      ['member-analysis/db/opponent-ranks.sqlite3', 'PRAGMA user_version=4;']
    ]) {
      const db = new DatabaseSync(join(target, file))
      db.exec(sql)
      db.close()
    }
  }
  return { root, target, app, marker, enable, databases }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('machine-local shared CCB profile', () => {
  it('keeps the existing default unless an explicit ready marker exists', () => {
    const f = fixture()
    expect(selectSharedProfile(f.app)).toBeNull()
    expect(f.app.getPath('userData')).toBe(join(f.root, 'league-akari'))
    f.enable()
    expect(selectSharedProfile(f.app)).toBe(f.target)
    expect(f.app.getPath('userData')).toBe(f.target)
  })
  it('uses the same profile for a packaged CCB', () => {
    const f = fixture(true)
    f.enable()
    expect(selectSharedProfile(f.app)).toBe(f.target)
  })
  it('never redirects an isolated/synthetic profile', () => {
    const f = fixture()
    f.enable()
    const isolated = join(f.root, 'isolated')
    f.app.setPath('userData', isolated)
    expect(selectSharedProfile(f.app)).toBeNull()
    expect(f.app.getPath('userData')).toBe(isolated)
  })
  it.each(['pending', 'future'])('fails closed for %s configuration', (state) => {
    const f = fixture()
    if (state === 'pending') f.marker.state = 'merging'
    else f.marker.compatibilityEpoch = 2
    f.enable()
    expect(() => selectSharedProfile(f.app)).toThrow(/incompatible/)
    expect(f.app.getPath('userData')).toBe(join(f.root, 'league-akari'))
  })
  it('rejects an incompatible database without changing its version or contents', () => {
    const f = fixture()
    f.databases()
    const directory = join(f.target, 'member-analysis/db')
    const path = join(directory, 'catalog.sqlite3')
    const db = new DatabaseSync(path)
    db.exec('PRAGMA user_version=99; CREATE TABLE private_facts(value TEXT);')
    db.close()
    const before = readFileSync(path)
    expect(() => checkSharedProfileCompatibility(f.target)).toThrow(/compatible/)
    expect(readFileSync(path)).toEqual(before)
  })
  it('accepts matching storage versions and rejects future derivation', () => {
    const f = fixture()
    f.databases()
    const directory = join(f.target, 'member-analysis/db')
    const path = join(directory, 'analysis.sqlite3')
    expect(() => checkSharedProfileCompatibility(f.target)).not.toThrow()
    const newer = new DatabaseSync(path)
    newer.exec("UPDATE metadata SET value='6'")
    newer.close()
    expect(() => checkSharedProfileCompatibility(f.target)).toThrow(/compatible/)
  })
  it('does not silently create a missing shared database', () => {
    const f = fixture()
    expect(() => checkSharedProfileCompatibility(f.target)).toThrow(/missing/)
  })
})
