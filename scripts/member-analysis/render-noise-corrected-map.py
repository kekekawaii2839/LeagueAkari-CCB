"""Offline research maps. Usage: script INPUT.json ABS_OUTPUT_PREFIX [--reference REF.json].

Inputs, PNGs and CSV are confined to the dedicated Electron research userData.
No credentials, network, fitting, imputation, z transformation, clipping negative
variance, or cross-method score subtraction is performed by this renderer.
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import io
import json
import math
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

_spec = importlib.util.spec_from_file_location("blindability_render_helpers", Path(__file__).with_name("render-blindability.py"))
assert _spec is not None and _spec.loader is not None
_helpers = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_helpers)
font, checked_path, atomic_bytes = _helpers.font, _helpers.checked_path, _helpers.atomic_bytes
finite_number, fit_text, wrapped = _helpers.finite_number, _helpers.fit_text, _helpers.wrapped
safe_text, csv_safe, research_root = _helpers.text, _helpers.csv_safe, _helpers.research_root
RenderInputError = _helpers.RenderInputError

METHOD = "conditional-role-balanced-rms-mom-v1"
BACKGROUND, INK, MUTED = "#f7f8fa", "#172d3c", "#4c6070"
TEAL, PURPLE, GRID = "#006d77", "#714791", "#dce4ea"
CHINESE = {
    "ahri":"阿狸", "akali":"阿卡丽", "akshan":"阿克尚", "anivia":"艾尼维亚",
    "annie":"安妮", "aurelionsol":"奥瑞利安·索尔", "aurora":"阿萝拉", "azir":"阿兹尔",
    "cassiopeia":"卡西奥佩娅", "corki":"库奇", "diana":"黛安娜", "ekko":"艾克",
    "fizz":"菲兹", "galio":"加里奥", "gragas":"古拉加斯", "heimerdinger":"黑默丁格",
    "hwei":"彗", "irelia":"艾瑞莉娅", "kassadin":"卡萨丁", "katarina":"卡特琳娜",
    "kayle":"凯尔", "kennen":"凯南", "leblanc":"乐芙兰", "lissandra":"丽桑卓",
    "lucian":"卢锡安", "lux":"拉克丝", "malphite":"墨菲特", "malzahar":"玛尔扎哈",
    "mel":"梅尔", "morgana":"莫甘娜", "naafiri":"纳亚菲利", "neeko":"妮蔻",
    "orianna":"奥莉安娜", "pantheon":"潘森", "qiyana":"奇亚娜", "ryze":"瑞兹",
    "smolder":"斯莫德", "swain":"斯维因", "sylas":"塞拉斯", "syndra":"辛德拉",
    "taliyah":"塔莉垭", "talon":"泰隆", "tristana":"崔丝塔娜", "twistedfate":"崔斯特",
    "veigar":"维迦", "velkoz":"维克兹", "vex":"薇古丝", "viktor":"维克托",
    "vladimir":"弗拉基米尔", "xerath":"泽拉斯", "yasuo":"亚索", "yone":"永恩",
    "zed":"劫", "ziggs":"吉格斯", "zoe":"佐伊", "quinn":"奎因",
}
HIGHLIGHT_ORDER = ["ahri", "yasuo", "ekko", "azir", "aurora", "akshan", "zed", "orianna", "hwei", "xerath"]
COLORS = ["#0072b2", "#d55e00", "#009e73", "#cc79a7", "#e69f00",
          "#56b4e9", "#332288", "#882255", "#44aa99", "#79721c"]


def key(value: Any) -> str:
    return "".join(char for char in str(value).lower() if char.isalnum())


def display_name(row: dict[str, Any]) -> str:
    original = safe_text(row.get("name") or row["champion"], 100)
    return CHINESE.get(key(original), CHINESE.get(key(row["champion"]), original))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RenderInputError(message)


def validate_axis(axis: Any, expected: int) -> None:
    require(isinstance(axis, dict), "Axis must be an object")
    require(axis.get("status") in ("available", "noise-dominated", "incomplete"), "Unknown axis status")
    require(axis.get("expectedRoles") == expected, "Unexpected axis role denominator")
    usable = axis.get("usableRoles")
    require(type(usable) is int and 0 <= usable <= expected, "Invalid usable role count")
    signed, rms = axis.get("meanSignedCorrectedVariancePp2"), axis.get("correctedRmsSpreadPp")
    for number in (signed, rms):
        require(number is None or finite_number(number) and abs(number) <= 1e50, "Non-finite or unsupported axis value")
    if axis["status"] == "available":
        require(usable == expected and signed is not None and signed > 0 and rms is not None and rms > 0,
                "Available RMS requires complete, positive signed variance")
        require(math.isclose(rms * rms, signed, rel_tol=1e-7, abs_tol=1e-12), "RMS does not match sqrt(mean signed role variance)")
    elif axis["status"] == "noise-dominated":
        require(usable == expected and signed is not None and signed <= 0 and rms is None,
                "Unresolved variance must remain signed and RMS unavailable")
    else:
        require(rms is None, "Incomplete axis cannot supply a plotted RMS")


def prepare(payload: Any) -> list[dict[str, Any]]:
    require(isinstance(payload, dict) and payload.get("method") == METHOD, "Unexpected method")
    require(isinstance(payload.get("scope"), dict), "Missing sampling scope")
    require(payload.get("ownRole") in ("TOP", "JUNGLE", "MID", "ADC", "SUP"), "Unknown role")
    for field in ("ownDisplayFloor", "targetPrimaryFloor"):
        require(finite_number(payload.get(field)) and 0 <= payload[field] <= 1, "Missing or invalid pick-rate floor")
    require(isinstance(payload.get("rows"), list) and len(payload["rows"]) <= 200, "Invalid cohort")
    rows, ids, numbers = [], set(), set()
    for row in payload["rows"]:
        require(isinstance(row, dict), "Invalid champion row")
        identifier = row.get("champion")
        require(type(identifier) in (str, int) and str(identifier) != "" and str(identifier) not in ids, "Duplicate or invalid champion")
        number = row.get("number")
        require(type(number) is int and number > 0 and number not in numbers, "Duplicate or invalid display number")
        ids.add(str(identifier)); numbers.add(number)
        require(finite_number(row.get("pickRate")) and 0 <= row["pickRate"] <= 1, "Invalid own pick rate")
        require(type(row.get("baselineGames")) is int and row["baselineGames"] >= 0, "Invalid baseline sample")
        require(type(row.get("point")) is bool and type(row.get("noiseModelSensitive")) is bool, "Explicit point and sensitivity flags required")
        primary = row.get("primary")
        require(isinstance(primary, dict), "Missing primary estimates")
        validate_axis(primary.get("matchup"), 5); validate_axis(primary.get("synergy"), 4)
        variants = row.get("variants", [])
        require(isinstance(variants, list), "Invalid variants")
        for variant in variants:
            require(isinstance(variant, dict) and finite_number(variant.get("pickRateFloor")) and 0 <= variant["pickRateFloor"] <= 1,
                    "Invalid variant floor")
            require(isinstance(variant.get("noiseModel"), str) and isinstance(variant.get("result"), dict), "Invalid noise variant")
            validate_axis(variant["result"].get("matchup"), 5); validate_axis(variant["result"].get("synergy"), 4)
        positive = all(primary[axis]["status"] == "available" for axis in ("matchup", "synergy"))
        require(not row["point"] or positive, "A point cannot represent an unresolved or incomplete axis")
        reasons = [f"{axis}:{primary[axis]['status']}" for axis in ("matchup", "synergy") if primary[axis]["status"] != "available"]
        if not row["point"] and not reasons:
            reasons.append("point flag false")
        if row["pickRate"] < payload["ownDisplayFloor"]:
            reasons.append("below own display floor")
        rows.append({**row, "champion":str(identifier), "displayName":display_name(row),
                     "_key":key(row.get("name") or identifier), "_plot":row["point"] and not reasons,
                     "_reason":"; ".join(reasons)})
    rows.sort(key=lambda row: row["number"])
    return rows


def load_json(path: Path) -> Any:
    require(path.stat().st_size <= 5_000_000, "Input exceeds local research size limit")
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save_image(image: Image.Image, path: Path) -> None:
    image_buffer = io.BytesIO(); image.save(image_buffer, format="PNG")
    path.parent.mkdir(parents=True, exist_ok=True)
    atomic_bytes(path, image_buffer.getvalue())


def lines(draw: Any, at: tuple[int, int], statements: list[str], width: int, size: int = 20, color: str = MUTED) -> int:
    y = at[1]
    for statement in statements:
        for line in wrapped(draw, statement, font(size), width):
            draw.text((at[0], y), line, font=font(size), fill=color)
            y += size + 9
    return y


def nice_bounds(values: list[float], signed: bool) -> tuple[float, float, list[float]]:
    magnitude = max([abs(value) for value in values] + [0.02])
    target = magnitude * 1.16
    rough = target / 4
    scale = 10 ** math.floor(math.log10(rough))
    step = next(x * scale for x in (1, 2, 2.5, 5, 10) if x * scale >= rough)
    bound = math.ceil(target / step) * step
    count = int(round(bound / step))
    return (-bound if signed else 0), bound, [i * step for i in range(-count if signed else 0, count+1)]


def tick_label(value: float) -> str:
    if value == 0:
        return "0"
    return f"{value:.3g}"


def plot_axes(image: Image.Image, rectangle: tuple[int, int, int, int], values: list[float], *,
              signed: bool, reverse: bool, x_label: str, y_label: str,
              shade_negative: bool = False) -> tuple[Any, Any]:
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = rectangle
    low, high, ticks = nice_bounds(values, signed)
    x = lambda value: left + (right-left) * ((high-value) if reverse else (value-low)) / (high-low)
    y = lambda value: top + (bottom-top) * ((value-low) if reverse else (high-value)) / (high-low)
    draw.rectangle(rectangle, fill="white", outline="#8196a5", width=2)
    if shade_negative:
        zero_x, zero_y = x(0), y(0)
        draw.rectangle((left, top, zero_x, bottom), fill="#f4ebfa")
        draw.rectangle((left, zero_y, right, bottom), fill="#f4ebfa")
    for tick in ticks:
        px, py = x(tick), y(tick)
        color, stroke = ("#718b9c", 2) if tick == 0 else (GRID, 1)
        draw.line((px, top, px, bottom), fill=color, width=stroke)
        draw.line((left, py, right, py), fill=color, width=stroke)
        draw.text((px, bottom+14), tick_label(tick), font=font(20), fill=MUTED, anchor="mt")
        draw.text((left-13, py), tick_label(tick), font=font(20), fill=MUTED, anchor="rm")
    draw.text(((left+right)/2, bottom+56), x_label, font=font(24), fill=INK, anchor="mt")
    vertical = Image.new("RGBA", (bottom-top, 48), (0,0,0,0))
    ImageDraw.Draw(vertical).text(((bottom-top)/2,24), y_label, font=font(24), fill=INK, anchor="mm")
    vertical = vertical.rotate(90, expand=True)
    image.paste(vertical, (left-100, top), vertical)
    return x, y


def points(image: Image.Image, rows: list[dict[str, Any]], coordinates: Any, x: Any, y: Any,
           *, diagnostic: bool = False, highlights: dict[str,str] | None = None,
           label_highlights_only: bool = False) -> None:
    draw = ImageDraw.Draw(image)
    groups: dict[tuple[float,float], list[dict[str,Any]]] = {}
    for row in rows:
        a, b = coordinates(row)
        groups.setdefault((a,b), []).append(row)
    for (a,b), group in groups.items():
        row = group[0]
        color = (highlights or {}).get(row["_key"], "#a6b2bc") if highlights is not None else TEAL
        unresolved = diagnostic and (a <= 0 or b <= 0)
        if unresolved:
            color = PURPLE
        highlighted = highlights is None or row["_key"] in highlights
        radius = 17 if highlighted else 6
        px, py = x(a), y(b)
        draw.ellipse((px-radius,py-radius,px+radius,py+radius), fill="white" if unresolved else color, outline=color if unresolved else "white", width=3 if unresolved else 2)
        if label_highlights_only and not highlighted:
            continue
        label = str(row["number"]) if len(group) == 1 else f"×{len(group)}"
        # Keep the numeric lookup label readable on the lighter comparison colors.
        rgb = tuple(int(color[i:i+2], 16) for i in (1, 3, 5))
        brightness = sum(value * weight for value, weight in zip(rgb, (.2126, .7152, .0722)))
        fill = color if unresolved else (INK if brightness > 150 else "white")
        draw.text((px,py-1), label, font=font(17,True), fill=fill, anchor="mm")


def axis_value(row: dict[str,Any], axis: str, signed: bool = False) -> float | None:
    return row["primary"][axis]["meanSignedCorrectedVariancePp2" if signed else "correctedRmsSpreadPp"]


def render_single(payload: dict[str,Any], rows: list[dict[str,Any]], diagnostic: bool) -> Image.Image:
    title = "有符号去噪方差诊断（pp²）" if diagnostic else "去噪盲选独立版：非原站默认精确复刻"
    height = max(1780, 490 + len(rows)*28 + 350)
    image = Image.new("RGB", (2200,height), BACKGROUND); draw = ImageDraw.Draw(image)
    draw.text((55,28), title, font=font(38,True), fill=INK)
    scope = payload["scope"]
    source_label = safe_text(scope.get('source'))
    if source_label.lower().startswith('lolalytics'):
        source_label = 'Lolalytics'
    lines(draw,(55,90),[
        f"{payload['ownRole']} | 来源 {source_label} | 交互版本 {safe_text(scope.get('interactionPatch'))} | {safe_text(scope.get('region'))} | queue {safe_text(scope.get('queueId'))}",
        f"总体 {safe_text(scope.get('population'),300)} | 自身显示门槛 {payload['ownDisplayFloor']*100:g}% | 目标主分析门槛 {payload['targetPrimaryFloor']*100:g}%",
    ],2080,21)
    eligible = [row for row in rows if (all(row['primary'][axis]['usableRoles']==row['primary'][axis]['expectedRoles'] and axis_value(row,axis,True) is not None for axis in ('matchup','synergy')) if diagnostic else row['_plot'])]
    lines(draw,(55,169),[
        f"固定队列 {len(rows)} 个英雄；本图 {len(eligible)} 个{'有完整有符号方差的坐标' if diagnostic else '双轴正 RMS 点估计'}。编号只对应英雄，不是排名。",
        "每个方向：先对位置等权平均有符号去噪方差，再在均值为正时开方；不先对负的分块估计裁零。",
    ],2080,21)
    draw.rectangle((45,245,2150,342), fill="#fff0d6")
    lines(draw,(60,253),[
        "负估计／零估计是本估计器未分辨出正方差，不是完美稳定、删失界限或可比较的稳定性排名。" if diagnostic else
        "越右越不挑对手，越上越不挑队友（波动越小）。物理 RMS（pp），反向轴，未做 z 标准化或重新居中。",
        "作者的跨位置去噪聚合未完整公开；这是独立方法。无置信区间，噪声模型敏感性不是置信区间。",
    ],2050,21,"#694400")
    rectangle=(130,390,1130,1390)
    values=[axis_value(row,axis,diagnostic) for row in eligible for axis in ('matchup','synergy')]
    x,y=plot_axes(image,rectangle,values,signed=diagnostic,reverse=not diagnostic,
        x_label="敌方五位置：平均有符号去噪方差（pp²）" if diagnostic else "敌方五位置 RMS（pp）  → 更稳定",
        y_label="队友四位置：平均有符号去噪方差（pp²）" if diagnostic else "队友四位置 RMS（pp）  → 更不挑队友",
        shade_negative=diagnostic)
    points(image,eligible,lambda row:(axis_value(row,'matchup',diagnostic),axis_value(row,'synergy',diagnostic)),x,y,diagnostic=diagnostic)
    if not eligible:
        draw.text((630,890),"没有满足完整覆盖条件的点",font=font(29,True),fill=MUTED,anchor="mm")
    table_x=1210; table_y=390
    draw.text((table_x,table_y-4),"英雄编号与精确查找（CSV 保留完整精度）",font=font(25,True),fill=INK)
    for offset,label,anchor in [(0,"编号","la"),(80,"英雄","la"),(505,"本英雄场次","ra"),(680,"X / pp²" if diagnostic else "X / pp","ra"),(850,"Y / pp²" if diagnostic else "Y / pp","ra")]:
        draw.text((table_x+offset,table_y+40),label,font=font(19,True),fill=MUTED,anchor=anchor)
    draw.line((table_x,table_y+72,table_x+870,table_y+72),fill="#9cafbc",width=2)
    for i,row in enumerate(rows):
        at=table_y+82+i*28
        unresolved = any(row['primary'][axis]['status']=='noise-dominated' for axis in ('matchup','synergy'))
        color=PURPLE if unresolved else INK
        draw.text((table_x,at),str(row['number']),font=font(19),fill=color)
        label=f"{row['displayName']}" + (" *" if row['noiseModelSensitive'] else "")
        draw.text((table_x+80,at),fit_text(draw,label,font(19),280),font=font(19),fill=color)
        draw.text((table_x+505,at),f"{row['baselineGames']:,}",font=font(19),fill=MUTED,anchor="ra")
        for axis,offset in [('matchup',680),('synergy',850)]:
            value=axis_value(row,axis,diagnostic)
            label=(f"{value:+.4f}" if diagnostic else f"{value:.4f}") if value is not None else "未分辨" if row['primary'][axis]['status']=='noise-dominated' else "覆盖不足"
            draw.text((table_x+offset,at),label,font=font(19),fill=color,anchor="ra")
    footer_y=max(1510,table_y+100+len(rows)*28)
    unresolved_names="、".join(f"{row['number']} {row['displayName']}" for row in rows if not row['_plot']) or "无"
    footer=[
        f"未进入 RMS 主图（仍保留诊断与 CSV）：{unresolved_names}",
        "主图只使用完整 5 个敌方位置 + 4 个队友位置，且两轴都有正的去噪方差；不将未分辨值替换成 0。",
        "空心紫点 = 至少一轴有符号估计 ≤ 0；负半轴有底色。点不抖动，×N 表示完全重合。" if diagnostic else
        "这是有噪声的点估计，不是英雄强度或胜率。较小 RMS 不等于英雄更强。点不抖动，×N 表示完全重合。",
        "* = 噪声模型敏感；敏感性分析不是置信区间。基准胜率／抽样相关性等不确定性仍需单独验证。",
    ]+[safe_text(note,600) for note in payload.get('notes',[])[:20]]
    total_lines=[line for note in footer for line in wrapped(draw,note,font(20),2080)]
    required=footer_y+35+len(total_lines)*29
    if required>height:
        extended=Image.new('RGB',(2200,required),BACKGROUND);extended.paste(image,(0,0));image=extended;draw=ImageDraw.Draw(image)
    lines(draw,(55,footer_y),footer,2080,20)
    return image


def reference_rows(value: Any) -> dict[str,dict[str,Any]]:
    require(isinstance(value,dict) and isinstance(value.get('rows'),list),"Invalid reference document")
    result={}
    for row in value['rows']:
        require(isinstance(row,dict) and isinstance(row.get('name'),str),"Reference row needs a name")
        for field in ('matchupMean','synergyMean'):
            require(row.get(field) is None or finite_number(row[field]) and abs(row[field])<=1e50,"Non-finite reference coordinate")
        if row.get('matchupMean') is None or row.get('synergyMean') is None:
            continue
        identifier=key(row['name'])
        require(identifier not in result,"Duplicate reference hero")
        result[identifier]=row
    return result


def comparison(payload: dict[str,Any], rows: list[dict[str,Any]], reference: dict[str,dict[str,Any]]) -> tuple[Image.Image,int]:
    common=[row for row in rows if row['_plot'] and row['_key'] in reference]
    highlighted=[identifier for identifier in HIGHLIGHT_ORDER if identifier in {row['_key'] for row in common}][:10]
    colors={identifier:COLORS[i] for i,identifier in enumerate(highlighted)}
    image=Image.new('RGB',(2480,1510),BACKGROUND);draw=ImageDraw.Draw(image)
    draw.text((55,25),'方法对照：同名英雄位置，不计算跨面板数值距离',font=font(36,True),fill=INK)
    lines(draw,(55,85),[
        f"两面板仅显示 {len(common)} 个共有且双轴正 RMS 的英雄；其余共同英雄为灰点。颜色与编号在两个面板中一致。",
        "左侧是原站默认历史 z 分数（无量纲）；右侧是独立去噪 RMS（pp）。不同单位、不同算法、不同数据口径，不能相减。",
        "右侧只反转坐标方向使右／上更稳定；不做 z 标准化、不重新居中、不连接不同单位的点。",
    ],2350,21)
    left=(130,300,990,1160);right=(1170,300,2030,1160)
    draw.text((560,245),'原站可见默认历史 z',font=font(28,True),fill=INK,anchor='mm')
    draw.text((1600,245),'去噪独立版：物理 RMS（非精确复刻）',font=font(28,True),fill=INK,anchor='mm')
    zvals=[reference[row['_key']][field] for row in common for field in ('matchupMean','synergyMean')]
    x1,y1=plot_axes(image,left,zvals,signed=True,reverse=False,
        x_label='原站 matchup z → 更稳定',y_label='原站 synergy z → 更稳定')
    rmsvals=[axis_value(row,axis) for row in common for axis in ('matchup','synergy')]
    x2,y2=plot_axes(image,right,rmsvals,signed=False,reverse=True,
        x_label='独立 matchup RMS（pp）→ 更稳定',y_label='独立 synergy RMS（pp）→ 更稳定')
    points(image,common,lambda row:(reference[row['_key']]['matchupMean'],reference[row['_key']]['synergyMean']),x1,y1,
        highlights=colors,label_highlights_only=True)
    points(image,common,lambda row:(axis_value(row,'matchup'),axis_value(row,'synergy')),x2,y2,
        highlights=colors,label_highlights_only=True)
    draw.text((2100,300),'重点英雄（非排名）',font=font(23,True),fill=INK)
    for i,identifier in enumerate(highlighted):
        row=next(row for row in common if row['_key']==identifier)
        yy=355+i*42
        draw.ellipse((2100,yy,2117,yy+17),fill=colors[identifier])
        draw.text((2130,yy-6),f"{row['number']} {row['displayName']}",font=font(21),fill=INK)
    scope=payload['scope']
    lines(draw,(55,1260),[
        f"独立数据：{safe_text(scope.get('source'))} | 交互版本 {safe_text(scope.get('interactionPatch'))} | {safe_text(scope.get('region'))} | {safe_text(scope.get('population'),250)}",
        '噪声未分辨／覆盖不足的英雄不放入任一对照面板，不把它们移到零点。未显示不等于被判断为最稳定。',
        '跨位置去噪聚合是独立定义；作者聚合未完整公开。无置信区间，敏感性不能当作置信区间。',
    ],2350,21)
    return image,len(common)


def write_csv(path: Path, payload: dict[str,Any], rows: list[dict[str,Any]], reference: dict[str,dict[str,Any]]) -> None:
    fields=['number','champion','name','pick_rate','baseline_games','rms_point','excluded_reason','noise_model_sensitive',
            'matchup_status','matchup_usable_roles','matchup_expected_roles','matchup_signed_variance_pp2','matchup_rms_pp',
            'synergy_status','synergy_usable_roles','synergy_expected_roles','synergy_signed_variance_pp2','synergy_rms_pp',
            'source','interaction_patch','region','queue_id','population','method','own_display_floor','target_primary_floor',
            'original_matchup_z_different_unit','original_synergy_z_different_unit','variants_json']
    buffer=io.StringIO(newline='');writer=csv.DictWriter(buffer,fieldnames=fields);writer.writeheader()
    scope=payload['scope']
    for row in rows:
        record={'number':row['number'],'champion':row['champion'],'name':row['displayName'],'pick_rate':row['pickRate'],
                'baseline_games':row['baselineGames'],'rms_point':row['_plot'],'excluded_reason':row['_reason'],
                'noise_model_sensitive':row['noiseModelSensitive'],'source':scope.get('source',''),
                'interaction_patch':scope.get('interactionPatch',''),'region':scope.get('region',''),
                'queue_id':scope.get('queueId',''),'population':scope.get('population',''),'method':METHOD,
                'own_display_floor':payload['ownDisplayFloor'],'target_primary_floor':payload['targetPrimaryFloor'],
                'variants_json':json.dumps(row.get('variants',[]),ensure_ascii=False,allow_nan=False,separators=(',',':'))}
        for axis in ('matchup','synergy'):
            estimate=row['primary'][axis]
            for suffix,field in [('status','status'),('usable_roles','usableRoles'),('expected_roles','expectedRoles'),
                                 ('signed_variance_pp2','meanSignedCorrectedVariancePp2'),('rms_pp','correctedRmsSpreadPp')]:
                record[f'{axis}_{suffix}']=estimate.get(field) if estimate.get(field) is not None else ''
        original=reference.get(row['_key'],{})
        record['original_matchup_z_different_unit']=original.get('matchupMean','')
        record['original_synergy_z_different_unit']=original.get('synergyMean','')
        writer.writerow({field:csv_safe(value) for field,value in record.items()})
    atomic_bytes(path,buffer.getvalue().encode('utf-8-sig'))


def render(input_path: str | Path, output_prefix: str | Path, reference_path: str | Path | None = None) -> dict[str,Any]:
    source=checked_path(input_path,'.json')
    prefix=Path(output_prefix)
    require(prefix.is_absolute(),'Output prefix must be absolute')
    primary_path=checked_path(str(prefix)+'-primary.png','.png')
    signed_path=checked_path(str(prefix)+'-signed-variance.png','.png')
    csv_path=checked_path(str(prefix)+'.csv','.csv')
    comparison_path=checked_path(str(prefix)+'-comparison.png','.png')
    payload=load_json(source);rows=prepare(payload)
    require(isinstance(payload.get('notes',[]),list) and all(isinstance(note,str) for note in payload.get('notes',[])), 'Notes must be strings')
    reference=reference_rows(load_json(checked_path(reference_path,'.json'))) if reference_path is not None else {}
    save_image(render_single(payload,rows,False),primary_path)
    save_image(render_single(payload,rows,True),signed_path)
    write_csv(csv_path,payload,rows,reference)
    result={'primary':str(primary_path),'signedVariance':str(signed_path),'csv':str(csv_path),
            'cohort':len(rows),'positiveRmsPoints':sum(row['_plot'] for row in rows)}
    if reference_path is not None:
        image,count=comparison(payload,rows,reference);save_image(image,comparison_path)
        result.update({'comparison':str(comparison_path),'comparisonCommonPositive':count})
    return result


def self_test() -> dict[str,Any]:
    root=research_root();root.mkdir(parents=True,exist_ok=True)
    directory=Path(tempfile.mkdtemp(prefix='noise-render-synthetic-',dir=root))
    def axis(variance: float | None, expected: int, usable: int | None = None) -> dict[str,Any]:
        complete=usable is None or usable==expected
        return {'status':'incomplete' if not complete else 'available' if variance is not None and variance>0 else 'noise-dominated',
                'expectedRoles':expected,'usableRoles':expected if usable is None else usable,
                'meanSignedCorrectedVariancePp2':variance,'correctedRmsSpreadPp':math.sqrt(variance) if complete and variance is not None and variance>0 else None}
    names=['Ahri','Yasuo','Ekko','Azir','Aurora','Akshan','Zed','Orianna','Hwei','Xerath','Ryze','LeBlanc']
    rows=[];reference=[]
    for i in range(41):
        name=names[i] if i<len(names) else ['Annie','Galio','Qiyana','Zoe'][i-37] if i>=37 else f'Synthetic{i}'
        vx=.4+(i%11)*.09;vy=.3+((i*7)%13)*.065 if i<37 else -.002*(i-36)
        primary={'matchup':axis(vx,5),'synergy':axis(vy,4)}
        rows.append({'number':i+1,'champion':name,'name':name,'pickRate':.01,'baselineGames':1000+i*100,
            'point':i<37,'primary':primary,'noiseModelSensitive':i in (3,14),
            'variants':[{'pickRateFloor':.0025,'noiseModel':'synthetic','result':primary}],
            'syntheticRoleVariancesPp2':[-.1,.2,.3,.4,1.2] if i==0 else []})
        reference.append({'name':name,'matchupMean':math.cos(i)*1.4,'synergyMean':math.sin(i)*1.5})
    rows[-1]['primary']['synergy']=axis(0,4)
    payload={'method':METHOD,'scope':{'source':'SYNTHETIC ONLY','interactionPatch':'16.21','region':'synthetic','queueId':420,'population':'No actual player/match data'},
        'ownRole':'MID','ownDisplayFloor':.005,'targetPrimaryFloor':.005,'rows':rows,
        'notes':['SYNTHETIC QA ONLY; 37 positive RMS points and four unresolved synergy axes.',
                 'A negative role block may coexist with a positive whole-axis signed mean; do not clip the block first.']}
    source=directory/'synthetic.json';source.write_text(json.dumps(payload),encoding='utf-8')
    ref=directory/'reference.json';ref.write_text(json.dumps({'rows':reference}),encoding='utf-8')
    result=render(source,directory/'synthetic',ref)
    assert result['positiveRmsPoints']==37 and result['comparisonCommonPositive']==37
    with Path(result['csv']).open(encoding='utf-8-sig',newline='') as stream:
        exported=list(csv.DictReader(stream))
    assert len(exported)==41
    assert exported[-1]['synergy_signed_variance_pp2']=='0' and exported[-1]['synergy_rms_pp']=='' and exported[-1]['rms_point']=='False'
    assert exported[0]['matchup_rms_pp']==str(math.sqrt(.4))
    incomplete=json.loads(json.dumps(payload));incomplete['rows'][0]['primary']['matchup']=axis(None,5,4);incomplete['rows'][0]['point']=False
    assert sum(row['_plot'] for row in prepare(incomplete))==36
    assert len([name for name in HIGHLIGHT_ORDER if name in {row['_key'] for row in prepare(payload)}])==10
    for unsupported in (float('inf'), float('-inf'), float('nan'), 1e100):
        invalid=json.loads(json.dumps(payload));invalid['rows'][0]['primary']['matchup']['meanSignedCorrectedVariancePp2']=unsupported
        try:prepare(invalid)
        except RenderInputError:pass
        else:raise AssertionError('Non-finite/extreme estimate was not rejected')
    assert math.isclose(sum(rows[0]['syntheticRoleVariancesPp2'])/5, .4)
    assert not prepare(payload)[-1]['_plot']
    for bad_path in (Path.cwd()/'outside-user-data.json', research_root()/'..'/'escape.json'):
        try:checked_path(bad_path,'.json')
        except RenderInputError:pass
        else:raise AssertionError('Outside input path was not rejected')
    try:render(source,Path.cwd()/'outside-user-data')
    except RenderInputError:pass
    else:raise AssertionError('Outside path was not rejected')
    return {'selfTest':'passed',**result}


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input',nargs='?');parser.add_argument('prefix',nargs='?')
    parser.add_argument('--reference');parser.add_argument('--self-test',action='store_true')
    args=parser.parse_args()
    try:
        if args.self_test:result=self_test()
        elif args.input and args.prefix:result=render(args.input,args.prefix,args.reference)
        else:parser.error('Provide input and output prefix or --self-test')
        print(json.dumps(result,ensure_ascii=False));return 0
    except (RenderInputError,OSError,json.JSONDecodeError) as error:
        print(json.dumps({'status':'render_failed','category':type(error).__name__}));return 1


if __name__=='__main__':
    raise SystemExit(main())
