import copy
import json
import unittest

from prediction_time_audit import audit_time_boundaries


ROLES = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
BASE = 1700000000000


def game(i, start, prefix="synthetic-secret", side="Blue", duration=900):
    return {"gameId": i, "timestamp": BASE + start, "duration": duration,
            "side": side, "patch": "secret-patch",
            "players": [{"member": f"{prefix}-{j}", "role": role,
                         "vision": 0, "kp": None, "gd15": None}
                        for j, role in enumerate(ROLES)]}


class TimeAuditTests(unittest.TestCase):
    def test_overlap_disjoint_exact_end_and_all_same_start_pairs(self):
        data = [game(0, 0), game(1, 900000), game(2, 1000000, "other"),
                game(3, 1000000), game(4, 1000000)]
        report = audit_time_boundaries(data)
        self.assertEqual(report["comparisons"], 10)
        self.assertEqual(report["sameStartPairsSharingDisplayMember"], 1)
        self.assertEqual(report["sameStartPairsDisjointDisplayMembers"], 2)
        self.assertEqual(report["strictEarlierStartEstimatedOverlapPairsSharingDisplayMember"], 2)
        self.assertEqual(report["strictEarlierStartEstimatedOverlapPairsDisjointDisplayMembers"], 1)
        self.assertEqual(report["strictEarlierStartPairsEstimatedEndedByCurrentStart"], 4)
        self.assertEqual(report["history"]["all-5"]["unfinishedEstimatedHistoryEntries"], 10)
        self.assertEqual(report["history"]["all-5"]["gamesWithUnfinishedEstimatedHistory"], 2)

    def test_ties_duplicates_and_window_side_isolation(self):
        data = [game(i, i * 1000, side="Blue" if i % 2 == 0 else "Red") for i in range(7)]
        report = audit_time_boundaries(data)
        self.assertEqual(report["history"]["all-5"]["historyEntries"], 100)
        self.assertEqual(report["history"]["all-20"]["historyEntries"], 105)
        self.assertEqual(report["history"]["all-5"]["warmedSlotQueries"], 10)
        self.assertEqual(report["history"]["all-5"]["warmedUnfinishedEstimatedHistoryEntries"], 50)
        self.assertEqual(report["history"]["Blue-5"]["historyEntries"], 30)
        self.assertEqual(report["history"]["Red-20"]["historyEntries"], 15)
        self.assertEqual(report["history"]["Blue-20"]["warmedSlotQueries"], 0)
        swapped = [game(0, 0), game(1, 1000)]
        swapped[1]["players"][0]["role"] = "JUNGLE"
        swapped[1]["players"][1]["role"] = "TOP"
        self.assertEqual(audit_time_boundaries(swapped)["history"]["all-5"]["unfinishedEstimatedHistoryEntries"], 3)
        tied = [game(1, 0), game(2, 0), game(3, 0)]
        tied.append(copy.deepcopy(tied[0]))
        report = audit_time_boundaries(tied)
        self.assertEqual(report["sameStartPairsSharingDisplayMember"], 6)
        self.assertEqual(report["exactGameKeyDuplicatePairs"], 1)
        self.assertEqual(report["exactGameKeyDuplicateExtraRows"], 1)
        self.assertEqual(report["history"]["all-20"]["historyEntries"], 0)

    def test_purity_anonymity_permutation_and_estimation_limitations(self):
        data = [game(i, i * 1000) for i in range(6)]
        before = copy.deepcopy(data)
        report = audit_time_boundaries(data)
        self.assertEqual(data, before)
        self.assertEqual(audit_time_boundaries(list(reversed(data))), report)
        encoded = json.dumps(report)
        for forbidden in ("synthetic-secret", "secret-patch", str(BASE), "gameId", "players", "memberRole"):
            self.assertNotIn(forbidden, encoded)
        self.assertTrue(report["sameDisplayIdentityOnlyProxy"])
        self.assertTrue(report["endTimesEstimatedFromStartAndDuration"])
        self.assertFalse(report["rawEndTimesAvailable"])
        self.assertFalse(report["originalIngestionTimesAvailable"])
        self.assertFalse(report["fetchedAfterEndEstablishesAsOfAvailability"])

    def test_strict_label_free_schema_finite_units_and_invalid_input(self):
        class Poison:
            def __bool__(self):
                raise AssertionError("Label accessed")
        for key in ("win", "y", "label", "rawEnd", "fetchedAt"):
            data = [game(0, 0)]
            data[0][key] = Poison()
            with self.assertRaisesRegex(ValueError, "Invalid time audit projection"):
                audit_time_boundaries(data)
        for change in (lambda g: g.update(duration=899), lambda g: g.update(duration=float("inf")),
                       lambda g: g.update(timestamp=True), lambda g: g.update(gameId=-1),
                       lambda g: g["players"][0].update(win=Poison()),
                       lambda g: g["players"][1].update(member=g["players"][0]["member"]),
                       lambda g: g["players"][0].update(role="INVALID"),
                       lambda g: g["players"][0].pop("vision")):
            data = [game(0, 0)]
            change(data[0])
            with self.assertRaises(ValueError):
                audit_time_boundaries(data)
        data = [game(0, 0, duration=21600), game(1, 0, duration=21601)]
        data[1]["timestamp"] = 1700000000
        report = audit_time_boundaries(data)
        self.assertEqual(report["durationSecondsWithin900To21600"], 1)
        self.assertEqual(report["durationSecondsAbove21600"], 1)
        self.assertEqual(report["timestampOutside2000To2100EpochMilliseconds"], 1)

    def test_empty_and_inclusive_game_budget(self):
        self.assertEqual(audit_time_boundaries([])["comparisons"], 0)
        self.assertEqual(audit_time_boundaries([])["history"]["all-5"]["slotQueries"], 0)
        data = [game(i, 0) for i in range(1000)]
        report = audit_time_boundaries(data)
        self.assertEqual(report["comparisons"], 499500)
        self.assertEqual(report["sameStartPairsSharingDisplayMember"], 499500)
        with self.assertRaises(ValueError):
            audit_time_boundaries(data + [game(1000, 0)])


if __name__ == "__main__":
    unittest.main()
