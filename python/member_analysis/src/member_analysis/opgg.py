from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Iterable, NamedTuple
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROLE_PATH = {
    "TOP": "top",
    "MIDDLE": "mid",
    "BOTTOM": "adc",
    "UTILITY": "support",
}
MAX_REQUESTS = 300


class Matchup(NamedTuple):
    role: str
    champion: str
    opponent: str
    patch: str


def champion_slug(value: str) -> str:
    overrides = {"MonkeyKing": "wukong"}
    return overrides.get(value, value).lower()


def lane_kill_margin(rate: float, play: int) -> float:
    bounded_rate = min(1.0, max(0.0, float(rate)))
    bounded_play = max(0, int(play))
    if not bounded_play:
        return bounded_rate - 0.5
    return (bounded_rate * bounded_play + 50.0) / (bounded_play + 100.0) - 0.5


def extract_matchups(summary: dict[str, Any], payload: dict[str, Any]) -> list[Matchup]:
    value = summary.get("json") or summary
    participants = value.get("participants") or []
    targets = [row for row in participants if row.get("_target")]
    if not targets:
        return []
    target_team = int(targets[0].get("teamId") or 0)
    enemies = {
        str(row.get("teamPosition") or row.get("individualPosition") or ""): row
        for row in participants
        if int(row.get("teamId") or 0) != target_team
    }
    matchups: list[Matchup] = []
    for row in targets:
        role = str(row.get("teamPosition") or row.get("individualPosition") or "")
        enemy = enemies.get(role)
        if role not in ROLE_PATH or not enemy:
            continue
        champion = str(row.get("championName") or "")
        opponent = str(enemy.get("championName") or "")
        if champion and opponent:
            matchups.append(Matchup(role, champion, opponent, str(payload.get("patch") or "")))
    return matchups


class OpggLaneKillClient:
    def __init__(self, cache_path: Path, timeout: float = 8.0) -> None:
        self.cache_path = cache_path
        self.timeout = timeout
        self.cache = self._load_cache()

    def _load_cache(self) -> dict[str, dict[str, Any]]:
        try:
            value = json.loads(self.cache_path.read_text(encoding="utf-8"))
            entries = value.get("entries") if isinstance(value, dict) else None
            return entries if isinstance(entries, dict) else {}
        except (OSError, ValueError, TypeError):
            return {}

    def _save_cache(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.cache_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"entries": self.cache}, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(self.cache_path)

    def _versions(self) -> list[str]:
        request = Request(
            "https://lol-api-champion.op.gg/api/global/champions/ranked/versions",
            headers={"User-Agent": "LeagueAkari/1.5.0", "Accept-Language": "en-US,en;q=0.9"},
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:  # noqa: S310 - fixed OP.GG URL
                value = json.loads(response.read().decode("utf-8"))
            versions = value.get("data") if isinstance(value, dict) else None
            return [str(item) for item in versions] if isinstance(versions, list) else []
        except (OSError, ValueError, TypeError):
            return []

    def _fetch(self, matchup: Matchup, effective_patch: str) -> dict[str, Any] | None:
        query = urlencode(
            {
                "region": "global",
                "tier": "emerald_plus",
                "patch": effective_patch,
                "target_champion": champion_slug(matchup.opponent),
            }
        )
        url = (
            f"https://op.gg/lol/champions/{champion_slug(matchup.champion)}"
            f"/counters/{ROLE_PATH[matchup.role]}?{query}"
        )
        request = Request(
            url,
            headers={"User-Agent": "Mozilla/5.0", "Accept-Language": "en-US,en;q=0.9"},
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:  # noqa: S310 - fixed OP.GG URL
                html = response.read().decode("utf-8", errors="replace")
        except OSError:
            return None
        rate_match = re.search(
            r">([0-9]+(?:\.[0-9]+)?)%</span><span[^>]*>Lane kill rate</span>",
            html,
            re.IGNORECASE,
        )
        if not rate_match:
            return None
        opponent_slug = re.escape(champion_slug(matchup.opponent))
        play_match = re.search(
            r'\\"play\\":(\d+),\\"win\\":\d+,\\"win_rate\\":[0-9.]+,'
            r'\\"champion\\":\{[^{}]*?\\"key\\":\\"' + opponent_slug + r'\\"',
            html,
        )
        return {
            "laneKillRate": float(rate_match.group(1)) / 100.0,
            "play": int(play_match.group(1)) if play_match else 0,
        }

    def resolve_many(
        self,
        matchups: Iterable[Matchup],
        cancelled: Callable[[], bool] = lambda: False,
    ) -> dict[Matchup, float]:
        versions = self._versions()
        unique = list(dict.fromkeys(matchups))
        resolved: dict[Matchup, float] = {}
        pending: list[tuple[Matchup, str, str]] = []
        for matchup in unique:
            effective_patch = matchup.patch if matchup.patch in versions else (versions[-1] if versions else matchup.patch)
            cache_key = "|".join((matchup.role, matchup.champion, matchup.opponent, effective_patch))
            cached = self.cache.get(cache_key)
            if cached and cached.get("laneKillRate") is not None:
                resolved[matchup] = lane_kill_margin(cached["laneKillRate"], cached.get("play", 0))
            else:
                pending.append((matchup, effective_patch, cache_key))
        changed = False
        pending = pending[:MAX_REQUESTS]
        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = {
                executor.submit(self._fetch, matchup, patch): (matchup, cache_key)
                for matchup, patch, cache_key in pending
                if not cancelled()
            }
            for future in as_completed(futures):
                if cancelled():
                    break
                matchup, cache_key = futures[future]
                try:
                    value = future.result()
                except Exception:  # external enrichment must not fail local analysis
                    value = None
                if value is None:
                    continue
                self.cache[cache_key] = value
                resolved[matchup] = lane_kill_margin(value["laneKillRate"], value.get("play", 0))
                changed = True
        if changed:
            self._save_cache()
        return resolved


def enrich_games(
    games: list[tuple[dict[str, Any], dict[str, Any]]],
    client: OpggLaneKillClient,
    cancelled: Callable[[], bool] = lambda: False,
) -> dict[str, int]:
    game_matchups = [(payload, extract_matchups(summary, payload)) for payload, summary in games]
    all_matchups = [matchup for _, matchups in game_matchups for matchup in matchups]
    resolved = client.resolve_many(all_matchups, cancelled)
    resolved_values = 0
    for payload, matchups in game_matchups:
        by_role = {matchup.role: resolved.get(matchup) for matchup in matchups}
        values = [value for value in by_role.values() if value is not None]
        for player in payload.get("players") or []:
            value = by_role.get(str(player.get("role") or ""))
            player["counter"] = value
            if value is not None:
                resolved_values += 1
        payload["counterMean"] = sum(values) / len(values) if values else None
    return {"requested": len(set(all_matchups)), "resolved": resolved_values}
