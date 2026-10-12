"""Pure label-free timing diagnostics; start+duration is only an estimated end."""
from collections import Counter, defaultdict
import math


_ROLES = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
_GAME_KEYS = {"gameId", "timestamp", "duration", "side", "patch", "players"}
_PLAYER_KEYS = {"member", "role", "vision", "kp", "gd15"}
_MAX_SAFE_INTEGER = 2**53 - 1


def _finite(value):
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def _validate(games):
    if type(games) is not list or len(games) > 1000:
        raise ValueError("Invalid time audit projection")
    for game in games:
        if type(game) is not dict or set(game) != _GAME_KEYS:
            raise ValueError("Invalid time audit projection")
        if any(type(game[key]) is not int or not 0 <= game[key] <= _MAX_SAFE_INTEGER
               for key in ("gameId", "timestamp")):
            raise ValueError("Invalid time audit projection")
        duration = game["duration"]
        if (not _finite(duration) or duration < 900
                or not _finite(game["timestamp"] + duration * 1000)
                or game["side"] not in ("Blue", "Red")
                or type(game["patch"]) is not str
                or not 1 <= len(game["patch"]) <= 32
                or type(game["players"]) is not list or len(game["players"]) != 5):
            raise ValueError("Invalid time audit projection")
        for player in game["players"]:
            if (type(player) is not dict or set(player) != _PLAYER_KEYS
                    or type(player["member"]) is not str
                    or not 1 <= len(player["member"]) <= 96
                    or player["role"] not in _ROLES
                    or any(player[key] is not None and not _finite(player[key])
                           for key in ("vision", "kp", "gd15"))):
                raise ValueError("Invalid time audit projection")
        if (len({p["member"] for p in game["players"]}) != 5
                or {p["role"] for p in game["players"]} != set(_ROLES)):
            raise ValueError("Invalid time audit projection")


def audit_time_boundaries(games):
    """Anonymous counts, no fitting/scoring/IO and no outcome fields accepted.

    Timestamps are interpreted as epoch milliseconds, durations as seconds.
    Six-hour duration and years 2000..2100 are plausibility heuristics, not
    proofs of units or hard exclusions. All valid rows, including duplicate
    keys, remain in diagnostics. Duplicate-key history counts describe the
    literal projection, not canonical grouping/deduplication behavior.
    Shared display identity is only a proxy, not confirmed equal PUUID/person.
    There is no raw end or original ingestion timestamp in this projection;
    catalog fetched-after-end cannot establish prediction-time availability.
    """
    _validate(games)
    rows = sorted(games, key=lambda game: (game["timestamp"], game["gameId"]))
    prepared = [(game, game["timestamp"] + game["duration"] * 1000,
                 {p["member"] for p in game["players"]}) for game in rows]
    keys = Counter((game["timestamp"], game["gameId"]) for game in rows)
    result = {
        "schemaVersion": 1,
        "games": len(rows),
        "comparisons": len(rows) * (len(rows) - 1) // 2,
        "exactGameKeyDuplicatePairs": sum(n * (n - 1) // 2 for n in keys.values()),
        "exactGameKeyDuplicateExtraRows": sum(n - 1 for n in keys.values()),
        "sameStartPairsSharingDisplayMember": 0,
        "sameStartPairsDisjointDisplayMembers": 0,
        "strictEarlierStartEstimatedOverlapPairsSharingDisplayMember": 0,
        "strictEarlierStartEstimatedOverlapPairsDisjointDisplayMembers": 0,
        "strictEarlierStartPairsEstimatedEndedByCurrentStart": 0,
        "durationSecondsWithin900To21600": sum(900 <= game["duration"] <= 21600 for game in rows),
        "durationSecondsAbove21600": sum(game["duration"] > 21600 for game in rows),
        "timestampWithin2000To2100EpochMilliseconds": sum(
            946684800000 <= game["timestamp"] < 4102444800000 for game in rows),
        "timestampOutside2000To2100EpochMilliseconds": sum(
            not 946684800000 <= game["timestamp"] < 4102444800000 for game in rows),
        "sameDisplayIdentityOnlyProxy": True,
        "endTimesEstimatedFromStartAndDuration": True,
        "rawEndTimesAvailable": False,
        "originalIngestionTimesAvailable": False,
        "fetchedAfterEndEstablishesAsOfAvailability": False,
        "history": {},
    }
    for i, (current, _end, current_members) in enumerate(prepared):
        for previous, previous_end, previous_members in prepared[:i]:
            shared = bool(current_members & previous_members)
            if previous["timestamp"] == current["timestamp"]:
                key = ("sameStartPairsSharingDisplayMember" if shared
                       else "sameStartPairsDisjointDisplayMembers")
            elif previous_end > current["timestamp"]:
                key = ("strictEarlierStartEstimatedOverlapPairsSharingDisplayMember" if shared
                       else "strictEarlierStartEstimatedOverlapPairsDisjointDisplayMembers")
            else:
                key = "strictEarlierStartPairsEstimatedEndedByCurrentStart"
            result[key] += 1
    for side in ("all", "Blue", "Red"):
        selected = [(game, end) for game, end, _members in prepared
                    if side == "all" or game["side"] == side]
        for limit in (5, 20):
            histories = defaultdict(list)
            bucket = {
                "games": len(selected), "slotQueries": 5 * len(selected),
                "historyEntries": 0, "unfinishedEstimatedHistoryEntries": 0,
                "slotQueriesWithUnfinishedEstimatedHistory": 0,
                "gamesWithUnfinishedEstimatedHistory": 0,
                "warmedSlotQueries": 0, "warmedSlotQueriesWithUnfinishedEstimatedHistory": 0,
                "warmedUnfinishedEstimatedHistoryEntries": 0,
            }
            i = 0
            while i < len(selected):
                j = i + 1
                while j < len(selected) and selected[j][0]["timestamp"] == selected[i][0]["timestamp"]:
                    j += 1
                for game, _end in selected[i:j]:
                    any_unfinished = False
                    for player in game["players"]:
                        history = histories[player["member"], player["role"]]
                        unfinished = sum(end > game["timestamp"] for end in history)
                        bucket["historyEntries"] += len(history)
                        bucket["unfinishedEstimatedHistoryEntries"] += unfinished
                        bucket["slotQueriesWithUnfinishedEstimatedHistory"] += unfinished > 0
                        any_unfinished |= unfinished > 0
                        if len(history) >= 5:
                            bucket["warmedSlotQueries"] += 1
                            bucket["warmedSlotQueriesWithUnfinishedEstimatedHistory"] += unfinished > 0
                            bucket["warmedUnfinishedEstimatedHistoryEntries"] += unfinished
                    bucket["gamesWithUnfinishedEstimatedHistory"] += any_unfinished
                # Ties query the same strictly earlier prefix; none warms another.
                for game, end in selected[i:j]:
                    for player in game["players"]:
                        key = player["member"], player["role"]
                        histories[key] = (histories[key] + [end])[-limit:]
                i = j
            result["history"][f"{side}-{limit}"] = bucket
    return result
