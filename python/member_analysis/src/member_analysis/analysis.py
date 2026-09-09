from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Any


ROLES = ("TOP", "JUNGLE", "MIDDLE", "BOTTOM", "UTILITY")
ANALYSIS_MINUTES = 14
KILL_WEIGHT = 5
COMBAT_GAP_MS = 15_000
COMBAT_DISTANCE = 2_500
CONVERSION_WINDOW_MS = 90_000
OBJECTIVE_SETUP_WINDOW_MS = 60_000
CROSS_MAP_BEFORE_MS = 30_000
CROSS_MAP_AFTER_MS = 90_000
CROSS_MAP_DISTANCE = 4_000
CAMPS = (
    {"x": 3830, "y": 7880, "camp": "blue", "side": "blue"},
    {"x": 2100, "y": 8400, "camp": "gromp", "side": "blue"},
    {"x": 3800, "y": 6440, "camp": "wolves", "side": "blue"},
    {"x": 7760, "y": 4010, "camp": "red", "side": "blue"},
    {"x": 6970, "y": 5460, "camp": "raptors", "side": "blue"},
    {"x": 8400, "y": 2700, "camp": "krugs", "side": "blue"},
    {"x": 10990, "y": 7000, "camp": "blue", "side": "red"},
    {"x": 12720, "y": 6480, "camp": "gromp", "side": "red"},
    {"x": 11020, "y": 8440, "camp": "wolves", "side": "red"},
    {"x": 7060, "y": 10870, "camp": "red", "side": "red"},
    {"x": 7850, "y": 9420, "camp": "raptors", "side": "red"},
    {"x": 6420, "y": 12180, "camp": "krugs", "side": "red"},
)


def number(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def ratio(numerator: float, denominator: float) -> float | None:
    return numerator / denominator if denominator else None


def role_name(participant: dict[str, Any]) -> str | None:
    value = str(
        participant.get("teamPosition")
        or participant.get("individualPosition")
        or participant.get("lane")
        or ""
    ).upper()
    aliases = {"MID": "MIDDLE", "SUPPORT": "UTILITY"}
    normalized = aliases.get(value, value)
    return normalized if normalized in ROLES else None


def participant_frame(frame: dict[str, Any] | None, participant_id: int) -> dict[str, Any] | None:
    frames = (frame or {}).get("participantFrames") or {}
    return frames.get(str(participant_id)) or frames.get(participant_id)


def frame_at(frames: list[dict[str, Any]], threshold_ms: int) -> dict[str, Any] | None:
    # Minute snapshots carry small scheduler delays (e.g. 900323 ms).
    # Accept only the closest observation within one second; never use another minute.
    candidates = [frame for frame in frames
                  if isinstance(frame.get("timestamp"), (int, float))
                  and not isinstance(frame.get("timestamp"), bool)
                  and abs(frame["timestamp"] - threshold_ms) <= 1000]
    return min(candidates, key=lambda frame: abs(frame["timestamp"] - threshold_ms), default=None)


def all_events(frames: list[dict[str, Any]]):
    for frame in frames:
        yield from frame.get("events") or []


def event_team(event: dict[str, Any], participant_teams: dict[int, int]) -> int | None:
    event_type = event.get("type")
    if event_type == "CHAMPION_KILL":
        return participant_teams.get(int(event.get("killerId") or 0))
    if event_type == "ELITE_MONSTER_KILL":
        return int(event.get("killerTeamId") or 0) or participant_teams.get(
            int(event.get("killerId") or 0)
        )
    if event_type in ("BUILDING_KILL", "TURRET_PLATE_DESTROYED"):
        destroyed_team = int(event.get("teamId") or 0)
        if destroyed_team in (100, 200):
            return 300 - destroyed_team
        return participant_teams.get(int(event.get("killerId") or 0))
    return None


def position_distance(first: dict[str, Any] | None, second: dict[str, Any] | None) -> float:
    if not first or not second:
        return math.inf
    return math.hypot(
        number(first.get("x")) - number(second.get("x")),
        number(first.get("y")) - number(second.get("y")),
    )


def classify_map_zone(x: float, y: float) -> str:
    if x < 5000 and y > 9000:
        return "top"
    if x > 9000 and y < 5000:
        return "bot"
    return "mid" if abs(y - x) <= 3500 else ("top" if y > x else "bot")


def classify_gank_lane(x: float, y: float) -> str | None:
    if x < 5000 and y > 9000:
        return "top"
    if x > 9000 and y < 5000:
        return "bot"
    midpoint = (x + y) / 2
    if abs(y - x) < 4000 and 3000 < midpoint < 12000:
        return "mid"
    return None


def detect_start_camp(position: dict[str, Any] | None) -> dict[str, Any] | None:
    if not position or position.get("x") is None or position.get("y") is None:
        return None
    x, y = number(position["x"]), number(position["y"])
    return min(CAMPS, key=lambda camp: (x - camp["x"]) ** 2 + (y - camp["y"]) ** 2)


def objective_value(event: dict[str, Any]) -> float:
    event_type = event.get("type")
    if event_type == "ELITE_MONSTER_KILL":
        return {"HORDE": 0.35, "DRAGON": 1.5, "RIFTHERALD": 1.5, "BARON_NASHOR": 3.0}.get(
            str(event.get("monsterType")), 1.0
        )
    if event_type == "TURRET_PLATE_DESTROYED":
        return 0.25
    if event_type == "BUILDING_KILL":
        if event.get("buildingType") == "INHIBITOR_BUILDING":
            return 2.5
        return {
            "OUTER_TURRET": 1.5,
            "INNER_TURRET": 2.0,
            "BASE_TURRET": 2.5,
            "NEXUS_TURRET": 3.0,
        }.get(str(event.get("towerType")), 2.0)
    return 0.0


def group_combat_episodes(kills: list[dict[str, Any]]) -> list[dict[str, Any]]:
    episodes: list[dict[str, Any]] = []
    for event in sorted(kills, key=lambda row: number(row.get("timestamp"))):
        if episodes:
            previous = episodes[-1]["events"][-1]
            gap = number(event.get("timestamp")) - number(previous.get("timestamp"))
            distance = position_distance(event.get("position"), previous.get("position"))
        else:
            gap, distance = math.inf, math.inf
        if not episodes or gap > COMBAT_GAP_MS or distance > COMBAT_DISTANCE:
            episodes.append({"events": [event]})
        else:
            episodes[-1]["events"].append(event)
    for episode in episodes:
        episode["start"] = number(episode["events"][0].get("timestamp"))
        episode["end"] = number(episode["events"][-1].get("timestamp"))
    return episodes


def build_event_decision_payload(
    frames: list[dict[str, Any]], target_team: int, participant_teams: dict[int, int]
) -> dict[str, Any]:
    events = sorted(all_events(frames), key=lambda row: number(row.get("timestamp")))
    kills = [event for event in events if event.get("type") == "CHAMPION_KILL"]
    epics = [event for event in events if event.get("type") == "ELITE_MONSTER_KILL"]
    buildings = [
        event
        for event in events
        if event.get("type") == "BUILDING_KILL" and event.get("buildingType") == "TOWER_BUILDING"
    ]
    plates = [event for event in events if event.get("type") == "TURRET_PLATE_DESTROYED"]
    map_events = epics + buildings
    episodes = group_combat_episodes(kills)
    owner = lambda event: event_team(event, participant_teams)
    kill_indices = [
        index
        for index, episode in enumerate(episodes)
        if any(owner(event) == target_team for event in episode["events"])
    ]
    death_indices = [
        index
        for index, episode in enumerate(episodes)
        if any(owner(event) == 300 - target_team for event in episode["events"])
    ]

    def attributed(
        episode_index: int,
        candidate_indices: list[int],
        candidates: list[dict[str, Any]],
        event_owner: int,
    ) -> list[dict[str, Any]]:
        result = []
        for event in candidates:
            timestamp = number(event.get("timestamp"))
            if owner(event) != event_owner:
                continue
            eligible = [
                index
                for index in candidate_indices
                if episodes[index]["start"] <= timestamp <= episodes[index]["end"] + CONVERSION_WINDOW_MS
            ]
            if eligible and max(eligible, key=lambda index: episodes[index]["start"]) == episode_index:
                result.append(event)
        return result

    kill_episodes = converted = kill_to_epic = kill_to_tower = 0
    conversion_delays: list[float] = []
    death_episodes = high_cost_deaths = 0
    death_cost_epics = death_cost_towers = death_cost_plates = 0
    death_cost_points = shutdown_bounty_lost = 0.0
    for index, episode in enumerate(episodes):
        our_kills = sum(owner(event) == target_team for event in episode["events"])
        our_deaths = sum(owner(event) == 300 - target_team for event in episode["events"])
        if our_kills:
            kill_episodes += 1
            gains = attributed(index, kill_indices, map_events, target_team)
            if gains:
                converted += 1
                conversion_delays.append(
                    (number(gains[0].get("timestamp")) - episode["start"]) / 1000
                )
            kill_to_epic += int(any(event.get("type") == "ELITE_MONSTER_KILL" for event in gains))
            kill_to_tower += int(any(event.get("type") == "BUILDING_KILL" for event in gains))
        if our_deaths:
            death_episodes += 1
            losses = attributed(index, death_indices, map_events + plates, 300 - target_team)
            lost_epics = [event for event in losses if event.get("type") == "ELITE_MONSTER_KILL"]
            lost_towers = [event for event in losses if event.get("type") == "BUILDING_KILL"]
            lost_plates = [event for event in losses if event.get("type") == "TURRET_PLATE_DESTROYED"]
            shutdown = sum(
                number(event.get("shutdownBounty"))
                for event in episode["events"]
                if owner(event) == 300 - target_team
            )
            if lost_epics or lost_towers or shutdown:
                high_cost_deaths += 1
            death_cost_epics += len(lost_epics)
            death_cost_towers += len(lost_towers)
            death_cost_plates += len(lost_plates)
            death_cost_points += sum(objective_value(event) for event in losses) + shutdown / 300
            shutdown_bounty_lost += shutdown

    our_objectives = [event for event in epics if owner(event) == target_team]
    clean = won = even = lost = fight_samples = fight_wins = 0
    for objective in epics:
        timestamp = number(objective.get("timestamp"))
        nearby = [
            kill
            for kill in kills
            if timestamp - OBJECTIVE_SETUP_WINDOW_MS <= number(kill.get("timestamp")) <= timestamp
            and position_distance(kill.get("position"), objective.get("position")) <= 3000
        ]
        if nearby:
            fight_samples += 1
            ours = sum(owner(kill) == target_team for kill in nearby)
            theirs = sum(owner(kill) == 300 - target_team for kill in nearby)
            if owner(objective) == target_team and ours > theirs:
                fight_wins += 1
    for objective in our_objectives:
        timestamp = number(objective.get("timestamp"))
        nearby = [
            kill
            for kill in kills
            if timestamp - OBJECTIVE_SETUP_WINDOW_MS <= number(kill.get("timestamp")) <= timestamp
            and position_distance(kill.get("position"), objective.get("position")) <= 3000
        ]
        ours = sum(owner(kill) == target_team for kill in nearby)
        theirs = sum(owner(kill) == 300 - target_team for kill in nearby)
        if not nearby:
            clean += 1
        elif ours > theirs:
            won += 1
        elif ours < theirs:
            lost += 1
        else:
            even += 1

    enemy_objectives = [event for event in epics if owner(event) == 300 - target_team]
    traded = 0
    trade_delays: list[float] = []
    for objective in enemy_objectives:
        timestamp = number(objective.get("timestamp"))
        trades = [
            event
            for event in map_events
            if timestamp - CROSS_MAP_BEFORE_MS
            <= number(event.get("timestamp"))
            <= timestamp + CROSS_MAP_AFTER_MS
            and owner(event) == target_team
            and position_distance(event.get("position"), objective.get("position")) >= CROSS_MAP_DISTANCE
        ]
        if trades:
            traded += 1
            trade_delays.append((number(trades[0].get("timestamp")) - timestamp) / 1000)
    return {
        "killEpisodes": kill_episodes,
        "convertedKillEpisodes": converted,
        "killToEpicEpisodes": kill_to_epic,
        "killToTowerEpisodes": kill_to_tower,
        "conversionDelayTotalSec": sum(conversion_delays),
        "conversionDelaySamples": len(conversion_delays),
        "deathEpisodes": death_episodes,
        "highCostDeathEpisodes": high_cost_deaths,
        "deathCostEpics": death_cost_epics,
        "deathCostTowers": death_cost_towers,
        "deathCostPlates": death_cost_plates,
        "deathCostPoints": round(death_cost_points, 3),
        "shutdownBountyLost": shutdown_bounty_lost,
        "objectivesTaken": len(our_objectives),
        "cleanObjectives": clean,
        "wonFightObjectives": won,
        "evenFightObjectives": even,
        "lostFightObjectives": lost,
        "objectiveFightSamples": fight_samples,
        "objectiveFightWins": fight_wins,
        "enemyObjectives": len(enemy_objectives),
        "tradedEnemyObjectives": traded,
        "tradeDelayTotalSec": sum(trade_delays),
        "tradeDelaySamples": len(trade_delays),
    }


def build_jungle_payload(
    frames: list[dict[str, Any]],
    jungler: dict[str, Any] | None,
    target_team: int,
    participant_teams: dict[int, int],
) -> dict[str, Any] | None:
    if not jungler:
        return None
    participant_id = int(jungler["participantId"])
    own_side = "blue" if target_team == 100 else "red"
    pf1 = participant_frame(frames[1] if len(frames) > 1 else None, participant_id)
    start_camp = detect_start_camp((pf1 or {}).get("position"))
    zone_weights = {"top": 0.0, "mid": 0.0, "bot": 0.0}
    total_zone_weight = 0.0
    for frame in frames[1 : min(len(frames), ANALYSIS_MINUTES + 1)]:
        position = (participant_frame(frame, participant_id) or {}).get("position")
        if not position:
            continue
        zone = classify_map_zone(number(position["x"]), number(position["y"]))
        zone_weights[zone] += 1
        total_zone_weight += 1

    ganks = {"top": 0, "mid": 0, "bot": 0}
    level3_kills = level4_kills = 0
    events = list(all_events(frames))
    for event in events:
        if event.get("type") != "CHAMPION_KILL":
            continue
        involved = event.get("killerId") == participant_id or participant_id in (
            event.get("assistingParticipantIds") or []
        )
        if not involved:
            continue
        timestamp = number(event.get("timestamp"))
        position = event.get("position") or {}
        if timestamp <= 240_000:
            if timestamp <= 180_000:
                level3_kills += 1
            else:
                level4_kills += 1
        if (
            timestamp <= ANALYSIS_MINUTES * 60_000
            and position.get("x") is not None
            and position.get("y") is not None
        ):
            x, y = number(position["x"]), number(position["y"])
            zone = classify_map_zone(x, y)
            zone_weights[zone] += KILL_WEIGHT
            total_zone_weight += KILL_WEIGHT
            lane = classify_gank_lane(x, y)
            if lane:
                ganks[lane] += 1

    pf3 = participant_frame(frames[3] if len(frames) > 3 else None, participant_id)
    pf4 = participant_frame(frames[4] if len(frames) > 4 else None, participant_id)
    level3 = level4 = False
    if pf3:
        cs3 = number(pf3.get("minionsKilled")) + number(pf3.get("jungleMinionsKilled"))
        damage3 = number((pf3.get("damageStats") or {}).get("totalDamageDoneToChampions"))
        level3 = 12 <= cs3 < 20 and number(pf3.get("level")) == 3 and (
            damage3 > 0 or level3_kills > 0
        )
        if pf4:
            damage4 = number((pf4.get("damageStats") or {}).get("totalDamageDoneToChampions"))
            level4 = damage4 > damage3 or level4_kills > 0

    first_dragon_team = None
    first_dragon_time = first_voidgrub_time = first_herald_time = first_baron_time = None
    dragons = solo_dragons = voidgrubs = heralds = barons = 0
    for event in events:
        if event.get("type") != "ELITE_MONSTER_KILL":
            continue
        killer_id = int(event.get("killerId") or 0)
        killer_team = int(event.get("killerTeamId") or 0) or participant_teams.get(killer_id)
        is_ours = killer_team == target_team
        timestamp = number(event.get("timestamp")) / 1000
        monster = event.get("monsterType")
        if monster == "DRAGON":
            if first_dragon_team is None:
                first_dragon_team = killer_team
            if is_ours:
                dragons += 1
                if first_dragon_time is None:
                    first_dragon_time = timestamp
                if killer_id == participant_id and not (event.get("assistingParticipantIds") or []):
                    solo_dragons += 1
        elif monster == "HORDE" and is_ours:
            voidgrubs += 1
            if first_voidgrub_time is None:
                first_voidgrub_time = timestamp
        elif monster == "RIFTHERALD" and is_ours:
            heralds += 1
            if first_herald_time is None:
                first_herald_time = timestamp
        elif monster == "BARON_NASHOR" and is_ours:
            barons += 1
            if first_baron_time is None:
                first_baron_time = timestamp
    return {
        "player": str(jungler.get("_targetName")),
        "champion": str(jungler.get("championName") or jungler.get("championId") or "Unknown"),
        "startCamp": start_camp["camp"] if start_camp else None,
        "startCampSide": start_camp["side"] if start_camp else None,
        "startCampOwn": start_camp["side"] == own_side if start_camp else None,
        "level3Gank": level3,
        "level4Gank": level4,
        "topGanks": ganks["top"],
        "midGanks": ganks["mid"],
        "botGanks": ganks["bot"],
        "topZoneWeight": zone_weights["top"],
        "midZoneWeight": zone_weights["mid"],
        "botZoneWeight": zone_weights["bot"],
        "totalZoneWeight": total_zone_weight,
        "gotFirstDragon": first_dragon_team == target_team if first_dragon_team is not None else None,
        "dragons": dragons,
        "soloDragons": solo_dragons,
        "firstDragonTimeSec": first_dragon_time,
        "voidgrubs": voidgrubs,
        "firstVoidgrubTimeSec": first_voidgrub_time,
        "heralds": heralds,
        "firstHeraldTimeSec": first_herald_time,
        "barons": barons,
        "firstBaronTimeSec": first_baron_time,
    }


def build_lane_gank_deaths_payload(
    frames: list[dict[str, Any]],
    target_players_by_role: dict[str, dict[str, Any]],
    enemy_jungler: dict[str, Any] | None,
) -> dict[str, Any]:
    """Record successful, lane-aligned enemy-jungler ganks before 14:00."""
    if not frames:
        return {"methodVersion": 1, "status": "unavailable", "reason": "timeline-incomplete"}
    if not enemy_jungler:
        return {"methodVersion": 1, "status": "unavailable", "reason": "enemy-jungler-unresolved"}

    enemy_jungler_id = int(enemy_jungler.get("participantId") or 0)
    if not enemy_jungler_id:
        return {"methodVersion": 1, "status": "unavailable", "reason": "enemy-jungler-unresolved"}

    target_by_id = {
        int(player.get("participantId") or 0): (role, player)
        for role, player in target_players_by_role.items()
        if role != "JUNGLE" and int(player.get("participantId") or 0)
    }
    expected_lane = {"TOP": "top", "MIDDLE": "mid", "BOTTOM": "bot", "UTILITY": "bot"}
    output = []
    for event in sorted(all_events(frames), key=lambda row: number(row.get("timestamp"))):
        if event.get("type") != "CHAMPION_KILL":
            continue
        raw_timestamp = event.get("timestamp")
        if not isinstance(raw_timestamp, (int, float)) or not math.isfinite(raw_timestamp):
            continue
        timestamp_ms = float(raw_timestamp)
        if timestamp_ms < 0 or timestamp_ms >= ANALYSIS_MINUTES * 60_000:
            continue
        victim = target_by_id.get(int(event.get("victimId") or 0))
        if not victim:
            continue
        killer_id = int(event.get("killerId") or 0)
        assisting_ids = {int(value) for value in (event.get("assistingParticipantIds") or [])}
        involved = killer_id == enemy_jungler_id or enemy_jungler_id in assisting_ids
        if not involved:
            continue
        position = event.get("position") or {}
        if position.get("x") is None or position.get("y") is None:
            continue
        lane = classify_gank_lane(number(position["x"]), number(position["y"]))
        role, player = victim
        if lane != expected_lane.get(role):
            continue
        output.append(
            {
                "victimPlayer": str(player.get("_targetName") or "Unknown"),
                "victimRole": role,
                "victimChampion": str(
                    player.get("championName") or player.get("championId") or "Unknown"
                ),
                "enemyJunglerChampion": str(
                    enemy_jungler.get("championName")
                    or enemy_jungler.get("championId")
                    or "Unknown"
                ),
                "timestampSec": timestamp_ms / 1000,
                "lane": lane,
                "involvement": "killer" if killer_id == enemy_jungler_id else "assist",
            }
        )
    return {"methodVersion": 1, "status": "available", "events": output}


def objective_features(
    frames: list[dict[str, Any]], target_team: int, participant_teams: dict[int, int]
) -> dict[str, float]:
    opponent_team = 300 - target_team
    events = []
    kills = []
    for event in all_events(frames):
        value = dict(event)
        value["_owner"] = event_team(event, participant_teams)
        events.append(value)
        if event.get("type") == "CHAMPION_KILL" and value["_owner"] in (100, 200):
            kills.append(value)
    events.sort(key=lambda row: number(row.get("timestamp")))
    output: dict[str, float] = {}
    for minute in (15, 20):
        cutoff = minute * 60_000
        for monster, label in (
            ("DRAGON", "dragon"),
            ("HORDE", "grub"),
            ("RIFTHERALD", "herald"),
            ("BARON_NASHOR", "baron"),
        ):
            selected = [
                event
                for event in events
                if event.get("type") == "ELITE_MONSTER_KILL"
                and event.get("monsterType") == monster
                and number(event.get("timestamp")) <= cutoff
                and event["_owner"] in (100, 200)
            ]
            output[f"m{minute}_{label}_diff"] = sum(
                event["_owner"] == target_team for event in selected
            ) - sum(event["_owner"] == opponent_team for event in selected)
        towers = [
            event
            for event in events
            if event.get("type") == "BUILDING_KILL"
            and event.get("buildingType") == "TOWER_BUILDING"
            and number(event.get("timestamp")) <= cutoff
            and event["_owner"] in (100, 200)
        ]
        output[f"m{minute}_towers_diff"] = sum(
            event["_owner"] == target_team for event in towers
        ) - sum(event["_owner"] == opponent_team for event in towers)
        epic = [
            event
            for event in events
            if event.get("type") == "ELITE_MONSTER_KILL"
            and event.get("monsterType") in ("DRAGON", "HORDE", "RIFTHERALD", "BARON_NASHOR")
            and number(event.get("timestamp")) <= cutoff
            and event["_owner"] in (100, 200)
        ]
        fight_kills = {100: 0, 200: 0}
        seen_windows: set[tuple[Any, int]] = set()
        for event in epic:
            timestamp = number(event.get("timestamp"))
            bucket = (event.get("monsterType"), int(timestamp // 120_000))
            if bucket in seen_windows:
                continue
            seen_windows.add(bucket)
            for kill in kills:
                if timestamp - 60_000 <= number(kill.get("timestamp")) <= timestamp + 45_000:
                    fight_kills[int(kill["_owner"])] += 1
        output[f"m{minute}_objective_fight_kill_diff"] = (
            fight_kills[target_team] - fight_kills[opponent_team]
        )
    frame20 = frame_at(frames, 20 * 60_000)
    target_gold = opponent_gold = 0.0
    for participant_id, participant in (frame20 or {}).get("participantFrames", {}).items():
        team = participant_teams.get(int(participant_id))
        if team == target_team:
            target_gold += number(participant.get("totalGold"))
        elif team == opponent_team:
            opponent_gold += number(participant.get("totalGold"))
    output["m20_gold_diff"] = target_gold - opponent_gold
    return output


def lane_differences(
    frames: list[dict[str, Any]],
    events: list[dict[str, Any]],
    participant: dict[str, Any],
    opponent: dict[str, Any] | None,
) -> dict[str, float | None]:
    if not opponent:
        return {key: None for key in ("gd10", "gd15", "csd15", "xpd15", "damageDiff15", "soloDiff15")}
    target_id, opponent_id = int(participant["participantId"]), int(opponent["participantId"])

    def diff(minute: int, getter) -> float | None:
        frame = frame_at(frames, minute * 60_000)
        ours = participant_frame(frame, target_id)
        theirs = participant_frame(frame, opponent_id)
        return getter(ours) - getter(theirs) if ours and theirs else None

    cs = lambda row: number(row.get("minionsKilled")) + number(row.get("jungleMinionsKilled"))
    damage = lambda row: number((row.get("damageStats") or {}).get("totalDamageDoneToChampions"))
    solo_diff = 0
    for event in events:
        if event.get("type") != "CHAMPION_KILL" or number(event.get("timestamp")) > 900_000:
            continue
        if event.get("assistingParticipantIds"):
            continue
        killer, victim = int(event.get("killerId") or 0), int(event.get("victimId") or 0)
        if killer == target_id and victim == opponent_id:
            solo_diff += 1
        elif killer == opponent_id and victim == target_id:
            solo_diff -= 1
    return {
        "gd10": diff(10, lambda row: number(row.get("totalGold"))),
        "gd15": diff(15, lambda row: number(row.get("totalGold"))),
        "csd15": diff(15, cs),
        "xpd15": diff(15, lambda row: number(row.get("xp"))),
        "damageDiff15": diff(15, damage),
        "soloDiff15": float(solo_diff),
    }


def derive_game(summary: dict[str, Any], details: dict[str, Any]) -> dict[str, Any]:
    value = summary.get("json", summary)
    timeline = details.get("json", details)
    participants = value.get("participants") or []
    selected = [row for row in participants if row.get("_target")]
    teams = {int(row.get("teamId") or 0) for row in selected}
    if len(selected) != 5 or len(teams) != 1:
        raise ValueError("match is not an exact configured five-player stack")
    target_team = teams.pop()
    enemies = [row for row in participants if int(row.get("teamId") or 0) == 300 - target_team]
    participant_teams = {
        int(row.get("participantId") or 0): int(row.get("teamId") or 0) for row in participants
    }
    frames = timeline.get("frames") or []
    events = list(all_events(frames))
    team_kills = int(sum(number(row.get("kills")) for row in selected))
    team_deaths = int(sum(number(row.get("deaths")) for row in selected))
    team_damage = sum(number(row.get("totalDamageDealtToChampions")) for row in selected)
    team_gold = sum(number(row.get("goldEarned")) for row in selected)
    by_role = {role_name(row): row for row in selected if role_name(row)}
    enemies_by_role = {role_name(row): row for row in enemies if role_name(row)}
    players = []
    for role in ROLES:
        row = by_role.get(role)
        if not row:
            continue
        name = str(row.get("_targetName") or "Unknown")
        damage_value = number(row.get("totalDamageDealtToChampions"))
        gold_value = number(row.get("goldEarned"))
        taken_value = number(row.get("totalDamageTaken"))
        challenges = row.get("challenges") or {}
        minutes = max(number(row.get("timePlayed") or value.get("gameDuration")) / 60, 1 / 60)
        lane = lane_differences(frames, events, row, enemies_by_role.get(role))
        kp = challenges.get("killParticipation")
        if kp is None:
            kp = ratio(number(row.get("kills")) + number(row.get("assists")), team_kills)
        players.append(
            {
                "player": name,
                "role": role,
                "champion": str(row.get("championName") or row.get("championId") or "Unknown"),
                "minutes": minutes,
                "kills": int(number(row.get("kills"))),
                "deaths": int(number(row.get("deaths"))),
                "assists": int(number(row.get("assists"))),
                "teamKills": team_kills,
                "teamDeaths": team_deaths,
                "damage": damage_value,
                "damageShare": ratio(damage_value, team_damage),
                "gold": gold_value,
                "goldShare": ratio(gold_value, team_gold),
                "cs": number(row.get("totalMinionsKilled")) + number(row.get("neutralMinionsKilled")),
                "vision": number(row.get("visionScore")),
                "wardsPlaced": int(number(row.get("wardsPlaced"))),
                "wardsKilled": int(number(row.get("wardsKilled"))),
                "controlWards": int(number(row.get("visionWardsBoughtInGame"))),
                "damageTaken": taken_value,
                "takenShare": challenges.get("damageTakenOnTeamPercentage"),
                "damageMitigated": number(row.get("damageSelfMitigated")),
                "objectiveDamage": number(row.get("damageDealtToObjectives")),
                "turretDamage": number(row.get("damageDealtToTurrets")),
                "healTeammates": number(row.get("totalHealsOnTeammates")),
                "shieldTeammates": number(row.get("totalDamageShieldedOnTeammates")),
                "ccSeconds": number(row.get("timeCCingOthers")),
                "soloKills": int(number(challenges.get("soloKills"))),
                "fbPart": bool(row.get("firstBloodKill") or row.get("firstBloodAssist")),
                "ftPart": bool(row.get("firstTowerKill") or row.get("firstTowerAssist")),
                "kp": kp,
                **lane,
                "counter": None,
            }
        )
    if len(players) != 5:
        raise ValueError("configured five-player stack does not have five resolved roles")
    objective = objective_features(frames, target_team, participant_teams)
    team = next(
        (row for row in value.get("teams") or [] if int(row.get("teamId") or 0) == target_team),
        {},
    )
    creation = int(value.get("gameStartTimestamp") or value.get("gameCreation") or 0)
    upper_gold = sum(
        next(player for player in players if player["role"] == role)["gd15"] or 0
        for role in ("TOP", "JUNGLE", "MIDDLE")
    )
    bot_gold = sum(
        next(player for player in players if player["role"] == role)["gd15"] or 0
        for role in ("BOTTOM", "UTILITY")
    )
    return {
        "gameId": int(value["gameId"]),
        "timestamp": creation,
        "date": datetime.fromtimestamp(creation / 1000, UTC).date().isoformat()
        if creation
        else "1970-01-01",
        "patch": ".".join(str(value.get("gameVersion") or "unknown").split(".")[:2]),
        "side": "Blue" if target_team == 100 else "Red",
        "win": bool(team.get("win", selected[0].get("win", False))),
        "duration": number(value.get("gameDuration")),
        "roster": " + ".join(sorted(player["player"] for player in players)),
        "dragon15Diff": objective["m15_dragon_diff"],
        "grub15Diff": objective["m15_grub_diff"],
        "objectiveFight15Diff": objective["m15_objective_fight_kill_diff"],
        "counterMean": None,
        "upperGold15": upper_gold,
        "botGold15": bot_gold,
        "gold20Diff": objective["m20_gold_diff"],
        "tower20Diff": objective["m20_towers_diff"],
        "jungle": build_jungle_payload(
            frames, by_role.get("JUNGLE"), target_team, participant_teams
        ),
        "laneGankDeaths": build_lane_gank_deaths_payload(
            frames, by_role, enemies_by_role.get("JUNGLE")
        ),
        "eventDecision": build_event_decision_payload(frames, target_team, participant_teams),
        "players": players,
    }
