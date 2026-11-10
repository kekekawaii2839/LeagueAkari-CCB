"""Offline source-structure z map; input/output must stay in research userData.

Usage: python render-source-style-z.py INPUT.json ABS_PREFIX [--reference REF.json]
This is a renderer, not a fitter: supplied coordinates are never shifted/rescaled.
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

spec = importlib.util.spec_from_file_location('noise_map_helpers', Path(__file__).with_name('render-noise-corrected-map.py'))
assert spec is not None and spec.loader is not None
h = importlib.util.module_from_spec(spec); spec.loader.exec_module(h)
METHOD = 'source-structure-conditional-mom-z-v1'
ROLES = ('TOP', 'JUNGLE', 'MID', 'ADC', 'SUP')


def require(condition: bool, message: str) -> None:
    h.require(condition, message)


def number(value: Any, nullable: bool = False) -> bool:
    return (nullable and value is None) or (h.finite_number(value) and abs(value) <= 1e6)


def validate(payload: Any) -> list[dict[str, Any]]:
    require(isinstance(payload, dict) and payload.get('method') == METHOD, 'Unexpected method')
    audit=payload.get('pipelineAudit')
    if audit is not None:
        require(isinstance(audit,dict) and audit.get('status') in ('failed-global-comparability','not-globally-validated'), 'Invalid pipeline audit status')
    require(isinstance(payload.get('scope'), dict) and payload.get('ownRole') in ROLES, 'Invalid scope/role')
    require(isinstance(payload.get('cohort'), list) and isinstance(payload.get('rows'), list) and 0 < len(payload['rows']) <= 200, 'Invalid cohort')
    require(isinstance(payload.get('references'), list), 'Missing references')
    expected = {('matchup', role) for role in ROLES} | {('synergy', role) for role in ROLES if role != payload['ownRole']}
    refs = set()
    for ref in payload['references']:
        require(isinstance(ref, dict), 'Invalid reference block')
        pair = (ref.get('mode'), ref.get('otherRole'))
        require(pair in expected and pair not in refs, 'Duplicate/invalid reference block'); refs.add(pair)
        for field in ('candidateCount', 'finiteCount'):
            require(type(ref.get(field)) is int and ref[field] >= 0, 'Invalid reference count')
        require(ref['finiteCount'] <= ref['candidateCount'], 'Finite reference count exceeds candidates')
        for field in ('meanSdPp', 'sampleSdOfSdPp', 'denominator'):
            require(number(ref.get(field), True), 'Invalid reference statistic')
            require(ref.get(field) is None or ref[field] >= 0, 'Negative reference scale')
        require(type(ref.get('fallbackDenominatorUsed')) is bool, 'Missing fallback flag')
        require(isinstance(ref.get('champions'), list) and isinstance(ref.get('zScores'), list), 'Missing reference vector')
        require(len(ref['champions']) == ref['candidateCount'] and len(ref['zScores']) == ref['candidateCount'], 'Reference vector length mismatch')
        require(all(number(value, True) for value in ref['zScores']), 'Nonfinite reference vector')
    require(refs == expected, 'Missing reference block')
    ids = set(); rows = []
    for index, raw in enumerate(payload['rows']):
        require(isinstance(raw, dict) and type(raw.get('champion')) in (str, int), 'Invalid champion')
        identity = str(raw['champion']); require(identity not in ids, 'Duplicate champion'); ids.add(identity)
        require(all(number(raw.get(field), True) for field in ('matchupMean', 'synergyMean', 'aggregate')), 'Invalid z coordinate')
        require(type(raw.get('complete')) is bool and isinstance(raw.get('blocks'), list), 'Missing coverage')
        seen = set(); available = {'matchup': [], 'synergy': []}
        for block in raw['blocks']:
            require(isinstance(block, dict), 'Invalid block')
            pair = (block.get('mode'), block.get('otherRole'))
            require(pair in expected and pair not in seen, 'Duplicate/invalid row block'); seen.add(pair)
            require(number(block.get('sdPp'), True) and number(block.get('z'), True), 'Invalid block estimate')
            require(block.get('sdPp') is None or block['sdPp'] >= 0, 'Negative SD')
            require(block.get('z') is None or block.get('sdPp') is not None, 'Z without finite SD')
            if block.get('z') is not None:
                available[block['mode']].append(block['otherRole'])
        require(seen == expected, 'Missing explicit row block')
        for mode, axis in (('matchup', 'matchupMean'), ('synergy', 'synergyMean')):
            count = raw.get(mode+'Roles')
            require(type(count) is int and count == len(available[mode]), 'Role count does not match finite blocks')
            values = [block['z'] for block in raw['blocks'] if block['mode'] == mode and block['z'] is not None]
            require((not values and raw[axis] is None) or (bool(values) and raw[axis] is not None and math.isclose(sum(values)/len(values), raw[axis], rel_tol=1e-7, abs_tol=1e-10)), 'Mean differs from available role mean')
        complete = len(available['matchup']) == 5 and len(available['synergy']) == 4
        require(raw['complete'] == complete, 'Complete flag differs from role coverage')
        rows.append({**raw, '_key': h.key(raw.get('name') or identity), 'displayName': h.display_name(raw),
                     'number': index+1, 'availableRoles': available,
                     '_plot': raw['matchupMean'] is not None and raw['synergyMean'] is not None})
    require(len(payload['cohort']) == len(rows), 'Cohort length mismatch')
    return rows


def marker(draw: Any, px: float, py: float, row: dict[str, Any], color: str, labelled: bool = True) -> None:
    radius = 16 if labelled else 6
    draw.ellipse((px-radius, py-radius, px+radius, py+radius), fill=color if row['complete'] else 'white', outline=color, width=3)
    if labelled:
        rgb = tuple(int(color[i:i+2], 16) for i in (1, 3, 5))
        brightness = sum(value*weight for value, weight in zip(rgb, (.2126,.7152,.0722)))
        ink = color if not row['complete'] else h.INK if brightness > 150 else 'white'
        draw.text((px, py), str(row['number']), font=h.font(17, True), fill=ink, anchor='mm')


def axes(image: Image.Image, rect: tuple[int,int,int,int], values: list[float]) -> tuple[Any,Any]:
    return h.plot_axes(image, rect, values, signed=True, reverse=False,
                       x_label='对手相对稳定性 z → 越右越不挑对手', y_label='队友相对稳定性 z → 越上越不挑队友')


def header(draw: Any, payload: dict[str, Any], rows: list[dict[str, Any]], title: str) -> None:
    diagnostic=payload.get('pipelineAudit') is not None
    draw.text((50,25), '整体有效性未通过：此图仅保留用于诊断' if diagnostic else title, font=h.font(36,True), fill='#9b2929' if diagnostic else h.INK)
    scope=payload['scope']
    source_label=h.safe_text(scope.get('source'))
    if source_label.lower().startswith('lolalytics'):source_label='Lolalytics'
    h.lines(draw,(50,85),([title] if diagnostic else [])+[
        f"{payload['ownRole']} | 来源 {source_label} | 交互版本 {h.safe_text(scope.get('interactionPatch'))} | {h.safe_text(scope.get('region'))} | {h.safe_text(scope.get('population'),180)}",
        f"固定 {len(rows)} 候选；每块仅在有限 SD 参照子集中 reverse sample-z，再平均可用位置。没有 shift、rescale 或重新居中。",
    ],2300,21)


def primary(payload: dict[str, Any], rows: list[dict[str, Any]], values: list[float]) -> Image.Image:
    height=max(1880, 480+len(rows)*30+350)
    image=Image.new('RGB',(2420,height),h.BACKGROUND); draw=ImageDraw.Draw(image)
    header(draw,payload,rows,'原站结构象限：逐位置去噪 SD → z → 可用位置均值')
    finite_counts=[ref['finiteCount'] for ref in payload['references']]
    draw.rectangle((40,175,2370,300),fill='#fff0d6')
    h.lines(draw,(55,185),[
        f"各块参照有限子集 {min(finite_counts)}–{max(finite_counts)}；实心 = 完整 5 敌 / 4 友，空心 = 局部角色估计（保留缺块，不补 0）。",
        '零轴只表示相对当前各块可估参照的均值；不是安全资格线。空心点象限不能当作完整盲选结论。',
        '16.21 新交互数据 ≠ 原站 16.16 PR+／历史交互；未复刻原站默认上游 pair shrink，默认完整精确复刻仍未知。',
    ],2290,21,'#694400')
    x,y=axes(image,(135,370,1235,1470),values)
    # Quadrants describe the relative/local estimate rather than a draft permission.
    for at,label,anchor in [((150,385),'相对更挑对手／较不挑队友','la'),((1220,385),'相对较不挑对手／较不挑队友','ra'),
                            ((150,1430),'相对更挑对手／更挑队友','la'),((1220,1430),'相对较不挑对手／更挑队友','ra')]:
        draw.text(at,label,font=h.font(19),fill=h.MUTED,anchor=anchor)
    for row in rows:
        if row['_plot']:
            marker(draw,x(row['matchupMean']),y(row['synergyMean']),row,h.TEAL)
    left=1315
    draw.text((left,365),'编号／英雄／角色覆盖／z 坐标（完整精度见 CSV）',font=h.font(24,True),fill=h.INK)
    for offset,label in [(0,'编号'),(65,'英雄'),(345,'敌/友'),(505,'对手 z'),(700,'队友 z')]:
        draw.text((left+offset,408),label,font=h.font(20,True),fill=h.MUTED)
    for i,row in enumerate(rows):
        at=448+i*30; ink=h.INK if row['complete'] else h.PURPLE
        cells=[(0,str(row['number'])),(65,h.fit_text(draw,row['displayName'],h.font(20),270)),
               (345,f"{row['matchupRoles']}/{row['synergyRoles']}"),
               (505,'缺失' if row['matchupMean'] is None else f"{row['matchupMean']:+.4f}"),
               (700,'缺失' if row['synergyMean'] is None else f"{row['synergyMean']:+.4f}")]
        for offset,label in cells:draw.text((left+offset,at),label,font=h.font(20),fill=ink)
    footer=max(1580,448+len(rows)*30+35)
    h.lines(draw,(55,footer),[
        f"{sum(row['_plot'] for row in rows)} 个双轴点；{sum(row['complete'] for row in rows)} 个完整 9 块；其余保留可用角色数量与明细，不隐藏缺块。",
        '正值 = 比该块当前可估参照更稳定；负值 = 相对更挑。部分角色缺失可能改变象限，不能视作全角色排名。',
        '这是原站后半段结构，不是默认全流程精确复刻；无置信区间。噪声模型敏感性不能当作置信区间。',
        '每块有限 SD 的样本 z、参照英雄/数量/均值/分母/fallback，以及所有 block SD/z 均保存在 CSV。',
    ],2290,21)
    return image


def compare(payload: dict[str, Any], rows: list[dict[str, Any]], reference: dict[str,Any], values: list[float]) -> tuple[Image.Image,int]:
    common=[row for row in rows if row['_plot'] and row['_key'] in reference]
    colors={key:h.COLORS[i] for i,key in enumerate(h.HIGHLIGHT_ORDER)}
    image=Image.new('RGB',(2600,1590),h.BACKGROUND);draw=ImageDraw.Draw(image)
    header(draw,payload,rows,'结构对照：原站历史默认 z 与当前逐块去噪 z')
    h.lines(draw,(50,170),[
        '正常 z 坐标、共用对称刻度；不 shift、不 rescale、不重新居中。同色同编号对应同一英雄。',
        '同为无量纲，但上游交互数据、收缩和参照子集不同：不能把位置距离当作复刻误差或同一统计量。',
        '实心：本次完整 5+4；空心：本次局部角色估计。覆盖数保留在主图与 CSV；左侧形状只为匹配本次覆盖。',
    ],2480,21)
    draw.text((555,285),'原站：16.16 PR+／历史交互默认 z',font=h.font(27,True),fill=h.INK,anchor='mt')
    draw.text((1645,285),'本次：16.21 新交互／逐块去噪 z',font=h.font(27,True),fill=h.INK,anchor='mt')
    x1,y1=axes(image,(125,355,1015,1245),values);x2,y2=axes(image,(1215,355,2105,1245),values)
    # Grey points first so all selected examples remain visible, without moving any point.
    ordered=sorted(common,key=lambda row:row['_key'] in colors)
    for row in ordered:
        selected=row['_key'] in colors;color=colors.get(row['_key'],'#a6b2bc')
        origin=reference[row['_key']]
        marker(draw,x1(origin['matchupMean']),y1(origin['synergyMean']),row,color,selected)
        marker(draw,x2(row['matchupMean']),y2(row['synergyMean']),row,color,selected)
    draw.text((2180,360),'公平选例（非排名）',font=h.font(23,True),fill=h.INK)
    at=410
    for key in h.HIGHLIGHT_ORDER:
        row=next((row for row in common if row['_key']==key),None)
        if row is None:continue
        draw.ellipse((2180,at+5,2197,at+22),fill=colors[key])
        draw.text((2210,at),f"{row['number']} {row['displayName']}",font=h.font(21),fill=h.INK)
        draw.text((2210,at+27),f"覆盖 {row['matchupRoles']}/{row['synergyRoles']}",font=h.font(18),fill=h.MUTED)
        at+=65
    h.lines(draw,(55,1370),[
        f"只对照 {len(common)} 个共有双轴可用英雄，其余共有英雄为灰点；未绘制的缺轴不补 0。",
        '原站默认 upstream pair shrink 与完整跨步骤处理未确认；本图不宣称完整精确复刻。',
        '象限仅为相对／局部稳定性描述，不是安全选人资格线；部分角色缺失可能改变象限。',
    ],2480,21)
    return image,len(common)


def csv_file(path: Path, records: list[dict[str, Any]]) -> None:
    require(bool(records), 'Cannot export empty metadata table')
    buffer=io.StringIO(newline='');writer=csv.DictWriter(buffer,fieldnames=list(records[0]));writer.writeheader()
    for row in records:writer.writerow({key:h.csv_safe(value) for key,value in row.items()})
    h.atomic_bytes(path,buffer.getvalue().encode('utf-8-sig'))


def encoded(value: Any) -> str:
    return json.dumps(value,ensure_ascii=False,separators=(',',':'),allow_nan=False)


def render(input_path: str | Path, prefix: str | Path, reference_path: str | Path | None = None) -> dict[str,Any]:
    source=h.checked_path(input_path,'.json');require(Path(prefix).is_absolute(),'Absolute prefix required')
    paths={name:h.checked_path(str(prefix)+suffix,extension) for name,suffix,extension in [
        ('primary','-primary.png','.png'),('comparison','-comparison.png','.png'),('csv','.csv','.csv'),
        ('blockReferences','-block-references.csv','.csv')]}
    payload=h.load_json(source);rows=validate(payload)
    reference=h.reference_rows(h.load_json(h.checked_path(reference_path,'.json'))) if reference_path else {}
    values=[row[field] for row in rows for field in ('matchupMean','synergyMean') if row[field] is not None]
    values.extend(row[field] for row in reference.values() for field in ('matchupMean','synergyMean'))
    # Validate serialization before creating any output (including optional metadata).
    encoded(payload)
    h.save_image(primary(payload,rows,values),paths['primary'])
    records=[]
    for row in rows:
        records.append({'number':row['number'],'champion':row['champion'],'name':row.get('name'),
            'matchup_z':row['matchupMean'],'synergy_z':row['synergyMean'],'aggregate':row['aggregate'],
            'matchup_roles':row['matchupRoles'],'synergy_roles':row['synergyRoles'],'complete':row['complete'],
            'matchup_available_roles':encoded(row['availableRoles']['matchup']),
            'synergy_available_roles':encoded(row['availableRoles']['synergy']),
            'blocks_json':encoded(row['blocks']),'scope_json':encoded(payload['scope']),
            'reference_definition_json':encoded(payload.get('referenceDefinition')),'method':METHOD,
            'pipeline_audit_json':encoded(payload.get('pipelineAudit')),
            'pick_rate':next((candidate.get('pickRate') for candidate in payload['cohort'] if str(candidate.get('champion'))==str(row['champion'])),None)})
    csv_file(paths['csv'],records)
    refs=[]
    for ref in payload['references']:
        refs.append({key:encoded(value) if isinstance(value,(list,dict)) else value for key,value in ref.items()})
    # Reference objects can carry optional audit metadata; normalize columns across blocks.
    columns=list(dict.fromkeys(key for ref in refs for key in ref))
    csv_file(paths['blockReferences'],[{key:ref.get(key) for key in columns} for ref in refs])
    result={key:str(value) for key,value in paths.items() if key!='comparison'}
    if reference_path:
        image,count=compare(payload,rows,reference,values);h.save_image(image,paths['comparison'])
        result.update(comparison=str(paths['comparison']),comparisonCommon=count)
    result.update(cohort=len(rows),points=sum(row['_plot'] for row in rows),complete=sum(row['complete'] for row in rows),diagnosticOnly=payload.get('pipelineAudit') is not None)
    return result


def self_test() -> dict[str,Any]:
    root=h.research_root();root.mkdir(parents=True,exist_ok=True)
    directory=Path(tempfile.mkdtemp(prefix='source-z-synthetic-',dir=root))
    names=[key.capitalize() for key in h.HIGHLIGHT_ORDER]+[f'Synthetic{i}' for i in range(10,41)]
    pairs=[('matchup',role) for role in ROLES]+[('synergy',role) for role in ROLES if role!='MID']
    refs=[{'mode':mode,'otherRole':role,'candidateCount':41,'finiteCount':22+2*i,'meanSdPp':1.,'sampleSdOfSdPp':.3,
           'denominator':.3,'fallbackDenominatorUsed':False,'champions':names,'zScores':[0.]*(22+2*i)+[None]*(19-2*i)} for i,(mode,role) in enumerate(pairs)]
    rows=[]
    for i,name in enumerate(names):
        blocks=[{'mode':mode,'otherRole':role,'sdPp':1.,'z':math.cos(i)*1.2 if mode=='matchup' else math.sin(i)*1.2} for mode,role in pairs]
        if i>=7:
            for block in blocks[7:]:block.update(sdPp=None,z=None)
        if i>=30:
            blocks[4].update(sdPp=None,z=None)
            blocks[6].update(sdPp=None,z=None)
        if i==0:
            for block in blocks:block['z']=0.
        rows.append({'champion':name,'name':name,'matchupMean':blocks[0]['z'],'synergyMean':blocks[5]['z'],
                     'aggregate':0.,'matchupRoles':5 if i<30 else 4,'synergyRoles':4 if i<7 else 2 if i<30 else 1,'complete':i<7,'blocks':blocks})
    payload={'method':METHOD,'scope':{'source':'SYNTHETIC ONLY','interactionPatch':'16.21','region':'synthetic','population':'No player data'},
             'ownRole':'MID','referenceDefinition':{'synthetic':True},'cohort':[{'champion':name,'name':name,'pickRate':.01} for name in names],
             'references':refs,'rows':rows}
    source=directory/'input.json';source.write_text(encoded(payload),encoding='utf-8')
    ref=directory/'reference.json';ref.write_text(encoded({'rows':[{'name':name,'matchupMean':math.cos(i),'synergyMean':math.sin(i)} for i,name in enumerate(names)]}),encoding='utf-8')
    result=render(source,directory/'synthetic',ref)
    assert result['points']==41 and result['complete']==7 and validate(payload)[0]['matchupMean']==0
    for value in (float('inf'),float('nan'),1e100):
        invalid=json.loads(encoded(payload));invalid['rows'][0]['blocks'][0]['z']=value
        try:validate(invalid)
        except h.RenderInputError:pass
        else:raise AssertionError('Nonfinite/extreme accepted')
    absent=json.loads(encoded(payload))
    for block in absent['rows'][0]['blocks']:
        if block['mode']=='synergy':block.update(sdPp=None,z=None)
    absent['rows'][0].update(synergyMean=None,synergyRoles=0,complete=False)
    assert not validate(absent)[0]['_plot']
    for path in (Path.cwd()/'escape.json',root/'..'/'escape.json'):
        try:h.checked_path(path,'.json')
        except h.RenderInputError:pass
        else:raise AssertionError('Outside path accepted')
    with Path(result['csv']).open(encoding='utf-8-sig',newline='') as stream:
        exported=list(csv.DictReader(stream))
    assert len(exported)==41 and exported[7]['synergy_roles']=='2' and 'null' in exported[7]['blocks_json']
    assert exported[-1]['matchup_roles']=='4' and exported[-1]['synergy_roles']=='1'
    audited={**payload,'pipelineAudit':{'status':'failed-global-comparability','reason':'SYNTHETIC QA ONLY'}}
    audited_source=directory/'synthetic-audited.json';audited_source.write_text(encoded(audited),encoding='utf-8')
    assert render(audited_source,directory/'synthetic-audited',ref)['diagnosticOnly'] is True
    with (directory/'synthetic-audited.csv').open(encoding='utf-8-sig',newline='') as stream:
        assert json.loads(next(csv.DictReader(stream))['pipeline_audit_json'])==audited['pipelineAudit']
    return {'selfTest':'passed',**result}


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('input',nargs='?');parser.add_argument('prefix',nargs='?')
    parser.add_argument('--reference');parser.add_argument('--self-test',action='store_true');args=parser.parse_args()
    try:
        if args.self_test:result=self_test()
        elif args.input and args.prefix:result=render(args.input,args.prefix,args.reference)
        else:parser.error('Input and absolute output prefix required')
        print(json.dumps(result,ensure_ascii=False));return 0
    except (h.RenderInputError,OSError,json.JSONDecodeError,ValueError) as error:
        print(json.dumps({'status':'render_failed','category':type(error).__name__}));return 1


if __name__=='__main__':raise SystemExit(main())
