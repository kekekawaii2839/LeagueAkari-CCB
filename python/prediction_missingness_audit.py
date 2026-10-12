"""Pure fixed-schema missingness counts; no IO, converter, labels, or scoring.

Finite agreement does not establish source definitions. Source ``nonfinite``
includes nonnumeric values and booleans; none are silently converted to zero.
"""

import math


MAPPINGS = (
    ("visionScore", "vision"),
    ("kills", "kills"),
    ("deaths", "deaths"),
    ("assists", "assists"),
    ("totalDamageDealtToChampions", "damage"),
    ("goldEarned", "gold"),
    ("totalDamageTaken", "damageTaken"),
    ("wardsPlaced", "wardsPlaced"),
    ("wardsKilled", "wardsKilled"),
    ("visionWardsBoughtInGame", "controlWards"),
    ("damageSelfMitigated", "damageMitigated"),
    ("damageDealtToObjectives", "objectiveDamage"),
    ("damageDealtToTurrets", "turretDamage"),
    ("totalHealsOnTeammates", "healTeammates"),
    ("totalDamageShieldedOnTeammates", "shieldTeammates"),
    ("timeCCingOthers", "ccSeconds"),
    ("challenges.soloKills", "soloKills"),
    ("challenges.damageTakenOnTeamPercentage", "takenShare"),
)
FRAME_FIELDS = (
    "damageStats.totalDamageDoneToChampions",
    "totalGold", "xp", "minionsKilled", "jungleMinionsKilled",
)
SOURCE_STATES = ("missing", "null", "nonfinite", "zero", "finite")
DERIVED_STATES = ("missing", "null", "zero", "finite", "invalid")
FRAME_STATES = (
    "no_frame", "no_resolved_enemy", "no_participant", *SOURCE_STATES,
)
ROLES = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
_MISSING = object()


def _object(value):
    return value if isinstance(value, dict) else {}


def _unwrap(value):
    value = _object(value)
    return _object(value.get("json", value))


def _rows(value):
    return [row for row in value if isinstance(row, dict)] if isinstance(value, list) else []


def _finite(value):
    if type(value) not in (int, float):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def _get(row, path):
    for key in path.split("."):
        if not isinstance(row, dict) or key not in row:
            return _MISSING
        row = row[key]
    return row


def _state(value, derived=False):
    if value is _MISSING:
        return "missing"
    if value is None:
        return "null"
    if not _finite(value):
        return "invalid" if derived else "nonfinite"
    return "zero" if value == 0 else "finite"


def _role(row):
    value = row.get("teamPosition") or row.get("individualPosition") or row.get("lane")
    value = value.upper() if isinstance(value, str) else None
    return {"MID": "MIDDLE", "SUPPORT": "UTILITY"}.get(value, value)


def _participant(frame, participant):
    participant_id = participant.get("participantId")
    if type(participant_id) is not int or participant_id <= 0:
        return None
    entries = _object(frame.get("participantFrames"))
    value = entries.get(str(participant_id), entries.get(participant_id))
    return value if isinstance(value, dict) and value else None


def audit_missingness(records):
    """Audit <=1000 parsed records, returning fixed keys and integer counts only.

    Mapping matrix cells count target participants, not independent matches.
    ``missing_or_null_to_zero`` and ``nonfinite_to_zero`` flag representations,
    not a claim of erroneous provider data. No source values are returned.
    Frame selection independently mirrors closest 900000ms +/-1000ms, with
    first input frame winning an equal-distance tie. Short/no-frame records
    remain explicitly no_frame; no unavailable measurements become zeros.
    """
    if not isinstance(records, list) or len(records) > 1000:
        raise ValueError("Expected at most 1000 parsed records")
    mappings = {
        source: {
            "matrix": {state: dict.fromkeys(DERIVED_STATES, 0) for state in SOURCE_STATES},
            "missing_or_null_to_zero": 0,
            "nonfinite_to_zero": 0,
        }
        for source, _ in MAPPINGS
    }
    result = {
        "records": len(records),
        "targets": 0,
        "records_without_exact_five_targets": 0,
        "derived_resolution": dict.fromkeys(("unique", "missing", "ambiguous"), 0),
        "enemy_resolution": dict.fromkeys(("unique", "unresolved"), 0),
        "mappings": mappings,
        "frame15": {
            population: {field: dict.fromkeys(FRAME_STATES, 0) for field in FRAME_FIELDS}
            for population in ("target", "enemy")
        },
    }
    for record in records:
        record = _object(record)
        source = _unwrap(record.get("summary"))
        participants = _rows(source.get("participants"))
        selected = [row for row in participants if row.get("_target") is True]
        result["targets"] += len(selected)
        result["records_without_exact_five_targets"] += int(len(selected) != 5)
        players = _rows(_object(record.get("derived")).get("players"))
        frames = _rows(_unwrap(record.get("details")).get("frames"))
        candidates = [row for row in frames if _finite(row.get("timestamp"))
                      and abs(row["timestamp"] - 900000) <= 1000]
        frame = min(candidates, key=lambda row: abs(row["timestamp"] - 900000), default=None)
        for row in selected:
            role = _role(row)
            matches = [player for player in players if role in ROLES and player.get("role") == role]
            resolution = "unique" if len(matches) == 1 else "missing" if not matches else "ambiguous"
            result["derived_resolution"][resolution] += 1
            player = matches[0] if resolution == "unique" else {}
            for source_path, derived_key in MAPPINGS:
                source_state = _state(_get(row, source_path))
                derived_state = "invalid" if resolution == "ambiguous" else _state(_get(player, derived_key), True)
                bucket = mappings[source_path]
                bucket["matrix"][source_state][derived_state] += 1
                if derived_state == "zero":
                    if source_state in ("missing", "null"):
                        bucket["missing_or_null_to_zero"] += 1
                    elif source_state == "nonfinite":
                        bucket["nonfinite_to_zero"] += 1
            team = row.get("teamId")
            enemies = [other for other in participants
                       if type(team) is int and team in (100, 200)
                       and type(other.get("teamId")) is int and other["teamId"] == 300 - team
                       and role in ROLES and _role(other) == role]
            enemy = enemies[0] if len(enemies) == 1 else None
            result["enemy_resolution"]["unique" if enemy is not None else "unresolved"] += 1
            for population, participant in (("target", row), ("enemy", enemy)):
                participant_frame = _participant(frame, participant) if frame is not None and participant is not None else None
                for field in FRAME_FIELDS:
                    if frame is None:
                        state = "no_frame"
                    elif participant is None:
                        state = "no_resolved_enemy"
                    elif participant_frame is None:
                        state = "no_participant"
                    else:
                        state = _state(_get(participant_frame, field))
                    result["frame15"][population][field][state] += 1
    return result
