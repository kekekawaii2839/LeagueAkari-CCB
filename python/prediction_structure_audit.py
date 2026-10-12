"""Label-free structure and history coverage diagnostics; pure standard library."""
from collections import Counter, defaultdict
from fractions import Fraction
import math

ROLES = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
METRICS = ("vision", "kp", "gd15")


def exact_rank(rows):
    """Exact row rank, bounded to the small categorical audit design."""
    if len(rows) > 1000 or any(len(row) > 200 for row in rows):
        raise ValueError("Rank budget exceeded")
    basis = {}
    for row in rows:
        vector = list(map(Fraction, row))
        for pivot, previous in sorted(basis.items()):
            value = vector[pivot]
            if value:
                vector = [x - value * y for x, y in zip(vector, previous)]
        pivot = next((i for i, x in enumerate(vector) if x), None)
        if pivot is not None:
            value = vector[pivot]
            basis[pivot] = [x / value for x in vector]
    return len(basis)


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _quantiles(values):
    ordered = sorted(values)
    return {key: ordered[math.floor((len(ordered) - 1) * p)] if ordered else None
            for key, p in (("min", 0), ("p25", .25), ("median", .5), ("p75", .75), ("max", 1))}


def audit_structure(games):
    """Input is an explicit label-free projection, not raw payloads or predictions."""
    if not isinstance(games, list) or len(games) > 1000:
        raise ValueError("Invalid game budget")
    allowed = {"gameId", "timestamp", "duration", "side", "patch", "players"}
    for game in games:
        if set(game) - allowed or game["duration"] < 900:
            raise ValueError("Invalid audit projection")
        players = game["players"]
        if (len(players) != 5 or len({p["member"] for p in players}) != 5
                or sorted(p["role"] for p in players) != sorted(ROLES)
                or game["side"] not in ("Blue", "Red")
                or any(set(p) - {"member", "role", "vision", "kp", "gd15"} for p in players)):
            raise ValueError("Invalid team projection")
    games = sorted(games, key=lambda g: (g["timestamp"], g["gameId"]))
    times = sorted({g["timestamp"] for g in games})
    test_start = times[math.floor(len(times) * .5)] if times else math.inf
    members = sorted({p["member"] for g in games for p in g["players"]})
    cells = sorted({(p["member"], p["role"]) for g in games for p in g["players"]})
    member_design, cell_design = [], []
    rosters, lineups = Counter(), Counter()
    member_counts, pair_counts, cell_counts = Counter(), Counter(), Counter()
    member_roles = defaultdict(set)
    for game in games:
        players = sorted(game["players"], key=lambda p: ROLES.index(p["role"]))
        roster = sorted(p["member"] for p in players)
        active = {(p["member"], p["role"]) for p in players}
        side = 1 if game["side"] == "Blue" else -1
        member_design.append([1, side] + [int(m in roster) for m in members])
        cell_design.append([1, side] + [int(c in active) for c in cells])
        rosters[tuple(roster)] += 1
        lineups[tuple(p["member"] for p in players)] += 1
        member_counts.update(roster)
        cell_counts.update(active)
        for i, member in enumerate(roster):
            for other in roster[i + 1:]:
                pair_counts[member, other] += 1
        for p in players:
            member_roles[p["member"]].add(p["role"])
    result = {"games": len(games), "members": len(members), "observedMemberRoleCells": len(cells),
              "membersWithMultipleRoles": sum(len(v) > 1 for v in member_roles.values()),
              "distinctRosters": len(rosters), "distinctRoleLineups": len(lineups),
              "largestRosterGames": max(rosters.values(), default=0),
              "largestRoleLineupGames": max(lineups.values(), default=0),
              "alwaysTogetherMemberPairs": sum(n == member_counts[a] == member_counts[b]
                                               for (a, b), n in pair_counts.items()),
              "memberRoleCellGames": _quantiles(list(cell_counts.values())),
              "memberDesign": {"columns": len(members) + 2, "rank": exact_rank(member_design)},
              "memberRoleDesign": {"columns": len(cells) + 2, "rank": exact_rank(cell_design)},
              "coverage": {}}
    for side in ("all", "Blue", "Red"):
        selected = [g for g in games if side == "all" or g["side"] == side]
        for limit in (5, 20):
            histories = defaultdict(list)
            bucket = {"games": len(selected), "slots": 5 * len(selected),
                      "warmSlotsPerGame": [0] * 6,
                      "expandingTestGames": 0, "expandingTestWarmSlotsPerGame": [0] * 6,
                      "historySlots": dict.fromkeys(("zero", "oneToFour", "fiveToNine", "tenToNineteen", "twenty"), 0),
                      "warmedMetricUnavailable": dict.fromkeys(METRICS, 0),
                      "warmedSlots": 0, "warmHistoriesCrossingPatch": 0,
                      "warmHistoriesContainingOlderPatch": 0}
            ages, spans = [], []
            i = 0
            while i < len(selected):
                j = i + 1
                while j < len(selected) and selected[j]["timestamp"] == selected[i]["timestamp"]:
                    j += 1
                for game in selected[i:j]:
                    warm = 0
                    for player in game["players"]:
                        history = histories[player["member"], player["role"]]
                        n = len(history)
                        key = "zero" if n == 0 else "oneToFour" if n < 5 else "fiveToNine" if n < 10 else "tenToNineteen" if n < 20 else "twenty"
                        bucket["historySlots"][key] += 1
                        if n >= 5:
                            warm += 1
                            bucket["warmedSlots"] += 1
                            patches = {item[1] for item in history}
                            bucket["warmHistoriesCrossingPatch"] += len(patches) > 1
                            bucket["warmHistoriesContainingOlderPatch"] += any(p != game["patch"] for p in patches)
                            ages.append((game["timestamp"] - history[-1][0]) / 86400000)
                            spans.append((history[-1][0] - history[0][0]) / 86400000)
                            for metric in METRICS:
                                bucket["warmedMetricUnavailable"][metric] += not any(_finite(item[2].get(metric)) for item in history)
                    bucket["warmSlotsPerGame"][warm] += 1
                    if game["timestamp"] >= test_start:
                        bucket["expandingTestGames"] += 1
                        bucket["expandingTestWarmSlotsPerGame"][warm] += 1
                for game in selected[i:j]:
                    for player in game["players"]:
                        key = player["member"], player["role"]
                        histories[key] = (histories[key] + [(game["timestamp"], game["patch"], player)])[-limit:]
                i = j
            bucket["latestHistoryAgeDays"] = _quantiles(ages)
            bucket["historySpanDays"] = _quantiles(spans)
            result["coverage"][f"{side}-{limit}"] = bucket
    return result
