import gzip
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

from member_analysis.analysis import build_lane_gank_deaths_payload, detect_start_camp, frame_at  # noqa: E402
from member_analysis.worker import derive_game  # noqa: E402


ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]


def synthetic_summary(game_id=7):
    players = []
    for team_id, start in ((100, 1), (200, 6)):
        for offset, role in enumerate(ROLES):
            participant_id = start + offset
            target = team_id == 100
            players.append(
                {
                    "_target": target,
                    "_targetName": f"Member {offset + 1}#TEST" if target else None,
                    "participantId": participant_id,
                    "puuid": f"anon-{participant_id}",
                    "teamId": team_id,
                    "teamPosition": role,
                    "riotIdGameName": f"Participant{participant_id}",
                    "riotIdTagline": "TEST",
                    "championName": f"Champion{participant_id}",
                    "kills": 2 if target else 1,
                    "deaths": 1 if target else 2,
                    "assists": 3,
                    "goldEarned": 12000 if target else 10000,
                    "totalDamageDealtToChampions": 12000 if target else 9000,
                    "totalMinionsKilled": 150,
                    "neutralMinionsKilled": 10 if role == "JUNGLE" else 0,
                    "visionScore": 20,
                    "wardsPlaced": 5,
                    "wardsKilled": 2,
                    "visionWardsBoughtInGame": 1,
                    "totalDamageTaken": 8000,
                    "damageSelfMitigated": 3000,
                    "damageDealtToObjectives": 1500,
                    "damageDealtToTurrets": 500,
                    "totalHealsOnTeammates": 0,
                    "totalDamageShieldedOnTeammates": 0,
                    "timeCCingOthers": 5,
                    "firstBloodKill": False,
                    "firstBloodAssist": False,
                    "firstTowerKill": False,
                    "firstTowerAssist": False,
                    "win": target,
                    "challenges": {"soloKills": 0},
                }
            )
    return {
        "json": {
            "gameId": game_id,
            "gameCreation": 1700000000000,
            "gameDuration": 1800,
            "gameVersion": "26.1.2",
            "mapId": 11,
            "queueId": 420,
            "participants": players,
            "teams": [
                {"teamId": 100, "win": True, "objectives": {}},
                {"teamId": 200, "win": False, "objectives": {}},
            ],
        }
    }


def synthetic_details():
    frames = []
    for minute in range(21):
        participant_frames = {}
        for participant_id in range(1, 11):
            target = participant_id <= 5
            participant_frames[str(participant_id)] = {
                "participantId": participant_id,
                "totalGold": minute * (620 if target else 560),
                "xp": minute * (500 if target else 470),
                "level": min(18, max(1, minute + 1)),
                "minionsKilled": minute * 6,
                "jungleMinionsKilled": minute * 4 if participant_id in (2, 7) else 0,
                "position": {"x": 3830, "y": 7880}
                if participant_id == 2 and minute == 1
                else {"x": 4500, "y": 10500},
                "damageStats": {
                    "totalDamageDoneToChampions": minute * (240 if target else 190)
                },
            }
        events = []
        if minute == 2:
            events.append(
                {
                    "type": "CHAMPION_KILL",
                    "timestamp": 120000,
                    "killerId": 2,
                    "victimId": 6,
                    "assistingParticipantIds": [],
                    "position": {"x": 4000, "y": 11000},
                }
            )
        if minute == 5:
            events.extend(
                [
                    {
                        "type": "CHAMPION_KILL",
                        "timestamp": 300000,
                        "killerId": 1,
                        "victimId": 6,
                        "assistingParticipantIds": [2],
                        "position": {"x": 9800, "y": 4400},
                    },
                    {
                        "type": "ELITE_MONSTER_KILL",
                        "timestamp": 330000,
                        "killerId": 2,
                        "killerTeamId": 100,
                        "monsterType": "DRAGON",
                        "assistingParticipantIds": [1, 3],
                        "position": {"x": 9800, "y": 4400},
                    },
                ]
            )
        if minute == 8:
            events.extend(
                [
                    {
                        "type": "CHAMPION_KILL",
                        "timestamp": 480000,
                        "killerId": 6,
                        "victimId": 1,
                        "assistingParticipantIds": [7],
                        "position": {"x": 4500, "y": 10500},
                    },
                    {
                        "type": "BUILDING_KILL",
                        "timestamp": 520000,
                        "killerId": 6,
                        "teamId": 100,
                        "buildingType": "TOWER_BUILDING",
                        "towerType": "OUTER_TURRET",
                        "position": {"x": 4500, "y": 10500},
                    },
                ]
            )
        frames.append(
            {
                "timestamp": minute * 60000,
                "participantFrames": participant_frames,
                "events": events,
            }
        )
    return {"json": {"frames": frames}}


class WorkerContractTest(unittest.TestCase):
    def test_fixed_minute_requires_observation_at_that_minute(self):
        before = {"timestamp": 840000}
        exact = {"timestamp": 900000}
        after = {"timestamp": 960000}
        self.assertIsNone(frame_at([before, after], 900000))
        self.assertIsNone(frame_at([before], 900000))
        self.assertIsNone(frame_at([], 900000))
        self.assertIs(frame_at([after, exact, before], 900000), exact)

    def test_fixed_minute_accepts_bounded_snapshot_delay(self):
        delayed = {"timestamp": 900323}
        exact = {"timestamp": 900000}
        self.assertIs(frame_at([delayed], 900000), delayed)
        self.assertIs(frame_at([delayed, exact], 900000), exact)
        self.assertIsNone(frame_at([{"timestamp": 901001}], 900000))
        self.assertIsNone(frame_at([{"timestamp": None}, {}], 900000))
        details = synthetic_details()
        for frame in details["json"]["frames"]:
            frame["timestamp"] += 323
        game = derive_game(synthetic_summary(), details)
        self.assertEqual(game["players"][0]["gd15"], 900)

    def test_records_lane_aligned_enemy_jungler_kills_by_timestamp(self):
        summary = synthetic_summary()["json"]["participants"]
        targets = {row["teamPosition"]: row for row in summary if row["_target"]}
        enemy_jungler = next(
            row for row in summary if not row["_target"] and row["teamPosition"] == "JUNGLE"
        )
        events = [
            # 3:00 belongs to the three-minute bucket.
            {"type": "CHAMPION_KILL", "timestamp": 180000, "killerId": 7, "victimId": 3,
             "assistingParticipantIds": [], "position": {"x": 7000, "y": 7000}},
            # 4:00 belongs to the four-minute bucket and assist involvement is retained.
            {"type": "CHAMPION_KILL", "timestamp": 240000, "killerId": 6, "victimId": 4,
             "assistingParticipantIds": [7], "position": {"x": 10500, "y": 4200}},
            # Wrong lane for the top laner.
            {"type": "CHAMPION_KILL", "timestamp": 300000, "killerId": 7, "victimId": 1,
             "assistingParticipantIds": [], "position": {"x": 10500, "y": 4200}},
            # Exact 14:00 boundary is outside the analysis window.
            {"type": "CHAMPION_KILL", "timestamp": 840000, "killerId": 7, "victimId": 1,
             "assistingParticipantIds": [], "position": {"x": 4200, "y": 10500}},
        ]
        result = build_lane_gank_deaths_payload(
            [{"timestamp": 0, "participantFrames": {}, "events": events}],
            targets,
            enemy_jungler,
        )
        self.assertEqual(result["status"], "available")
        self.assertEqual([event["timestampSec"] for event in result["events"]], [180, 240])
        self.assertEqual([event["involvement"] for event in result["events"]], ["killer", "assist"])

    def test_marks_lane_gank_data_unavailable_without_enemy_jungler(self):
        result = build_lane_gank_deaths_payload([{"events": []}], {}, None)
        self.assertEqual(
            result,
            {"methodVersion": 1, "status": "unavailable", "reason": "enemy-jungler-unresolved"},
        )

    def test_detects_all_six_start_camps_on_both_sides(self):
        expected = {
            (2100, 8400): ("gromp", "blue"),
            (8400, 2700): ("krugs", "blue"),
            (12720, 6480): ("gromp", "red"),
            (6420, 12180): ("krugs", "red"),
        }
        for (x, y), (camp, side) in expected.items():
            with self.subTest(camp=camp, side=side):
                detected = detect_start_camp({"x": x, "y": y})
                self.assertIsNotNone(detected)
                self.assertEqual((detected["camp"], detected["side"]), (camp, side))

    def test_derives_fixed_five_stack_and_timeline_metrics(self):
        game = derive_game(synthetic_summary(), synthetic_details())
        self.assertEqual(game["gameId"], 7)
        self.assertEqual(len(game["players"]), 5)
        self.assertEqual({row["player"] for row in game["players"]}, {
            f"Member {index}#TEST" for index in range(1, 6)
        })
        self.assertGreater(game["gold20Diff"], 0)
        self.assertEqual(game["gold20Diff"], 6000)
        self.assertEqual(game["players"][0]["gd10"], 600)
        self.assertEqual(game["players"][0]["gd15"], 900)
        self.assertEqual(game["players"][0]["csd15"], 0)
        self.assertEqual(game["players"][0]["xpd15"], 450)
        self.assertEqual(game["players"][0]["damageDiff15"], 750)
        self.assertEqual(game["players"][0]["soloDiff15"], 0)
        self.assertEqual(game["upperGold15"], 2700)
        self.assertEqual(game["botGold15"], 1800)
        self.assertEqual(game["dragon15Diff"], 1)
        self.assertEqual(game["tower20Diff"], -1)
        self.assertEqual(game["eventDecision"]["killEpisodes"], 2)
        self.assertEqual(game["eventDecision"]["convertedKillEpisodes"], 1)
        self.assertEqual(game["eventDecision"]["deathEpisodes"], 1)
        self.assertEqual(game["eventDecision"]["highCostDeathEpisodes"], 1)
        self.assertEqual(game["eventDecision"]["deathCostTowers"], 1)
        self.assertIsNotNone(game["jungle"])
        self.assertEqual(game["jungle"]["startCamp"], "blue")
        self.assertEqual(game["jungle"]["dragons"], 1)
        self.assertTrue(game["jungle"]["gotFirstDragon"])
        self.assertEqual(game["laneGankDeaths"]["status"], "available")
        self.assertEqual(len(game["laneGankDeaths"]["events"]), 1)
        self.assertEqual(game["laneGankDeaths"]["events"][0]["timestampSec"], 480)
        self.assertNotIn("token", json.dumps(game).lower())

    def test_rejects_a_partial_configured_party(self):
        summary = synthetic_summary()
        summary["json"]["participants"][4]["_target"] = False
        with self.assertRaisesRegex(ValueError, "exact configured five-player stack"):
            derive_game(summary, synthetic_details())

    def test_processes_manifest_and_stages_sqlite(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / "raw" / "TEST" / "7"
            raw.mkdir(parents=True)
            for name, payload in (
                ("summary", synthetic_summary()),
                ("details", synthetic_details()),
            ):
                with gzip.open(raw / f"{name}.json.gz", "wt", encoding="utf-8") as handle:
                    json.dump(payload, handle)
            manifest = {
                "audit": {
                    "requestedMembers": 5, "resolvedMembers": 5,
                    "memberScans": [
                        {"member": index + 1, "status": "RESOLVED", "historyGames": 1,
                         "pages": 1, "stopReason": "source-exhausted"}
                        for index in range(5)
                    ],
                    "targetHistoryDepth": 100, "scanLimitPerMember": 2000,
                    "collectionStopReason": "source-exhausted", "sourceUnion": 1,
                    "sourceIntersection": 1, "fivePresent": 1, "fiveSameTeam": 1,
                    "mapEligible": 1, "queueEligible": 1, "targetSelected": 1,
                    "roleEligible": 1,
                    "detailSucceeded": 1, "detailFetched": 1, "cacheHits": 0,
                    "rawCatalog": 1, "workerReceived": 0, "stagingGames": 0,
                    "publishedGames": 0,
                },
                "items": [
                    {
                        "serverId": "TEST",
                        "gameId": 7,
                        "checksum": "abc",
                        "summaryPath": "raw/TEST/7/summary.json.gz",
                        "detailsPath": "raw/TEST/7/details.json.gz",
                    }
                ]
            }
            (root / "jobs" / "job").mkdir(parents=True)
            (root / "jobs" / "job" / "manifest.json").write_text(
                json.dumps(manifest), encoding="utf-8"
            )
            executable = os.environ.get("MEMBER_ANALYSIS_WORKER_EXECUTABLE")
            command = (
                [executable]
                if executable
                else [sys.executable, "-I", str(SRC / "member_analysis" / "worker.py")]
            ) + [
                "--job-id", "job", "--data-root", str(root),
                "--manifest", "jobs/job/manifest.json",
                "--staging", "db/analysis.next.sqlite3",
                "--current", "db/analysis.sqlite3",
                "--checkpoint", "jobs/job/checkpoint.json",
            ]
            result = subprocess.run(command, capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            messages = [json.loads(line) for line in result.stdout.splitlines()]
            self.assertEqual(messages[-1]["status"], "completed")
            database = sqlite3.connect(root / "db" / "analysis.next.sqlite3")
            self.assertEqual(database.execute("PRAGMA integrity_check").fetchone()[0], "ok")
            payload = json.loads(
                database.execute("SELECT payload_json FROM derived_games").fetchone()[0]
            )
            self.assertEqual(len(payload["players"]), 5)
            audit = json.loads(database.execute(
                "SELECT value FROM metadata WHERE key='collection_audit'"
            ).fetchone()[0])
            self.assertEqual(
                (audit["rawCatalog"], audit["workerReceived"], audit["stagingGames"], audit["publishedGames"]),
                (1, 1, 1, 1),
            )
            database.close()
            self.assertFalse((root / "db" / "analysis.sqlite3").exists())


if __name__ == "__main__":
    unittest.main()
