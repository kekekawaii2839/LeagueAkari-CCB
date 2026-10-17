from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import sqlite3
import sys
import time
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

try:
    from member_analysis.analysis import RequiredSummaryStatisticUnavailable, derive_game
    from member_analysis.opgg import OpggLaneKillClient, enrich_games
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from analysis import RequiredSummaryStatisticUnavailable, derive_game
    from opgg import OpggLaneKillClient, enrich_games


def emit(kind: str, **payload: Any) -> None:
    print(json.dumps({"type": kind, **payload}, separators=(",", ":")), flush=True)


def utc_now() -> str:
    return datetime.now(UTC).isoformat().replace("+00:00", "Z")


def safe_child(root: Path, value: str) -> Path:
    candidate = (root / value).resolve()
    if candidate != root and root not in candidate.parents:
        raise ValueError("path escapes data root")
    return candidate


_cancel_event = threading.Event()


def _listen_for_cancel() -> None:
    for line in sys.stdin:
        try:
            if json.loads(line).get("type") == "cancel":
                _cancel_event.set()
                return
        except (json.JSONDecodeError, AttributeError):
            continue


def cancelled() -> bool:
    return _cancel_event.is_set()


def read_gzip_json(path: Path) -> dict[str, Any]:
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError("raw match must be an object")
    return value


def identity_facts(summary: dict[str, Any], payload: dict[str, Any]) -> list[dict[str, Any]]:
    value = summary.get("json", summary)
    actors = value.get("participants")
    if not isinstance(actors, list) or len(actors) != 10 or value.get("gameId") != payload.get("gameId"):
        raise ValueError("invalid identity facts")
    facts = []
    for actor in actors:
        pid, team, puuid = actor.get("participantId"), actor.get("teamId"), actor.get("puuid")
        if type(pid) is not int or not 1 <= pid <= 10 or type(team) is not int or team not in (100, 200) or not isinstance(puuid, str) or not puuid or puuid == "00000000-0000-0000-0000-000000000000":
            raise ValueError("invalid identity facts")
        icon = actor.get("profileIcon")
        facts.append({"participantId": pid, "teamId": team, "puuid": puuid,
                      "profileIconId": icon if type(icon) is int and 0 <= icon <= 9007199254740991 else None})
    own_team = 100 if payload.get("side") == "Blue" else 200
    own = {fact["participantId"] for fact in facts if fact["teamId"] == own_team}
    players = payload.get("players", [])
    if len({fact["participantId"] for fact in facts}) != 10 or len({fact["puuid"] for fact in facts}) != 10 or sum(fact["teamId"] == 100 for fact in facts) != 5 or len(players) != 5 or {player.get("participantId") for player in players} != own or len({player.get("player") for player in players}) != 5:
        raise ValueError("invalid identity facts")
    return sorted(facts, key=lambda fact: fact["participantId"])


def run(args: argparse.Namespace) -> int:
    threading.Thread(target=_listen_for_cancel, daemon=True).start()
    root = Path(args.data_root).resolve()
    manifest_path = safe_child(root, args.manifest)
    staging = safe_child(root, args.staging)
    safe_child(root, args.current)
    checkpoint = safe_child(root, args.checkpoint)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if staging.exists():
        staging.unlink()
    staging.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(staging)
    schema = Path(__file__).with_name("schema.sql").read_text(encoding="utf-8")
    connection.executescript(schema)
    items = manifest.get("items", [])
    audit = manifest.get("audit", {})
    derived: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any], str]] = []
    emit("ready", jobId=args.job_id, total=len(items))
    for index, item in enumerate(items):
        if cancelled():
            connection.rollback()
            connection.close()
            emit("result", status="cancelled", processed=index)
            return 2
        summary_bytes = safe_child(root, item["summaryPath"]).read_bytes()
        summary = json.loads(gzip.decompress(summary_bytes).decode("utf-8"))
        if not isinstance(summary, dict):
            raise ValueError("raw match must be an object")
        summary_digest = hashlib.sha256(summary_bytes).hexdigest()
        details = read_gzip_json(safe_child(root, item["detailsPath"]))
        payload = derive_game(summary, details)
        derived.append((item, payload, summary, summary_digest))
        checkpoint.parent.mkdir(parents=True, exist_ok=True)
        checkpoint.write_text(json.dumps({"jobId": args.job_id, "processed": index + 1}), encoding="utf-8")
        emit("progress", stage="analyzing", processed=index + 1, total=len(items))
    opgg_stats = {"requested": 0, "resolved": 0}
    if args.opgg_enabled and not cancelled():
        opgg_stats = enrich_games(
            [(payload, summary) for _, payload, summary, _ in derived],
            OpggLaneKillClient(root / "opgg" / "lane-kill-cache.json"),
            cancelled,
        )
    if cancelled():
        connection.rollback()
        connection.close()
        emit("result", status="cancelled", processed=len(derived))
        return 2
    for item, payload, summary, summary_digest in derived:
        connection.execute(
            "INSERT INTO derived_games(server_id,game_id,checksum,payload_json,updated_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(server_id,game_id) DO UPDATE SET checksum=excluded.checksum,payload_json=excluded.payload_json,updated_at=excluded.updated_at",
            (item["serverId"], item["gameId"], item["checksum"], json.dumps(payload, separators=(",", ":")), utc_now()),
        )
        # Same transaction as metrics. Main must still verify raw safety and the
        # JavaScript checksum: Python JSON serialization is not interchangeable.
        connection.execute(
            "INSERT INTO game_identity_facts VALUES(?,?,?,?,?,?)",
            (item["serverId"], item["gameId"], item["checksum"], summary_digest, 1,
             json.dumps(identity_facts(summary, payload), separators=(",", ":"))),
        )
    connection.execute("INSERT OR REPLACE INTO metadata VALUES('identity_facts_state','candidate-v1')")
    connection.execute("INSERT OR REPLACE INTO metadata VALUES('identity_facts_count',?)", (str(len(derived)),))
    connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('generated_at',?)", (utc_now(),))
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key,value) VALUES('source','SGP 对局历史与详情')"
    )
    connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('derivation_version','5')")
    connection.commit()
    integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
    count = connection.execute("SELECT COUNT(*) FROM derived_games").fetchone()[0]
    audit.update({
        "workerReceived": len(items),
        "stagingGames": count,
        "publishedGames": count,
        "opggEnabled": bool(args.opgg_enabled),
        "opggMatchups": opgg_stats["requested"],
        "opggResolved": opgg_stats["resolved"],
    })
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key,value) VALUES('collection_audit',?)",
        (json.dumps(audit, separators=(",", ":")),),
    )
    connection.commit()
    connection.close()
    if integrity != "ok":
        raise RuntimeError("staging integrity check failed")
    emit("result", status="completed", processed=len(items), gameCount=count, staging=args.staging)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--job-id", required=True)
    parser.add_argument("--data-root", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--staging", required=True)
    parser.add_argument("--current", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--opgg-enabled", action="store_true")
    args = parser.parse_args()
    try:
        raise SystemExit(run(args))
    except RequiredSummaryStatisticUnavailable:
        emit("error", code="SUMMARY_STAT_UNAVAILABLE", message="Required match summary statistics unavailable")
        raise SystemExit(1) from None
    except Exception as error:
        emit("error", code="WORKER_FAILED", message=str(error)[:240])
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
