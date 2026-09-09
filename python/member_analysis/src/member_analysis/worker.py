from __future__ import annotations

import argparse
import gzip
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
    from member_analysis.analysis import derive_game
    from member_analysis.opgg import OpggLaneKillClient, enrich_games
except ModuleNotFoundError:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from analysis import derive_game
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
    derived: list[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]] = []
    emit("ready", jobId=args.job_id, total=len(items))
    for index, item in enumerate(items):
        if cancelled():
            connection.rollback()
            connection.close()
            emit("result", status="cancelled", processed=index)
            return 2
        summary = read_gzip_json(safe_child(root, item["summaryPath"]))
        details = read_gzip_json(safe_child(root, item["detailsPath"]))
        payload = derive_game(summary, details)
        derived.append((item, payload, summary))
        checkpoint.parent.mkdir(parents=True, exist_ok=True)
        checkpoint.write_text(json.dumps({"jobId": args.job_id, "processed": index + 1}), encoding="utf-8")
        emit("progress", stage="analyzing", processed=index + 1, total=len(items))
    opgg_stats = {"requested": 0, "resolved": 0}
    if args.opgg_enabled and not cancelled():
        opgg_stats = enrich_games(
            [(payload, summary) for _, payload, summary in derived],
            OpggLaneKillClient(root / "opgg" / "lane-kill-cache.json"),
            cancelled,
        )
    if cancelled():
        connection.rollback()
        connection.close()
        emit("result", status="cancelled", processed=len(derived))
        return 2
    for item, payload, _ in derived:
        connection.execute(
            "INSERT INTO derived_games(server_id,game_id,checksum,payload_json,updated_at) VALUES(?,?,?,?,?) "
            "ON CONFLICT(server_id,game_id) DO UPDATE SET checksum=excluded.checksum,payload_json=excluded.payload_json,updated_at=excluded.updated_at",
            (item["serverId"], item["gameId"], item["checksum"], json.dumps(payload, separators=(",", ":")), utc_now()),
        )
    connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('generated_at',?)", (utc_now(),))
    connection.execute(
        "INSERT OR REPLACE INTO metadata(key,value) VALUES('source','SGP 对局历史与详情')"
    )
    connection.execute("INSERT OR REPLACE INTO metadata(key,value) VALUES('derivation_version','4')")
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
    except Exception as error:
        emit("error", code="WORKER_FAILED", message=str(error)[:240])
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
