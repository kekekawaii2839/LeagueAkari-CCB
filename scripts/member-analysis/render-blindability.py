"""Render a local research scatter plot and exact-value CSV; never reads credentials.

Usage: python render-blindability.py ABSOLUTE_INPUT.json ABSOLUTE_OUTPUT.png
Both paths (and the adjacent CSV) must resolve below the dedicated Electron userData
research directory. This is an offline research renderer, not a renderer data API.
Only Pillow and the Python standard library are required; no product dependencies.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import os
import tempfile
from functools import lru_cache
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont


class RenderInputError(ValueError):
    pass


def research_root() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise RenderInputError("APPDATA is unavailable; cannot establish Electron userData")
    return (Path(appdata) / "LeagueAkariBlindabilityResearch" / "member-analysis" /
            "champion-pool-research").resolve()


def checked_path(value: str | Path, suffix: str) -> Path:
    path = Path(value)
    if not path.is_absolute() or path.suffix.lower() != suffix:
        raise RenderInputError(f"Expected an absolute {suffix} path under research userData")
    resolved = path.resolve()
    if not resolved.is_relative_to(research_root()) or resolved == research_root():
        raise RenderInputError("Path is outside the dedicated research userData directory")
    return resolved


def finite_number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        return False


def text(value: Any, limit: int = 180) -> str:
    if value is None:
        return "not supplied"
    if not isinstance(value, (str, int, float, bool)):
        return "not supplied"
    return " ".join(str(value).split())[:limit]


def prepare_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = payload.get("rows")
    if not isinstance(rows, list) or len(rows) > 200:
        raise RenderInputError("rows must be a list of at most 200 champion-role entries")
    seen: set[str] = set()
    prepared = []
    for row in rows:
        if not isinstance(row, dict) or isinstance(row.get("champion"), bool) or not isinstance(row.get("champion"), (str, int)):
            raise RenderInputError("Every row needs a champion identifier")
        champion = str(row["champion"])
        if not champion or champion in seen:
            raise RenderInputError("Champion identifiers must be nonempty and unique within a role")
        seen.add(champion)
        reasons = []
        if row.get("matchupRoles") != 5 or row.get("synergyRoles") != 4:
            reasons.append("incomplete role coverage (requires 5 matchup + 4 synergy)")
        if not finite_number(row.get("matchupMean")) or not finite_number(row.get("synergyMean")):
            reasons.append("missing or non-finite axis")
        prepared.append({**row, "champion": champion, "displayName": text(row.get("name") or champion, 120),
                         "plotted": not reasons, "excludedReason": "; ".join(reasons)})
    prepared.sort(key=lambda row: row["champion"])
    number = 0
    for row in prepared:
        if row["plotted"]:
            number += 1
            row["pointNumber"] = number
    return prepared


@lru_cache(maxsize=20)
def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = (["C:/Windows/Fonts/msyhbd.ttc", "C:/Windows/Fonts/segoeuib.ttf"] if bold else
                  ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/segoeui.ttf"])
    candidates += ["DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", "arial.ttf"]
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            pass
    return ImageFont.load_default(size=size)


def fit_text(draw: ImageDraw.ImageDraw, value: str, face: Any, width: int) -> str:
    if draw.textlength(value, font=face) <= width:
        return value
    while value and draw.textlength(value + "...", font=face) > width:
        value = value[:-1]
    return value + "..."


def wrapped(draw: ImageDraw.ImageDraw, value: str, face: Any, width: int) -> list[str]:
    # Character wrapping also supports unspaced localized champion/notes text.
    result, line = [], ""
    for char in value:
        if line and draw.textlength(line + char, font=face) > width:
            result.append(line.rstrip())
            line = char.lstrip()
        else:
            line += char
    if line:
        result.append(line)
    return result or [""]


def axis_ticks(rows: list[dict[str, Any]]) -> tuple[float, list[float]]:
    values = [abs(float(row[key])) for row in rows for key in ("matchupMean", "synergyMean")]
    maximum = max(values, default=0)
    if maximum > 1e100:
        raise RenderInputError("Axis magnitude exceeds the supported local plotting range")
    target = max(maximum * 1.16, 0.5)
    rough = target / 3
    scale = 10 ** math.floor(math.log10(rough))
    step = next(x * scale for x in (1, 2, 2.5, 5, 10) if x * scale >= rough)
    bound = math.ceil(target / step) * step
    count = int(round(bound / step))
    return bound, [i * step for i in range(-count, count + 1)]


def axis_window(rows: list[dict[str, Any]], zoom: bool) -> tuple[float, float, list[float]]:
    bound, ticks = axis_ticks(rows)
    if not zoom or not rows:
        return -bound, bound, ticks
    values = [float(row[key]) for row in rows for key in ("matchupMean", "synergyMean")]
    low, high = min(values), max(values)
    span = max(high - low, 0.05)
    rough = span * 1.2 / 6
    scale = 10 ** math.floor(math.log10(rough))
    step = next(x * scale for x in (1, 2, 2.5, 5, 10) if x * scale >= rough)
    first = math.floor((low - span * 0.1) / step)
    last = math.ceil((high + span * 0.1) / step)
    return first * step, last * step, [i * step for i in range(first, last + 1)]


def score_label(value: float, decimals: int = 3) -> str:
    if abs(value) < 10 ** (-decimals) / 2:
        value = 0.0
    return f"{value:+.{decimals}f}"


def csv_safe(value: Any) -> Any:
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + value
    return value


def atomic_bytes(path: Path, content: bytes) -> None:
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.stem}-", suffix=".tmp", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
        temporary.replace(path)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_csv(path: Path, rows: list[dict[str, Any]], payload: dict[str, Any]) -> None:
    scope = payload.get("scope", {})
    columns = ["point", "champion", "name", "plotted", "excluded_reason", "matchup_mean_z",
               "synergy_mean_z", "matchup_roles", "synergy_roles", "role", "patch", "region",
               "queue", "population", "match_count", "source"]
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer)
    writer.writerow(columns)
    for row in rows:
        x, y = row.get("matchupMean"), row.get("synergyMean")
        writer.writerow([csv_safe(value) for value in [
            row.get("pointNumber", ""), row["champion"], row["displayName"], row["plotted"],
            row["excludedReason"], x if finite_number(x) else "",
            y if finite_number(y) else "", row.get("matchupRoles", ""),
            row.get("synergyRoles", ""), payload.get("role", ""), scope.get("patch", ""),
            scope.get("region", ""), scope.get("queueId", scope.get("queue", "")),
            scope.get("population", scope.get("rank", "")),
            scope.get("matchCount", scope.get("matches", scope.get("acceptedMatches", ""))),
            scope.get("source", "")]] )
    atomic_bytes(path, buffer.getvalue().encode("utf-8-sig"))


def render(input_path: str | Path, output_path: str | Path) -> dict[str, Any]:
    source = checked_path(input_path, ".json")
    output = checked_path(output_path, ".png")
    csv_path = checked_path(output.with_suffix(".csv"), ".csv")
    if source.stat().st_size > 2_000_000:
        raise RenderInputError("Input JSON exceeds the local research size limit")
    payload = json.loads(source.read_text(encoding="utf-8-sig"))
    if not isinstance(payload, dict) or not isinstance(payload.get("scope", {}), dict) or not isinstance(payload.get("settings", {}), dict):
        raise RenderInputError("Expected scope/settings objects and rows")
    all_rows = prepare_rows(payload)
    rows = [row for row in all_rows if row["plotted"]]
    scope, settings = payload.get("scope", {}), payload.get("settings", {})
    notes = payload.get("notes", [])
    if not isinstance(notes, list) or any(not isinstance(note, str) for note in notes):
        raise RenderInputError("notes must contain strings")
    width, plot_left, plot_top, plot_size = 2000, 130, 350, 1050
    table_x, table_width, row_height = 1250, 690, 25
    height = max(1540, plot_top + 80 + len(rows) * row_height + 110)
    image = Image.new("RGB", (width, height), "#f7f8fa")
    draw = ImageDraw.Draw(image)
    ink, muted, grid, teal, purple = "#182b3a", "#4c6070", "#dde4e9", "#006d77", "#6c498b"
    title = text(payload.get("title", "Blindability: matchup x synergy"), 140)
    draw.text((55, 28), fit_text(draw, title, font(34, True), 1870), font=font(34, True), fill=ink)
    draw.text((55, 82), f"Role {text(payload.get('role'))}  |  standardized, dimensionless scores (z)", font=font(23), fill=muted)
    population = scope.get("population", scope.get("rank"))
    description = (f"Source {text(scope.get('source'))} | Patch {text(scope.get('patch'))} | Region {text(scope.get('region'))} | "
                   f"Queue {text(scope.get('queueId', scope.get('queue')))} | Population {text(population, 220)}")
    for offset, line in enumerate(wrapped(draw, description, font(20), 1870)[:2]):
        draw.text((55, 122 + offset * 28), line, font=font(20), fill=muted)
    sample = scope.get("matchCount", scope.get("matches", scope.get("acceptedMatches")))
    floor = settings.get("pickRateFloor")
    floor_label = f"{floor * 100:g}%" if finite_number(floor) else "unspecified"
    alpha = settings.get("shrinkAlpha", settings.get("alpha"))
    draw.text((55, 190), f"Matches: {text(sample)} | Plotted: {len(rows)}/{len(all_rows)} | PR floor: {floor_label} | PR weighted: {text(settings.get('pickRateWeighted'))}", font=font(20), fill=ink)
    warning = ("RAW / alpha=0: upstream shrinkage is NOT reproduced; this is not the original site's default model."
               if alpha == 0 else
               f"Alpha={text(alpha)}: supplied shrinkage estimates; the renderer does not validate their provenance.")
    draw.rectangle((45, 231, 1950, 320), fill="#fff1d8")
    draw.text((60, 240), warning, font=font(20, True), fill="#694400")
    draw.text((60, 273), "Only complete 5-opponent-role + 4-partner-role finite axes are plotted. Missing is never zero.", font=font(19), fill="#694400")

    axis_low, axis_high, ticks = axis_window(rows, payload.get("zoomAxes") is True)
    bound = max(abs(axis_low), abs(axis_high))
    right, bottom = plot_left + plot_size, plot_top + plot_size
    draw.rectangle((plot_left, plot_top, right, bottom), fill="white", outline="#8a9caa", width=2)
    coordinate = lambda value: plot_size * (float(value) - axis_low) / (axis_high - axis_low)
    decimals = max(1, min(6, -math.floor(math.log10((axis_high - axis_low) / 6)) + 1))
    for tick in ticks:
        px = plot_left + coordinate(tick)
        py = bottom - coordinate(tick)
        color = "#94a6b3" if abs(tick) < 1e-12 else grid
        line_width = 2 if abs(tick) < 1e-12 else 1
        draw.line((px, plot_top, px, bottom), fill=color, width=line_width)
        draw.line((plot_left, py, right, py), fill=color, width=line_width)
        label = f"{tick:.2g}" if bound >= 10000 else f"{0 if abs(tick) < 1e-12 else tick:.{decimals}f}"
        draw.text((px, bottom + 12), label, font=font(19), fill=muted, anchor="mt")
        draw.text((plot_left - 14, py), label, font=font(19), fill=muted, anchor="rm")
    draw.text(((plot_left + right) / 2, bottom + 57), "Matchup blindability z  -> less opponent-dependent", font=font(23), fill=ink, anchor="mt")
    vertical = Image.new("RGBA", (870, 42), (0, 0, 0, 0))
    ImageDraw.Draw(vertical).text((435, 20), "Synergy blindability z  -> less teammate-dependent", font=font(23), fill=ink, anchor="mm")
    vertical = vertical.rotate(90, expand=True)
    image.paste(vertical, (21, int((plot_top + bottom - vertical.height) / 2)), vertical)
    if not rows:
        draw.text(((plot_left + right) / 2, (plot_top + bottom) / 2), "No complete finite 2D points", font=font(29, True), fill=muted, anchor="mm")

    groups: dict[tuple[float, float], list[dict[str, Any]]] = {}
    for row in rows:
        groups.setdefault((float(row["matchupMean"]), float(row["synergyMean"])), []).append(row)
    overlap_number = 0
    overlap_members = {}
    for (x, y), members in groups.items():
        if len(members) > 1:
            overlap_number += 1
            label = f"G{overlap_number}"
            for row in members:
                overlap_members[row["pointNumber"]] = label
        else:
            label = str(members[0]["pointNumber"])
        px, py = plot_left + coordinate(x), bottom - coordinate(y)
        radius = 19 if len(members) > 1 else 16
        draw.ellipse((px-radius, py-radius, px+radius, py+radius), fill=purple if len(members)>1 else teal, outline="white", width=2)
        draw.text((px, py-1), label, font=font(16, True), fill="white", anchor="mm")

    draw.text((table_x, plot_top - 5), "Point IDs, not performance ranks", font=font(23, True), fill=ink)
    draw.text((table_x, plot_top + 35), "Pt / row", font=font(18, True), fill=muted)
    draw.text((table_x + 100, plot_top + 35), "Champion (full name in CSV)", font=font(18, True), fill=muted)
    draw.text((table_x + 560, plot_top + 35), "X z", font=font(18, True), fill=muted, anchor="ra")
    draw.text((table_x + 680, plot_top + 35), "Y z", font=font(18, True), fill=muted, anchor="ra")
    draw.line((table_x, plot_top + 65, table_x + table_width, plot_top + 65), fill="#9fafba", width=2)
    for i, row in enumerate(rows):
        y = plot_top + 76 + i * row_height
        number = row["pointNumber"]
        marker = f"{overlap_members[number]}/{number}" if number in overlap_members else str(number)
        draw.text((table_x, y), marker, font=font(18), fill=purple if number in overlap_members else teal)
        label = row["displayName"] if row["displayName"] == row["champion"] else f"{row['displayName']} [{row['champion']}]"
        draw.text((table_x + 100, y), fit_text(draw, label, font(18), 335), font=font(18), fill=ink)
        draw.text((table_x + 560, y), score_label(float(row["matchupMean"])), font=font(18), fill=ink, anchor="ra")
        draw.text((table_x + 680, y), score_label(float(row["synergyMean"])), font=font(18), fill=ink, anchor="ra")
    footer_y = max(bottom + 108, plot_top + 86 + len(rows) * row_height)
    summary = [
        "Higher scores mean greater stability relative to the reference heroes; NOT win probability or overall strength.",
        f"Excluded {len(all_rows)-len(rows)} incomplete/non-finite rows; they remain in the exact-value CSV with reasons.",
        "No points are jittered. G# denotes exact coordinate overlaps; its members share that coordinate.",
        "No confidence intervals are inferred by this renderer. Sampling and model uncertainty require separate validation.",
    ] + [text(note, 500) for note in notes[:20]]
    if payload.get("zoomAxes") is True:
        summary.insert(0, "Zoomed axes: zero may be outside the view. Both axes retain the same scale; coordinates are unchanged.")
    note_lines = [line for note in summary for line in wrapped(draw, note, font(18), 1870)]
    needed_height = footer_y + 30 + len(note_lines) * 27
    if needed_height > height:
        extended = Image.new("RGB", (width, needed_height), "#f7f8fa")
        extended.paste(image, (0,0))
        image, draw = extended, ImageDraw.Draw(extended)
    for i, line in enumerate(note_lines):
        draw.text((55, footer_y + i*27), line, font=font(18), fill=muted)
    output.parent.mkdir(parents=True, exist_ok=True)
    png_buffer = io.BytesIO()
    image.save(png_buffer, format="PNG")
    atomic_bytes(output, png_buffer.getvalue())
    write_csv(csv_path, all_rows, payload)
    return {"png": str(output), "csv": str(csv_path), "plotted": len(rows),
            "excluded": len(all_rows)-len(rows), "exactOverlapGroups": overlap_number,
            "width": image.width, "height": image.height}


def self_test() -> dict[str, Any]:
    root = research_root()
    root.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="renderer-synthetic-", dir=root))
    payload = {"role": "SUP", "scope": {"source":"synthetic fixture", "patch":"16.21", "region":"synthetic", "queueId":420,
               "population":"SYNTHETIC FIXTURE, not actual players", "matchCount":12345},
               "settings":{"shrinkAlpha":0, "pickRateFloor":0.005, "pickRateWeighted":True},
               "notes":["SYNTHETIC QA ONLY. No real player or match data.", "One exact overlap, a true zero, partial coverage and missing values are intentional."],
               "rows":[]}
    for i in range(42):
        payload["rows"].append({"champion":f"Synthetic_{i:02d}", "name":f"Synthetic hero {i:02d}",
            "matchupMean":1.7*math.cos(i*2.399), "synergyMean":1.55*math.sin(i*1.47),
            "matchupRoles":5, "synergyRoles":4})
    payload["rows"][0]["matchupMean"] = payload["rows"][0]["synergyMean"] = 0
    payload["rows"][1]["matchupMean"] = payload["rows"][1]["synergyMean"] = 0
    payload["rows"][2]["name"] = "A very long synthetic champion name for explicit truncation validation"
    payload["rows"].extend([
        {"champion":"Missing", "matchupMean":None, "synergyMean":0, "matchupRoles":5, "synergyRoles":4},
        {"champion":"Partial", "matchupMean":0, "synergyMean":0, "matchupRoles":4, "synergyRoles":4},
        {"champion":"Nonfinite", "matchupMean":float("nan"), "synergyMean":0, "matchupRoles":5, "synergyRoles":4}])
    source = directory / "synthetic.json"
    source.write_text(json.dumps(payload), encoding="utf-8")
    result = render(source, directory / "synthetic.png")
    assert result["plotted"] == 42 and result["excluded"] == 3 and result["exactOverlapGroups"] == 1
    with Path(result["csv"]).open(encoding="utf-8-sig", newline="") as stream:
        exported = list(csv.DictReader(stream))
    assert len(exported) == 45
    zero = next(row for row in exported if row["champion"] == "Synthetic_00")
    assert zero["plotted"] == "True" and float(zero["matchup_mean_z"]) == 0
    missing = next(row for row in exported if row["champion"] == "Missing")
    assert missing["plotted"] == "False" and missing["matchup_mean_z"] == ""
    negative = next(row for row in exported if row["champion"] == "Synthetic_04")
    assert float(negative["matchup_mean_z"]) == payload["rows"][4]["matchupMean"]
    for bad in [Path.cwd() / "outside.png", Path("relative.png")]:
        try:
            checked_path(bad, ".png")
        except RenderInputError:
            pass
        else:
            raise AssertionError("Out-of-userData path was not rejected")
    empty = {**payload, "rows":[]}
    (directory/"empty.json").write_text(json.dumps(empty), encoding="utf-8")
    assert render(directory/"empty.json", directory/"empty.png")["plotted"] == 0
    boundary = {**payload, "scope": {**payload["scope"], "matchCount":1},
                "notes":["SYNTHETIC QA ONLY: extreme axes, a true zero and a one-match sample label."], "rows":[
        {"champion":"PositiveExtreme", "matchupMean":25, "synergyMean":-18, "matchupRoles":5, "synergyRoles":4},
        {"champion":"NegativeExtreme", "matchupMean":-20, "synergyMean":19, "matchupRoles":5, "synergyRoles":4},
        {"champion":"TrueZero", "matchupMean":0, "synergyMean":0, "matchupRoles":5, "synergyRoles":4}]}
    (directory/"boundary.json").write_text(json.dumps(boundary), encoding="utf-8")
    assert render(directory/"boundary.json", directory/"boundary.png")["plotted"] == 3
    clustered = {**payload, "zoomAxes": True, "rows":[
        {"champion":"ClusterA", "matchupMean":1.01, "synergyMean":1.08, "matchupRoles":5, "synergyRoles":4},
        {"champion":"ClusterB", "matchupMean":1.09, "synergyMean":1.02, "matchupRoles":5, "synergyRoles":4}]}
    low, high, ticks = axis_window(clustered["rows"], True)
    assert 0 < low <= 1.01 < 1.09 <= high and ticks[0] == low and ticks[-1] == high
    assert high - low < 0.3
    (directory/"zoom.json").write_text(json.dumps(clustered), encoding="utf-8")
    assert render(directory/"zoom.json", directory/"zoom.png")["plotted"] == 2
    # Exact lookup coordinates must not change when the viewport is zoomed.
    with (directory/"zoom.csv").open(encoding="utf-8-sig", newline="") as stream:
        zoom_rows = list(csv.DictReader(stream))
    assert float(zoom_rows[0]["matchup_mean_z"]) == 1.01
    assert axis_window([], True) == axis_window([], False)
    assert finite_number(True) is False and finite_number(float("inf")) is False
    try:
        prepare_rows({"rows":[payload["rows"][0], payload["rows"][0]]})
    except RenderInputError:
        pass
    else:
        raise AssertionError("Duplicate champion identifiers were not rejected")
    assert csv_safe("=synthetic") == "'=synthetic"
    return {"selfTest":"passed", **result, "emptyPng":str(directory/"empty.png"),
            "boundaryPng":str(directory/"boundary.png")}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", nargs="?")
    parser.add_argument("output", nargs="?")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            result = self_test()
        elif args.input and args.output:
            result = render(args.input, args.output)
        else:
            parser.error("Provide absolute input/output paths, or --self-test")
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (RenderInputError, OSError, json.JSONDecodeError) as error:
        # Do not echo payloads or arbitrary input values to logs.
        print(json.dumps({"status":"render_failed", "category":type(error).__name__}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
