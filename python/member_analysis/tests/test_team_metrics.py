import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from member_analysis.analysis import build_bans, build_team_metrics


class TeamMetricsTest(unittest.TestCase):
    def source(self):
        return {"gameDuration": 1800, "participants": [{"participantId": i, "teamId": 100 if i < 6 else 200, "kills": 2} for i in range(1, 11)]}

    def test_missing_timeline_is_not_zero(self):
        result = build_team_metrics(self.source(), [], 100)
        self.assertEqual(result["totalKills"], 20)
        self.assertIsNone(result["dragons"])
        self.assertIsNone(result["firstTowerTime"])

    def test_complete_events_separate_elder_and_structure_owner(self):
        frames = [{"timestamp": i * 60000, "events": []} for i in range(31)]
        frames[10]["events"] = [
            {"type": "ELITE_MONSTER_KILL", "monsterType": "DRAGON", "monsterSubType": "FIRE_DRAGON", "killerId": 2, "timestamp": 600000},
            {"type": "BUILDING_KILL", "buildingType": "TOWER_BUILDING", "teamId": 200, "timestamp": 601000},
            {"type": "DRAGON_SOUL_GIVEN", "teamId": 100, "timestamp": 602000},
            {"type": "ELITE_MONSTER_KILL", "monsterType": "DRAGON", "monsterSubType": "ELDER_DRAGON", "killerTeamId": 100, "timestamp": 603000},
        ]
        result = build_team_metrics(self.source(), frames, 100)
        self.assertEqual(result, {"totalKills": 20, "firstDragonTime": 600, "firstTowerTime": 601, "dragons": 1, "barons": 0, "dragonSouls": 1, "elderDragons": 1})

    def test_bans_distinguish_empty_from_missing(self):
        self.assertEqual(build_bans({"teams": [{"teamId": 100, "bans": [{"championId": -1}, {"championId": 12}]}]}, 100), {"own": [12], "enemy": None})
        self.assertEqual(build_bans({"teams": [{"teamId": 100, "bans": []}]}, 100), {"own": [], "enemy": None})


if __name__ == "__main__":
    unittest.main()
