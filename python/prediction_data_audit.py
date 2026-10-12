"""Pure anonymous source reconciliation; no IO, prediction, or converter imports.

Records contain parsed summary/derived objects and optional details/fetchedAt.
Unknown source fields remain unknown. Overlap is diagnostic, not proof of leakage.
"""

import math


ROLES = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
STATES = ("missing", "null", "zero", "finite", "invalid", "unknown")


def _finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def _object(value):
    return value if isinstance(value, dict) else {}


def _rows(value):
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _unwrap(value):
    value = _object(value)
    return _object(value.get("json", value))


def _role(row):
    raw = row.get("teamPosition") or row.get("individualPosition") or row.get("lane")
    value = raw.upper() if isinstance(raw, str) else None
    return {"MID": "MIDDLE", "SUPPORT": "UTILITY"}.get(value, value)


def _state(row, key):
    if key not in row:
        return "missing"
    value = row[key]
    if value is None:
        return "null"
    return ("zero" if value == 0 else "finite") if _finite(value) else "invalid"


def audit_prediction_records(records):
    """Return only fixed-key aggregate counts. Input objects are never mutated.

    Timestamp plausibility assumes Unix milliseconds, not a source-unit oracle.
    Pair counts are interval pairs, not independent games or causal evidence.
    """
    if not isinstance(records, list) or len(records) > 1000:
        raise ValueError("Expected parsed record list")
    checks = {}
    for key in ("five_targets", "unique_puuids", "same_team", "resolved_roles",
                "team_win", "participant_win", "side", "game_id", "timestamp",
                "duration", "patch", "end_duration", "fetched_after_end"):
        checks[key] = dict.fromkeys(("match", "mismatch", "unknown"), 0)
    metrics = {key: {"source": dict.fromkeys(STATES, 0),
                     "derived": dict.fromkeys(STATES, 0),
                     "comparison": dict.fromkeys(("match", "mismatch", "unknown"), 0)}
               for key in ("vision", "kp_challenge", "gold15", "gd15")}
    result = {"records": len(records), "checks": checks, "metrics": metrics,
              "time": dict.fromkeys(("plausible_epoch_ms", "implausible_epoch_ms", "unknown"), 0),
              "overlap": dict.fromkeys(("same_member", "disjoint_members", "unknown_members"), 0),
              "unrecoverable_plan_source": len(records)}

    def check(key, known, equal=False):
        checks[key][("match" if equal else "mismatch") if known else "unknown"] += 1

    def metric(key, source, source_key, derived, derived_key, expected=None, known=False):
        bucket = metrics[key]
        bucket["source"][_state(source, source_key) if source is not None else "unknown"] += 1
        bucket["derived"][_state(derived, derived_key) if derived is not None else "unknown"] += 1
        actual = _object(derived).get(derived_key)
        equal = _finite(actual) and math.isclose(actual, expected, rel_tol=1e-10, abs_tol=1e-10) if known else False
        bucket["comparison"][("match" if equal else "mismatch") if known else "unknown"] += 1

    intervals = []
    for record in records:
        record = _object(record)
        source, derived = _unwrap(record.get("summary")), _object(record.get("derived"))
        participants = _rows(source.get("participants"))
        selected = [row for row in participants if row.get("_target") is True]
        ids = [row.get("puuid") for row in selected]
        valid_ids = len(ids) == 5 and all(isinstance(x, str) and x for x in ids)
        teams = [row.get("teamId") for row in selected]
        known_teams = len(teams) == 5 and all(type(x) is int for x in teams)
        same = known_teams and len(set(teams)) == 1
        target = teams[0] if same else None
        check("five_targets", "participants" in source, len(selected) == 5)
        check("unique_puuids", valid_ids, len(set(ids)) == 5)
        check("same_team", known_teams, same)
        check("resolved_roles", len(selected) == 5, sorted(_role(x) or "" for x in selected) == sorted(ROLES))
        team_rows = [x for x in _rows(source.get("teams")) if x.get("teamId") == target] if same else []
        win = team_rows[0].get("win") if len(team_rows) == 1 else None
        check("team_win", type(win) is bool, type(derived.get("win")) is bool and win == derived.get("win"))
        pw = [x.get("win") for x in selected]
        check("participant_win", len(pw) == 5 and all(type(x) is bool for x in pw),
              type(derived.get("win")) is bool and all(x == derived.get("win") for x in pw))
        check("side", target in (100, 200),
              derived.get("side") == ("Blue" if target == 100 else "Red"))
        start = source.get("gameStartTimestamp") or source.get("gameCreation")
        duration, end = source.get("gameDuration"), source.get("gameEndTimestamp")
        for key, expected in (("game_id", source.get("gameId")), ("timestamp", start), ("duration", duration)):
            actual = derived.get({"game_id": "gameId", "timestamp": "timestamp", "duration": "duration"}[key])
            check(key, _finite(expected), _finite(actual) and expected == actual)
        version = source.get("gameVersion")
        check("patch", isinstance(version, str) and bool(version),
              derived.get("patch") == ".".join(version.split(".")[:2]) if isinstance(version, str) else False)
        check("end_duration", _finite(start) and _finite(end) and _finite(duration),
              abs(end - start - duration * 1000) <= 2000 if all(_finite(x) for x in (start, end, duration)) else False)
        fetched = record.get("fetchedAt")
        check("fetched_after_end", _finite(fetched) and _finite(end), fetched >= end if _finite(fetched) and _finite(end) else False)
        stamp, span = derived.get("timestamp"), derived.get("duration")
        result["time"][("plausible_epoch_ms" if 946684800000 <= stamp <= 4102444800000 else "implausible_epoch_ms") if _finite(stamp) else "unknown"] += 1
        if _finite(stamp) and _finite(span) and span > 0 and _finite(stamp + span * 1000):
            intervals.append((stamp, stamp + span * 1000, set(ids) if valid_ids and len(set(ids)) == 5 else None))
        players = _rows(derived.get("players"))
        frames = _rows(_unwrap(record.get("details")).get("frames"))
        candidates = [x for x in frames if _finite(x.get("timestamp")) and abs(x["timestamp"] - 900000) <= 1000]
        frame = min(candidates, key=lambda x: abs(x["timestamp"] - 900000), default={})
        frame_players = _object(frame.get("participantFrames"))
        for row in selected:
            role = _role(row)
            matches = [x for x in players if x.get("role") == role]
            player = matches[0] if len(matches) == 1 else {}
            vision = row.get("visionScore")
            metric("vision", row, "visionScore", player, "vision", vision, _finite(vision))
            challenge = _object(row.get("challenges"))
            kp = challenge.get("killParticipation")
            metric("kp_challenge", challenge, "killParticipation", player, "kp", kp, _finite(kp))
            ours = _object(frame_players.get(str(row.get("participantId")), frame_players.get(row.get("participantId"))))
            enemies = [x for x in participants if target in (100, 200) and x.get("teamId") == 300 - target and _role(x) == role]
            enemy = enemies[0] if len(enemies) == 1 else {}
            theirs = _object(frame_players.get(str(enemy.get("participantId")), frame_players.get(enemy.get("participantId"))))
            gold, other = ours.get("totalGold"), theirs.get("totalGold")
            # gold15 is source availability only; derived has no absolute gold15 field.
            metric("gold15", ours if frame else None, "totalGold", None, "gold15")
            known = _finite(gold) and _finite(other)
            expected = gold - other if known else None
            metric("gd15", {"value": expected} if known else None, "value", player, "gd15", expected, known)
    active = []
    for start, end, ids in sorted(intervals, key=lambda x: (x[0], x[1])):
        active = [x for x in active if x[0] > start]
        for _, previous_ids in active:
            key = "unknown_members" if ids is None or previous_ids is None else "same_member" if ids & previous_ids else "disjoint_members"
            result["overlap"][key] += 1
        active.append((end, ids))
    return result
