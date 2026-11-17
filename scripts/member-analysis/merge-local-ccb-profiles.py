"""Explicit offline CCB profile merge; never an IPC or startup migration.

Original Dev stays untouched. Original installed profile is retained by rename.
Only known business roots are copied; browser state, downloads and logs are not
shared. Conflicts prefer daily Dev; their original values remain in both originals.
Schema differences, raw checksum conflicts, active processes and unsafe paths stop
the operation. No identities, payloads or raw filenames are printed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import uuid

MARKER = 'ccb-shared-profile.json'
ROOTS = ('AkariConfig', 'member-analysis', 'champion-pool', 'prediction-lab')
FILES = ('LeagueAkari.db', 'base-config.json')
COMPATIBILITY = dict(storage=15, catalog=2, analysis=2, ranks=4, derivation='5')


class ProfileMergeError(ValueError):
    pass


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def safe_tree(root):
    if root.is_symlink() or root.resolve() != root.absolute():
        raise ProfileMergeError('Profile path must be canonical, not a link')
    for base, directories, files in os.walk(root):
        for name in directories + files:
            path = Path(base) / name
            info = path.lstat()
            if path.is_symlink() or getattr(info, 'st_file_attributes', 0) & 0x400:
                raise ProfileMergeError('Linked profile entries are not supported')
            if path.is_file() and info.st_nlink > 1:
                raise ProfileMergeError('Hard-linked profile entries are not supported')


def readonly(path):
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db


def layout(db):
    return {r[0]: db.execute('SELECT sql FROM sqlite_master WHERE name=?', (r[0],)).fetchone()[0]
            for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}


def table_rows(db, name):
    return [dict(row) for row in db.execute('SELECT * FROM "' + name + '"')]


def version(db):
    return db.execute('PRAGMA user_version').fetchone()[0]


def integrity(db):
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise ProfileMergeError('Database integrity check failed')


def verify_versions(root):
    for relative, expected in [('LeagueAkari.db', 0),
                               ('member-analysis/db/catalog.sqlite3', 2),
                               ('member-analysis/db/analysis.sqlite3', 2),
                               ('member-analysis/db/opponent-ranks.sqlite3', 4)]:
        path = root / relative
        if not path.exists():
            continue
        db = readonly(path)
        try:
            integrity(db)
            if version(db) != expected:
                raise ProfileMergeError('Unsupported profile schema; migrate with a compatible application first')
            if relative == 'LeagueAkari.db':
                if int(db.execute("SELECT value FROM Metadata WHERE key='version'").fetchone()[0]) != 15:
                    raise ProfileMergeError('Unsupported application storage schema')
            elif relative.endswith('/analysis.sqlite3'):
                meta = dict(db.execute('SELECT key,value FROM metadata'))
                if meta.get('derivation_version') != '5' or meta.get('identity_facts_state') != 'verified-v1':
                    raise ProfileMergeError('Only current verified analysis snapshots can be merged')
                count = db.execute('SELECT COUNT(*) FROM derived_games').fetchone()[0]
                if str(count) != meta.get('identity_facts_count') or count != db.execute('SELECT COUNT(*) FROM game_identity_facts').fetchone()[0]:
                    raise ProfileMergeError('Incomplete identity fact coverage')
        finally:
            db.close()


def snapshot_file(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.suffix in ('.db', '.sqlite3'):
        src = readonly(source)
        dst = sqlite3.connect(target)
        try:
            src.backup(dst)
            integrity(dst)
        finally:
            dst.close()
            src.close()
    else:
        before = source.stat()
        shutil.copy2(source, target)
        if digest(source) != digest(target) or source.stat().st_mtime_ns != before.st_mtime_ns:
            raise ProfileMergeError('Source changed while copying')


def copy_business(source, stage, prefer_existing):
    conflicts = 0
    for entry in ROOTS + FILES:
        path = source / entry
        if not path.exists():
            continue
        files = sorted(p for p in path.rglob('*') if p.is_file()) if path.is_dir() else [path]
        for file in files:
            if file.name.endswith(('-wal', '-shm', '-journal')):
                continue
            destination = stage / file.relative_to(source)
            if destination.exists() and prefer_existing:
                if file.suffix not in ('.db', '.sqlite3') and digest(file) != digest(destination):
                    conflicts += 1
                continue
            snapshot_file(file, destination)
    return conflicts


def source_signature(root):
    result = {}
    for entry in ROOTS + FILES:
        path = root / entry
        if not path.exists():
            continue
        files = path.rglob('*') if path.is_dir() else [path]
        for file in files:
            if file.is_file() and not file.name.endswith('-shm'):
                info = file.stat()
                result[str(file.relative_to(root))] = (info.st_size, info.st_mtime_ns)
    return result


def insert(db, table, row, replace=True):
    columns = list(row)
    db.execute('INSERT ' + ('OR REPLACE ' if replace else '') + 'INTO "' + table + '" (' +
               ','.join('"' + c + '"' for c in columns) + ') VALUES (' + ','.join('?' for _ in columns) + ')',
               [row[c] for c in columns])


def union_table(dst, source, table, keys, prefer_newer=None, immutable=False):
    indexed = {tuple(r[k] for k in keys): r for r in table_rows(dst, table)}
    added = conflicts = 0
    for row in table_rows(source, table):
        key = tuple(row[k] for k in keys)
        old = indexed.get(key)
        if old is None:
            insert(dst, table, row)
            indexed[key] = row
            added += 1
        elif old != row:
            conflicts += 1
            if immutable:
                raise ProfileMergeError('Conflicting immutable records; no cutover performed')
            if prefer_newer and (row[prefer_newer] or '') > (old[prefer_newer] or ''):
                insert(dst, table, row)
                indexed[key] = row
    return dict(added=added, conflicts=conflicts, total=len(indexed))


def merge_database(stage, other, relative):
    target, source = stage / relative, other / relative
    if not source.exists() or not target.exists():
        return {}
    dst, src = sqlite3.connect(target), readonly(source)
    dst.row_factory = sqlite3.Row
    result = {}
    try:
        # No schema stamping or ad hoc upgrade: only exactly matching formats.
        if version(dst) != version(src) or layout(dst) != layout(src):
            raise ProfileMergeError('Different database layouts require an application migration')
        dst.execute('BEGIN IMMEDIATE')
        if relative == 'LeagueAkari.db':
            result['settings'] = union_table(dst, src, 'Settings', ['key'])
            # Members are identity triples, not array positions. Preserve both lists.
            key = 'member-analysis-main/members'
            left = dst.execute('SELECT value FROM Settings WHERE key=?', (key,)).fetchone()
            right = src.execute('SELECT value FROM Settings WHERE key=?', (key,)).fetchone()
            if left and right:
                members = json.loads(left[0])
                for member in json.loads(right[0]):
                    identity = lambda m: (m['serverId'], m['gameName'], m['tagLine'])
                    if identity(member) not in {identity(m) for m in members}:
                        members.append(member)
                dst.execute('UPDATE Settings SET value=? WHERE key=?', (json.dumps(members, ensure_ascii=False), key))
            result['savedPlayers'] = union_table(dst, src, 'SavedPlayers', ['puuid', 'selfPuuid', 'region', 'rsoPlatformId'], 'updateAt')
            keys = ['gameId', 'puuid', 'selfPuuid', 'region', 'rsoPlatformId', 'queueType']
            indexed = {tuple(r[k] for k in keys): r for r in table_rows(dst, 'EncounteredGames')}
            added = 0
            for row in table_rows(src, 'EncounteredGames'):
                if tuple(row[k] for k in keys) not in indexed:
                    row.pop('id')
                    insert(dst, 'EncounteredGames', row, False)
                    indexed[tuple(row[k] for k in keys)] = row
                    added += 1
            result['encounters'] = dict(added=added, total=len(indexed))
        elif relative.endswith('/catalog.sqlite3'):
            a = {(r['server_id'], r['game_id']): r['checksum'] for r in table_rows(dst, 'catalog_games')}
            for r in table_rows(src, 'catalog_games'):
                if (r['server_id'], r['game_id']) in a and a[(r['server_id'], r['game_id'])] != r['checksum']:
                    raise ProfileMergeError('Conflicting raw checksums require explicit resolution')
            result['catalog'] = union_table(dst, src, 'catalog_games', ['server_id', 'game_id'])
            result['members'] = union_table(dst, src, 'members', ['server_id', 'game_name', 'tag_line'], 'updated_at')
        elif relative.endswith('/analysis.sqlite3'):
            a = {(r['server_id'], r['game_id']): r for r in table_rows(dst, 'derived_games')}
            facts = {(r['server_id'], r['game_id']): r for r in table_rows(src, 'game_identity_facts')}
            added = 0
            for row in table_rows(src, 'derived_games'):
                key = (row['server_id'], row['game_id'])
                if key in a:
                    if a[key]['checksum'] != row['checksum']:
                        raise ProfileMergeError('Conflicting analysis checksums require explicit resolution')
                else:
                    fact = facts.get(key)
                    if not fact or fact['source_checksum'] != row['checksum']:
                        raise ProfileMergeError('Missing source identity facts')
                    insert(dst, 'derived_games', row)
                    insert(dst, 'game_identity_facts', fact)
                    added += 1
            total = dst.execute('SELECT COUNT(*) FROM derived_games').fetchone()[0]
            dst.execute("UPDATE metadata SET value=? WHERE key='identity_facts_count'", (str(total),))
            if added:
                # An aggregate union is not either original collection run's audit.
                dst.execute("DELETE FROM metadata WHERE key='collection_audit'")
            result['analysis'] = dict(added=added, total=total)
        elif relative.endswith('/opponent-ranks.sqlite3'):
            for table, keys, timestamp, immutable in [
                ('player_cache', ['key'], 'attempted_at', False),
                ('game_snapshots', ['server_id', 'game_id'], None, False),
                ('player_observations', ['key', 'fetched_at'], None, True),
                ('game_observations', ['server_id', 'game_id', 'content_hash'], None, False),
                ('game_players', ['server_id', 'game_id', 'player_key'], None, False),
                ('publication_receipts', ['publication_id'], None, True),
            ]:
                result[table] = union_table(dst, src, table, keys, timestamp, immutable)
        dst.commit()
        integrity(dst)
        dst.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    except Exception:
        dst.rollback()
        raise
    finally:
        dst.close()
        src.close()
    return result


def verify_catalog(root):
    path = root / 'member-analysis/db/catalog.sqlite3'
    if not path.exists():
        return
    db = readonly(path)
    try:
        for row in table_rows(db, 'catalog_games'):
            for column in ('summary_path', 'details_path'):
                relative = Path(row[column])
                file = root / 'member-analysis' / relative
                if relative.is_absolute() or '..' in relative.parts or not file.is_file() or file.is_symlink():
                    raise ProfileMergeError('Catalog raw file is missing or unsafe')
                expected = Path('raw') / row['server_id'] / str(row['game_id']) / ('summary.json.gz' if column == 'summary_path' else 'details.json.gz')
                if relative != expected:
                    raise ProfileMergeError('Catalog raw path is not canonical')
    finally:
        db.close()


def verify_analysis_facts(root):
    path = root / 'member-analysis/db/analysis.sqlite3'
    if not path.exists():
        return
    db = readonly(path)
    try:
        facts = {(r['server_id'], r['game_id']): r for r in table_rows(db, 'game_identity_facts')}
        for row in table_rows(db, 'derived_games'):
            fact = facts[(row['server_id'], row['game_id'])]
            if fact['source_checksum'] != row['checksum'] or fact['method_version'] != 1:
                raise ProfileMergeError('Analysis identity provenance mismatch')
            # Retain immutable verified facts even if raw data was legitimately cleaned.
            raw = root / 'member-analysis/raw' / row['server_id'] / str(row['game_id']) / 'summary.json.gz'
            if raw.exists() and digest(raw) != fact['summary_digest']:
                raise ProfileMergeError('Merged raw summary does not match published identity facts')
            payload = json.loads(row['payload_json'])
            if payload['gameId'] != row['game_id']:
                raise ProfileMergeError('Invalid analysis identity')
    finally:
        db.close()


def merge_profiles(dev, installed, stage):
    if stage.exists() or dev == installed or stage in (dev, installed):
        raise ProfileMergeError('Merge requires a new staging profile')
    for root in (dev, installed):
        safe_tree(root)
        verify_versions(root)
        if (root / MARKER).exists():
            raise ProfileMergeError('Profile was already linked; refusing to merge stale originals')
        if (root / 'member-analysis/db/rank-publication.pending.json').exists():
            raise ProfileMergeError('Pending publication requires normal application recovery first')
    signatures = [source_signature(root) for root in (dev, installed)]
    stage.mkdir()
    copy_business(dev, stage, False)
    report = {'fileConflictsPreservedInOriginals': copy_business(installed, stage, True)}
    for relative in ('LeagueAkari.db', 'member-analysis/db/catalog.sqlite3',
                     'member-analysis/db/analysis.sqlite3', 'member-analysis/db/opponent-ranks.sqlite3'):
        report[relative] = merge_database(stage, installed, relative)
    verify_versions(stage)
    verify_catalog(stage)
    verify_analysis_facts(stage)
    if signatures != [source_signature(root) for root in (dev, installed)]:
        raise ProfileMergeError('A source profile changed during the merge; originals remain active')
    (stage / 'ccb-profile-merge-receipt.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    return report


def require_stopped():
    # Fixed read-only query, never prints command lines or credentials, never kills apps.
    query = "$p=Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.Name -match '^(electron|LeagueAkariCCB|League Akari CCB).*exe$' }; if($p){exit 9}"
    result = subprocess.run(['powershell', '-NoProfile', '-Command', query], capture_output=True)
    if result.returncode:
        raise ProfileMergeError('Close Electron/CCB instances before offline merge (or process inventory failed)')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Back up installed profile and publish verified merge')
    args = parser.parse_args()
    if os.name != 'nt':
        raise ProfileMergeError('This local cutover supports Windows only')
    appdata = Path(os.environ['APPDATA']).resolve()
    dev, installed = appdata / 'league-akari', appdata / 'League Akari CCB'
    if not args.apply:
        for root in (dev, installed):
            safe_tree(root)
            verify_versions(root)
        print('Both profiles have supported schemas. No files changed. Close both apps and use --apply to merge.')
        return
    require_stopped()
    suffix = uuid.uuid4().hex
    stage = appdata / ('League Akari CCB.shared-staging-' + suffix)
    backup = appdata / ('League Akari CCB.before-shared-' + suffix)
    report = merge_profiles(dev, installed, stage)
    for relative in ('LeagueAkari.db', 'member-analysis/db/catalog.sqlite3',
                     'member-analysis/db/analysis.sqlite3', 'member-analysis/db/opponent-ranks.sqlite3'):
        if not (stage / relative).is_file():
            raise ProfileMergeError('Shared startup requires a complete supported database set')
    require_stopped()
    marker = dict(schemaVersion=1, compatibilityEpoch=1, state='ready', compatibility=COMPATIBILITY)
    with (stage / MARKER).open('w', encoding='utf-8') as stream:
        json.dump(marker, stream, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    # Preserve the installed directory wholesale; rollback if the second rename fails.
    installed.rename(backup)
    try:
        stage.rename(installed)
    except Exception:
        if installed.exists():
            installed.rename(stage)
        backup.rename(installed)
        raise
    print(json.dumps(dict(merged=True, sharedProfile=str(installed), installedBackup=str(backup),
                          originalDevPreserved=True, report=report), ensure_ascii=False))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Do not echo SQLite contents, identifiers or source filenames.
        message = str(error) if isinstance(error, ProfileMergeError) else type(error).__name__
        print('Profile merge stopped safely: ' + message)
        raise SystemExit(1)
