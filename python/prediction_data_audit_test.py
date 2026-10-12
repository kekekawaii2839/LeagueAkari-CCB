"""Synthetic, import-safe source reconciliation tests."""

import copy
import json
import unittest

from prediction_data_audit import audit_prediction_records


def fixture():
    roles = ["TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY"]
    participants = [dict(puuid=f"secret-{i}", participantId=i + 1, teamId=100,
                         _target=True, teamPosition=role, win=True,
                         visionScore=0, challenges={"killParticipation": 0})
                    for i, role in enumerate(roles)]
    participants += [dict(participantId=i + 6, teamId=200, teamPosition=role)
                     for i, role in enumerate(roles)]
    return {"summary": {"json": {"gameId": 987654321, "gameStartTimestamp": 1700000000000,
                                "gameEndTimestamp": 1700001200000, "gameDuration": 1200,
                                "gameVersion": "14.1.secret", "participants": participants,
                                "teams": [{"teamId": 100, "win": True}]}},
            "derived": {"gameId": 987654321, "timestamp": 1700000000000,
                        "duration": 1200, "patch": "14.1", "win": True, "side": "Blue",
                        "players": [dict(role=role, vision=0, kp=0, gd15=10) for role in roles]},
            "fetchedAt": 1700001200001,
            "details": {"json": {"frames": [{"timestamp": 900323,
                         "participantFrames": {str(i + 1): {"totalGold": 110 if i < 5 else 100}
                                               for i in range(10)}}]}}}


class AuditTests(unittest.TestCase):
    def test_correct_source_and_no_mutation(self):
        record = fixture()
        before = copy.deepcopy(record)
        report = audit_prediction_records([record])
        self.assertTrue(all(x["match"] == 1 for x in report["checks"].values()))
        self.assertEqual(report["metrics"]["gd15"]["comparison"]["match"], 5)
        self.assertEqual(report["metrics"]["vision"]["source"]["zero"], 5)
        self.assertEqual(record, before)

    def test_wrong_win_side_duplicate_and_strict_boolean(self):
        record = fixture()
        record["derived"].update(win=False, side="Red")
        rows = record["summary"]["json"]["participants"]
        rows[1]["puuid"] = rows[0]["puuid"]
        report = audit_prediction_records([record])
        for key in ("team_win", "participant_win", "side", "unique_puuids"):
            self.assertEqual(report["checks"][key]["mismatch"], 1)
        record["summary"]["json"]["teams"][0]["win"] = "true"
        self.assertEqual(audit_prediction_records([record])["checks"]["team_win"]["unknown"], 1)

    def test_missing_null_zero_are_distinct_and_not_recomputed_zero(self):
        record = fixture()
        rows = record["summary"]["json"]["participants"]
        del rows[0]["visionScore"]
        rows[1]["visionScore"] = None
        rows[2]["visionScore"] = "0"
        del record["details"]["json"]["frames"][0]["participantFrames"]["1"]["totalGold"]
        report = audit_prediction_records([record])
        self.assertEqual(report["metrics"]["vision"]["source"],
                         dict(missing=1, null=1, zero=2, finite=0, invalid=1, unknown=0))
        self.assertEqual(report["metrics"]["vision"]["comparison"]["unknown"], 3)
        self.assertEqual(report["metrics"]["gd15"]["comparison"]["unknown"], 1)

    def test_closest_frame_and_window_boundary(self):
        record = fixture()
        frames = record["details"]["json"]["frames"]
        far = copy.deepcopy(frames[0])
        far["timestamp"] = 899001
        far["participantFrames"]["1"]["totalGold"] = 999
        frames.insert(0, far)
        self.assertEqual(audit_prediction_records([record])["metrics"]["gd15"]["comparison"]["match"], 5)
        frames[:] = [dict(timestamp=901001, participantFrames=far["participantFrames"])]
        self.assertEqual(audit_prediction_records([record])["metrics"]["gd15"]["comparison"]["unknown"], 5)

    def test_units_and_overlap_population_distinction(self):
        first, second, third = fixture(), fixture(), fixture()
        second["derived"]["timestamp"] += 1000
        third["derived"]["timestamp"] += 2000
        for row in third["summary"]["json"]["participants"][:5]:
            row["puuid"] += "other"
        report = audit_prediction_records([first, second, third])
        self.assertEqual(report["overlap"], dict(same_member=1, disjoint_members=2, unknown_members=0))
        first["derived"]["timestamp"] /= 1000
        self.assertEqual(audit_prediction_records([first])["time"]["implausible_epoch_ms"], 1)
        first["summary"]["json"]["gameDuration"] *= 1000
        self.assertEqual(audit_prediction_records([first])["checks"]["end_duration"]["mismatch"], 1)

    def test_unknown_details_and_anonymous_fixed_schema(self):
        record = fixture()
        del record["details"]
        report = audit_prediction_records([record])
        self.assertEqual(report["metrics"]["gold15"]["source"]["unknown"], 5)
        serialized = json.dumps(report)
        for forbidden in ("secret", "987654321", "170000", "14.1", "Blue", "TOP"):
            self.assertNotIn(forbidden, serialized)

        def counts_only(value):
            if isinstance(value, dict):
                self.assertTrue(all(isinstance(k, str) for k in value))
                for child in value.values():
                    counts_only(child)
            else:
                self.assertIs(type(value), int)
                self.assertGreaterEqual(value, 0)
        counts_only(report)
        self.assertEqual(set(report), {"records", "checks", "metrics", "time", "overlap", "unrecoverable_plan_source"})

    def test_cap_empty_and_unknown(self):
        self.assertEqual(audit_prediction_records([])["records"], 0)
        self.assertEqual(audit_prediction_records([{}])["checks"]["team_win"]["unknown"], 1)
        with self.assertRaises(ValueError):
            audit_prediction_records([{}] * 1001)


if __name__ == "__main__":
    unittest.main()
