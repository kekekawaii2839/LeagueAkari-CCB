import copy
import unittest

from prediction_structure_audit import ROLES, audit_structure, exact_rank


def games(n=8):
    return [{"gameId": i, "timestamp": 1700000000000 + i * 86400000,
             "duration": 1200, "side": "Blue" if i % 2 == 0 else "Red", "patch": "a" if i < 4 else "b",
             "players": [{"member": f"synthetic-{j}", "role": role, "vision": 0, "kp": None, "gd15": 10}
                         for j, role in enumerate(ROLES)]} for i in range(n)]


class StructureAuditTests(unittest.TestCase):
    def test_rank_exact_and_budget(self):
        self.assertEqual(exact_rank([[1, 2, 3], [2, 4, 6], [1, 3, 4]]), 2)
        with self.assertRaises(ValueError):
            exact_rank([[0] * 201])

    def test_fixed_roster_and_warmup(self):
        data = games()
        before = copy.deepcopy(data)
        report = audit_structure(data)
        self.assertEqual(data, before)
        self.assertEqual(report["alwaysTogetherMemberPairs"], 10)
        self.assertEqual(report["memberDesign"], {"columns": 7, "rank": 2})
        self.assertEqual(report["coverage"]["all-5"]["warmSlotsPerGame"], [5, 0, 0, 0, 0, 3])
        self.assertEqual(report["coverage"]["all-5"]["expandingTestWarmSlotsPerGame"], [1, 0, 0, 0, 0, 3])
        self.assertEqual(report["coverage"]["Blue-5"]["warmedSlots"], 0)
        self.assertEqual(report["coverage"]["all-5"]["warmedMetricUnavailable"], {"vision": 0, "kp": 15, "gd15": 0})
        self.assertEqual(report["coverage"]["all-5"]["warmHistoriesCrossingPatch"], 15)
        self.assertNotIn("synthetic", str(report))

    def test_same_timestamp_cannot_warm_each_other(self):
        data = games(6)
        data[-1]["timestamp"] = data[-2]["timestamp"]
        self.assertEqual(audit_structure(data)["coverage"]["all-5"]["warmedSlots"], 0)

    def test_reject_labels_short_and_duplicate(self):
        for change in (lambda g: g.update(win=True), lambda g: g.update(duration=899),
                       lambda g: g["players"][1].update(member=g["players"][0]["member"])):
            data = games(1)
            change(data[0])
            with self.assertRaises(ValueError):
                audit_structure(data)


if __name__ == "__main__":
    unittest.main()
