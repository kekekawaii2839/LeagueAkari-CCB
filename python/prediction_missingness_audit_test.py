"""Synthetic-only tests for fixed-schema anonymous missingness counts."""

import copy
import json
import unittest

from prediction_missingness_audit import audit_missingness


def fixture():
    roles = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
    fields = (
        ("visionScore", "vision"), ("kills", "kills"), ("deaths", "deaths"),
        ("assists", "assists"), ("totalDamageDealtToChampions", "damage"),
        ("goldEarned", "gold"), ("totalDamageTaken", "damageTaken"),
        ("wardsPlaced", "wardsPlaced"), ("wardsKilled", "wardsKilled"),
        ("visionWardsBoughtInGame", "controlWards"),
        ("damageSelfMitigated", "damageMitigated"),
        ("damageDealtToObjectives", "objectiveDamage"),
        ("damageDealtToTurrets", "turretDamage"),
        ("totalHealsOnTeammates", "healTeammates"),
        ("totalDamageShieldedOnTeammates", "shieldTeammates"),
        ("timeCCingOthers", "ccSeconds"),
    )
    participants, players, frame_players = [], [], {}
    for i, role in enumerate(roles):
        row = dict(participantId=i + 1, teamId=100, teamPosition=role,
                   puuid=f"private-secret-{i}", _target=True,
                   challenges={"soloKills": 0, "damageTakenOnTeamPercentage": 0.2})
        row.update({source: 0 for source, _ in fields})
        participants.append(row)
        participants.append(dict(participantId=i + 6, teamId=200, teamPosition=role))
        player = dict(role=role, soloKills=0, takenShare=0.2)
        player.update({derived: 0 for _, derived in fields})
        players.append(player)
    for i in range(10):
        frame_players[str(i + 1)] = dict(totalGold=100, xp=0, minionsKilled=10,
                                        jungleMinionsKilled=0,
                                        damageStats={"totalDamageDoneToChampions": 200})
    return {
        "summary": {"json": {"participants": participants, "gameId": 987654321}},
        "derived": {"players": players, "patch": "14.private", "date": "2099-01-01"},
        "details": {"json": {"frames": [dict(timestamp=900323, participantFrames=frame_players)]}},
    }


class MissingnessTests(unittest.TestCase):
    def test_all_mappings_finite_zero_counts_and_no_mutation(self):
        record = fixture()
        original = copy.deepcopy(record)
        report = audit_missingness([record])
        self.assertEqual(report["targets"], 5)
        self.assertEqual(len(report["mappings"]), 18)
        for key, bucket in report["mappings"].items():
            self.assertEqual(sum(sum(row.values()) for row in bucket["matrix"].values()), 5)
            state = "finite" if key.endswith("damageTakenOnTeamPercentage") else "zero"
            self.assertEqual(bucket["matrix"][state][state], 5)
            self.assertEqual(bucket["missing_or_null_to_zero"], 0)
        self.assertEqual(report["frame15"]["target"]["xp"]["zero"], 5)
        self.assertEqual(report["frame15"]["enemy"]["totalGold"]["finite"], 5)
        self.assertEqual(record, original)

    def test_missing_null_nonfinite_and_derived_states_not_conflated(self):
        record = fixture()
        selected = [x for x in record["summary"]["json"]["participants"] if x.get("_target")]
        del selected[0]["visionScore"]
        selected[1]["visionScore"] = None
        selected[2]["visionScore"] = float("nan")
        selected[3]["visionScore"] = "0"
        selected[4]["visionScore"] = True
        players = record["derived"]["players"]
        players[2]["vision"] = None
        del players[3]["vision"]
        players[4]["vision"] = float("inf")
        report = audit_missingness([record])["mappings"]["visionScore"]
        self.assertEqual(report["missing_or_null_to_zero"], 2)
        self.assertEqual(report["matrix"]["nonfinite"]["null"], 1)
        self.assertEqual(report["matrix"]["nonfinite"]["missing"], 1)
        self.assertEqual(report["matrix"]["nonfinite"]["invalid"], 1)
        del selected[0]["challenges"]
        self.assertEqual(audit_missingness([record])["mappings"]["challenges.soloKills"]["missing_or_null_to_zero"], 1)

    def test_frame_absence_participant_absence_field_absence_and_enemy_resolution(self):
        record = fixture()
        frame = record["details"]["json"]["frames"][0]
        del frame["participantFrames"]["1"]
        del frame["participantFrames"]["2"]["totalGold"]
        frame["participantFrames"]["3"]["damageStats"] = None
        # Two enemy TOP rows are ambiguous, not a fabricated matching opponent.
        record["summary"]["json"]["participants"].append(dict(teamId=200, teamPosition="TOP", participantId=99))
        report = audit_missingness([record])
        self.assertEqual(report["frame15"]["target"]["totalGold"]["no_participant"], 1)
        self.assertEqual(report["frame15"]["target"]["totalGold"]["missing"], 1)
        self.assertEqual(report["frame15"]["target"]["damageStats.totalDamageDoneToChampions"]["missing"], 1)
        self.assertEqual(report["frame15"]["enemy"]["xp"]["no_resolved_enemy"], 1)
        del record["details"]
        report = audit_missingness([record])
        self.assertEqual(report["frame15"]["target"]["totalGold"]["no_frame"], 5)
        self.assertEqual(report["frame15"]["enemy"]["totalGold"]["no_frame"], 5)

    def test_closest_ties_boundaries_and_invalid_timestamp(self):
        record = fixture()
        frames = record["details"]["json"]["frames"]
        frames[0]["timestamp"] = 899000
        later = copy.deepcopy(frames[0])
        later["timestamp"] = 901000
        later["participantFrames"]["1"]["totalGold"] = None
        frames.append(later)
        self.assertEqual(audit_missingness([record])["frame15"]["target"]["totalGold"]["finite"], 5)
        frames[0]["timestamp"] = 898999
        self.assertEqual(audit_missingness([record])["frame15"]["target"]["totalGold"]["null"], 1)
        later["timestamp"] = float("inf")
        self.assertEqual(audit_missingness([record])["frame15"]["target"]["totalGold"]["no_frame"], 5)

    def test_caps_ambiguous_derived_and_fixed_anonymous_schema(self):
        record = fixture()
        record["derived"]["players"].append(copy.deepcopy(record["derived"]["players"][0]))
        report = audit_missingness([record])
        self.assertEqual(report["derived_resolution"]["ambiguous"], 1)
        self.assertEqual(report["mappings"]["visionScore"]["matrix"]["zero"]["invalid"], 1)
        self.assertEqual(set(report), {"records", "targets", "records_without_exact_five_targets",
                                      "derived_resolution", "enemy_resolution", "mappings", "frame15"})
        encoded = json.dumps(report)
        for forbidden in ("private-secret", "987654321", "14.private", "2099-01-01"):
            self.assertNotIn(forbidden, encoded)

        def counts_only(value):
            if isinstance(value, dict):
                for child in value.values():
                    counts_only(child)
            else:
                self.assertIs(type(value), int)
                self.assertGreaterEqual(value, 0)
        counts_only(report)
        self.assertEqual(audit_missingness([])["records"], 0)
        self.assertEqual(audit_missingness([{}])["records_without_exact_five_targets"], 1)
        self.assertEqual(audit_missingness([{}] * 1000)["records"], 1000)
        with self.assertRaises(ValueError):
            audit_missingness([{}] * 1001)


if __name__ == "__main__":
    unittest.main()
