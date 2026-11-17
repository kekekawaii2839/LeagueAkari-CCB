"""Synthetic-only tests for explicit offline profile merging."""
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('profile_merge', Path(__file__).with_name('merge-local-ccb-profiles.py'))
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)


def storage(root, label):
    db = sqlite3.connect(root / 'LeagueAkari.db')
    db.executescript('''CREATE TABLE Metadata(key TEXT PRIMARY KEY,value TEXT);
    INSERT INTO Metadata VALUES('version','15');
    CREATE TABLE Settings(key TEXT PRIMARY KEY,value TEXT);
    CREATE TABLE SavedPlayers(puuid TEXT,selfPuuid TEXT,region TEXT,rsoPlatformId TEXT,tag TEXT,updateAt TEXT,lastMetAt TEXT,PRIMARY KEY(puuid,selfPuuid,region,rsoPlatformId));
    CREATE TABLE EncounteredGames(id INTEGER PRIMARY KEY,gameId INTEGER,puuid TEXT,selfPuuid TEXT,region TEXT,rsoPlatformId TEXT,updateAt TEXT,queueType TEXT);''')
    db.executemany('INSERT INTO Settings VALUES(?,?)', [('theme', json.dumps(label)), ('member-analysis-main/members', json.dumps([dict(serverId='synthetic', gameName=label, tagLine='TEST')]))])
    db.execute('INSERT INTO EncounteredGames VALUES(1,1,?,?,?,?,?,?)', (label, 'self', 'synthetic', '', '2026-01-01', 'ranked'))
    db.commit()
    db.close()


class MergeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='ccb-profile-synthetic-')
        self.root = Path(self.temp.name).resolve()
        self.dev, self.installed, self.stage = [self.root / n for n in ['dev', 'installed', 'stage']]
        for root, label in [(self.dev, 'dev'), (self.installed, 'installed')]:
            root.mkdir()
            storage(root, label)

    def tearDown(self):
        self.temp.cleanup()

    def test_union_and_conflict_policy_preserve_originals(self):
        before = {p: merge.digest(p) for r in (self.dev, self.installed) for p in r.rglob('*') if p.is_file()}
        report = merge.merge_profiles(self.dev, self.installed, self.stage)
        db = sqlite3.connect(self.stage / 'LeagueAkari.db')
        self.assertEqual(db.execute("SELECT value FROM Settings WHERE key='theme'").fetchone()[0], '"dev"')
        members = json.loads(db.execute("SELECT value FROM Settings WHERE key='member-analysis-main/members'").fetchone()[0])
        self.assertEqual(len(members), 2)
        self.assertEqual(db.execute('SELECT COUNT(*) FROM EncounteredGames').fetchone()[0], 2)
        db.close()
        self.assertEqual(report['LeagueAkari.db']['encounters']['added'], 1)
        self.assertEqual(before, {p: merge.digest(p) for p in before})

    def test_future_schema_stops_before_stage_creation(self):
        db = sqlite3.connect(self.installed / 'LeagueAkari.db')
        db.execute("UPDATE Metadata SET value='16'")
        db.commit()
        db.close()
        with self.assertRaises(ValueError):
            merge.merge_profiles(self.dev, self.installed, self.stage)
        self.assertFalse(self.stage.exists())

    def test_missing_raw_rejects_merge(self):
        path = self.dev / 'member-analysis/db'
        path.mkdir(parents=True)
        db = sqlite3.connect(path / 'catalog.sqlite3')
        db.executescript('PRAGMA user_version=2; CREATE TABLE catalog_games(server_id TEXT,game_id INTEGER,summary_path TEXT,details_path TEXT);')
        db.execute('INSERT INTO catalog_games VALUES(?,?,?,?)', ('synthetic', 1, '../outside', 'raw/synthetic/1/details.json.gz'))
        db.commit()
        db.close()
        with self.assertRaisesRegex(ValueError, 'raw file'):
            merge.merge_profiles(self.dev, self.installed, self.stage)
        self.assertTrue((self.installed / 'LeagueAkari.db').exists())

    def test_file_conflicts_are_not_overwritten_and_unique_files_survive(self):
        for root, content in [(self.dev, 'daily'), (self.installed, 'release')]:
            directory = root / 'AkariConfig'
            directory.mkdir()
            (directory / 'synthetic.json').write_text(content)
        (self.installed / 'AkariConfig/unique.json').write_text('unique')
        merge.merge_profiles(self.dev, self.installed, self.stage)
        self.assertEqual((self.stage / 'AkariConfig/synthetic.json').read_text(), 'daily')
        self.assertEqual((self.stage / 'AkariConfig/unique.json').read_text(), 'unique')
        self.assertEqual((self.installed / 'AkariConfig/synthetic.json').read_text(), 'release')

    def test_raw_checksum_conflict_rolls_back_staged_database(self):
        for root, checksum in [(self.dev, 'a'), (self.installed, 'b')]:
            directory = root / 'member-analysis/db'
            directory.mkdir(parents=True)
            db = sqlite3.connect(directory / 'catalog.sqlite3')
            db.executescript('PRAGMA user_version=2; CREATE TABLE catalog_games(server_id TEXT,game_id INTEGER,checksum TEXT,PRIMARY KEY(server_id,game_id)); CREATE TABLE members(server_id TEXT,game_name TEXT,tag_line TEXT,updated_at TEXT);')
            db.execute('INSERT INTO catalog_games VALUES(?,?,?)', ('synthetic', 1, checksum))
            db.commit()
            db.close()
        with self.assertRaisesRegex(ValueError, 'checksums'):
            merge.merge_profiles(self.dev, self.installed, self.stage)
        db = sqlite3.connect(self.stage / 'member-analysis/db/catalog.sqlite3')
        self.assertEqual(db.execute('SELECT checksum FROM catalog_games').fetchone()[0], 'a')
        db.close()

    def test_refuses_stale_original_after_linking(self):
        (self.installed / merge.MARKER).write_text('{}')
        with self.assertRaisesRegex(ValueError, 'already linked'):
            merge.merge_profiles(self.dev, self.installed, self.stage)
        self.assertFalse(self.stage.exists())

    def test_sqlite_snapshot_includes_committed_wal(self):
        source = sqlite3.connect(self.dev / 'LeagueAkari.db')
        source.execute('PRAGMA journal_mode=WAL')
        source.execute('INSERT INTO Settings VALUES(?,?)', ('wal-only', 'true'))
        source.commit()
        try:
            merge.merge_profiles(self.dev, self.installed, self.stage)
            merged = sqlite3.connect(self.stage / 'LeagueAkari.db')
            self.assertEqual(merged.execute("SELECT value FROM Settings WHERE key='wal-only'").fetchone()[0], 'true')
            merged.close()
        finally:
            source.close()

    def test_immutable_history_union_and_conflict_rejection(self):
        a, b = sqlite3.connect(':memory:'), sqlite3.connect(':memory:')
        a.row_factory = b.row_factory = sqlite3.Row
        try:
            for db in (a, b):
                db.execute('CREATE TABLE history(key TEXT PRIMARY KEY,value TEXT)')
            a.execute("INSERT INTO history VALUES('daily','a')")
            b.execute("INSERT INTO history VALUES('release','b')")
            result = merge.union_table(a, b, 'history', ['key'], immutable=True)
            self.assertEqual(result, dict(added=1, conflicts=0, total=2))
            b.execute("INSERT INTO history VALUES('daily','changed')")
            with self.assertRaisesRegex(ValueError, 'immutable'):
                merge.union_table(a, b, 'history', ['key'], immutable=True)
            self.assertEqual(a.execute("SELECT value FROM history WHERE key='daily'").fetchone()[0], 'a')
        finally:
            a.close()
            b.close()

    def test_analysis_union_keeps_paired_facts_and_does_not_reuse_run_audit(self):
        schema = (Path(__file__).resolve().parents[2] / 'python/member_analysis/src/member_analysis/schema.sql').read_text()
        for root, games in [(self.dev, [1, 2]), (self.installed, [2, 3])]:
            directory = root / 'member-analysis/db'
            directory.mkdir(parents=True)
            db = sqlite3.connect(directory / 'analysis.sqlite3')
            db.executescript(schema)
            for game in games:
                db.execute('INSERT INTO derived_games VALUES(?,?,?,?,?)', ('synthetic', game, 'checksum', json.dumps(dict(gameId=game)), '2026-01-01'))
                db.execute('INSERT INTO game_identity_facts VALUES(?,?,?,?,?,?)', ('synthetic', game, 'checksum', 'synthetic-digest', 1, '[]'))
            db.executemany('INSERT INTO metadata VALUES(?,?)', [('derivation_version', '5'), ('identity_facts_state', 'verified-v1'), ('identity_facts_count', str(len(games))), ('collection_audit', '{}')])
            db.commit()
            db.close()
        report = merge.merge_profiles(self.dev, self.installed, self.stage)
        self.assertEqual(report['member-analysis/db/analysis.sqlite3']['analysis'], dict(added=1, total=3))
        db = sqlite3.connect(self.stage / 'member-analysis/db/analysis.sqlite3')
        try:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM game_identity_facts').fetchone()[0], 3)
            self.assertEqual(db.execute("SELECT value FROM metadata WHERE key='identity_facts_count'").fetchone()[0], '3')
            self.assertIsNone(db.execute("SELECT value FROM metadata WHERE key='collection_audit'").fetchone())
        finally:
            db.close()

    def test_same_version_different_layout_is_not_silently_migrated(self):
        db = sqlite3.connect(self.installed / 'LeagueAkari.db')
        db.execute('ALTER TABLE Settings ADD COLUMN incompatible TEXT')
        db.commit()
        db.close()
        with self.assertRaisesRegex(ValueError, 'layouts'):
            merge.merge_profiles(self.dev, self.installed, self.stage)


if __name__ == '__main__':
    unittest.main()
