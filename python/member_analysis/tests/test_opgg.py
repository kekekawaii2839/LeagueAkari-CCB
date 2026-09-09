import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from member_analysis.opgg import enrich_games, lane_kill_margin  # noqa: E402


ROLES = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]


class FakeClient:
    def resolve_many(self, matchups, cancelled=lambda: False):
        return {matchup: lane_kill_margin(0.6, 100) for matchup in matchups}


class OpggEnrichmentTest(unittest.TestCase):
    def test_applies_shrunk_lane_kill_margin_to_non_jungle_roles(self):
        participants = []
        for team_id, target in ((100, True), (200, False)):
            for index, role in enumerate(ROLES):
                participants.append(
                    {
                        "_target": target,
                        "teamId": team_id,
                        "teamPosition": role,
                        "championName": f"Champion{team_id + index}",
                    }
                )
        payload = {
            "patch": "26.1",
            "counterMean": None,
            "players": [{"role": role, "counter": None} for role in ROLES],
        }
        stats = enrich_games(
            [(payload, {"json": {"participants": participants}})],
            FakeClient(),
        )

        self.assertAlmostEqual(payload["counterMean"], 0.05)
        self.assertIsNone(payload["players"][1]["counter"])
        self.assertTrue(
            all(
                abs(player["counter"] - 0.05) < 1e-9
                for player in payload["players"]
                if player["role"] != "JUNGLE"
            )
        )
        self.assertEqual(stats, {"requested": 4, "resolved": 4})

    def test_preserves_raw_rate_when_opgg_does_not_expose_matchup_sample(self):
        self.assertAlmostEqual(lane_kill_margin(0.58, 0), 0.08)


if __name__ == "__main__":
    unittest.main()
