"""Isolated offline posterior experiment renderer; never reads credentials/network.

Usage: python render-posterior-map.py INPUT.json ABS_PREFIX [--reference REF.json]
All input/output is restricted to dedicated Electron research userData.
"""
from __future__ import annotations

import argparse
import csv
import importlib.util
import json
import math
import tempfile
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw

spec=importlib.util.spec_from_file_location('source_z_helpers',Path(__file__).with_name('render-source-style-z.py'))
assert spec is not None and spec.loader is not None
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
h=s.h
METHOD='complete-cohort-posterior-source-z-v1'


def validate(payload: Any) -> list[dict[str,Any]]:
    h.require(isinstance(payload,dict) and payload.get('method')==METHOD,'Unexpected method')
    h.require(isinstance(payload.get('scope'),dict) and payload.get('ownRole') in s.ROLES,'Missing scope/role')
    for name in ('ownDisplayFloor','targetPickRateFloor'):
        h.require(h.finite_number(payload.get(name)) and 0<=payload[name]<=1,'Invalid pick rate floor')
    h.require(all(name in payload for name in ('scoreDefinition','noiseModel','uncertainty')),'Missing model provenance')
    h.require(isinstance(payload.get('rows'),list) and 2<=len(payload['rows'])<=200,'Invalid cohort')
    expected={('matchup',role) for role in s.ROLES}|{('synergy',role) for role in s.ROLES if role!=payload['ownRole']}
    rows=[];seen=set()
    for i,row in enumerate(payload['rows']):
        h.require(isinstance(row,dict) and type(row.get('champion')) in (str,int),'Invalid champion')
        identity=str(row['champion']);h.require(identity and identity not in seen,'Duplicate champion');seen.add(identity)
        h.require(h.finite_number(row.get('pickRate')) and 0<=row['pickRate']<=1,'Invalid pick rate')
        h.require(type(row.get('baselineGames')) is int and row['baselineGames']>=0,'Invalid sample')
        h.require(row.get('matchupRoles')==5 and row.get('synergyRoles')==4,'Every point requires complete 5+4 roles')
        h.require(isinstance(row.get('axes'),dict),'Missing axis estimates')
        support=[]
        for mode,roles in (('matchup',5),('synergy',4)):
            axis=row['axes'].get(mode)
            h.require(isinstance(axis,dict) and axis.get('roles')==roles,'Incomplete axis role coverage')
            h.require(all(s.number(axis.get(field)) for field in ('meanZ','lower','upper')),'Nonfinite axis')
            h.require(axis['lower']<=axis['upper'],'Reversed conditional range')
            h.require(s.number(row.get(mode+'Mean')) and math.isclose(row[mode+'Mean'],axis['meanZ'],rel_tol=1e-9,abs_tol=1e-12),'Axis point mismatch')
            support.append(axis['lower']>0 or axis['upper']<0)
        h.require(type(row.get('conditionalQuadrantSupported')) is bool and row['conditionalQuadrantSupported']==all(support),'Conditional quadrant flag mismatch')
        h.require(isinstance(row.get('blocks'),list),'Missing blocks')
        pairs=set()
        for block in row['blocks']:
            h.require(isinstance(block,dict),'Invalid block')
            pair=(block.get('mode'),block.get('otherRole'))
            h.require(pair in expected and pair not in pairs,'Invalid/duplicate block');pairs.add(pair)
            h.require(s.number(block.get('meanZ')),'Missing finite posterior block')
            for field in ('zInterval95','simultaneousRoleZBounds'):
                bound=block.get(field)
                h.require(isinstance(bound,dict) and all(s.number(bound.get(edge)) for edge in ('lower','upper')) and bound['lower']<=bound['upper'],'Invalid block range')
                if field=='simultaneousRoleZBounds':
                    h.require(h.finite_number(bound.get('tailProbability')) and 0<bound['tailProbability']<1,'Invalid simultaneous tail probability')
            h.require(h.finite_number(block.get('posteriorZeroTauProbability')) and 0<=block['posteriorZeroTauProbability']<=1,'Invalid posterior probability')
            h.require(s.number(block.get('posteriorPriorKl')) and block['posteriorPriorKl']>=0,'Invalid posterior KL')
        h.require(pairs==expected,'Missing complete posterior roles')
        rows.append({**row,'number':i+1,'_key':h.key(row.get('name') or identity),'displayName':h.display_name(row),
                     # Reuse marker primitive only: complete here means quadrant supported, NOT coverage.
                     'complete':row['conditionalQuadrantSupported']})
    s.encoded(payload)  # Reject nonfinite values even in optional audit metadata.
    return rows


def header(image: Image.Image,payload: dict[str,Any],rows: list[dict[str,Any]],title: str) -> None:
    draw=ImageDraw.Draw(image);scope=payload['scope'];source=h.safe_text(scope.get('source'))
    if source.lower().startswith('lolalytics'):source='Lolalytics'
    draw.text((50,25),title,font=h.font(36,True),fill=h.INK)
    h.lines(draw,(50,85),[
        f"{payload['ownRole']} | {source} | 交互版本 {h.safe_text(scope.get('interactionPatch'))} | {h.safe_text(scope.get('region'))} | {h.safe_text(scope.get('population'),160)}",
        f"固定完整参照 {len(rows)} 英雄 × 9 角色块；每次 posterior draw 全候选逐块 z，再聚合、取 E[z]。未对最终均值再次标准化。",
    ],2450,21)


def warning(draw: Any,width: int) -> None:
    draw.rectangle((40,170,width-40,300),fill='#fff0d6')
    h.lines(draw,(55,180),[
        '实验版，尚未完全验证；这是独立 working likelihood，不是作者原模型，不宣称默认全流程复刻完成。',
        '全部点完整 5 敌 / 4 友。实心 = 两轴条件模型范围均不跨 0；空心 = 象限仍不确定，不再表示缺块。',
        '范围仅在模型条件下近似：不含 prior-fit、baseline WR 估计及真实 match covariance；不是安全选人证据。',
    ],width-120,21,'#694400')


def point(draw: Any,x: float,y: float,row: dict[str,Any],color: str,labelled: bool=True) -> None:
    s.marker(draw,x,y,row,color,labelled)
    if labelled and not row['conditionalQuadrantSupported']:
        # Hollow yellow/light-blue symbols still need high-contrast numeric lookup.
        draw.text((x,y),str(row['number']),font=h.font(17,True),fill=h.INK,anchor='mm')


def main_image(payload: dict[str,Any],rows: list[dict[str,Any]],values: list[float]) -> Image.Image:
    height=max(1880,460+len(rows)*31+310)
    image=Image.new('RGB',(2580,height),h.BACKGROUND);draw=ImageDraw.Draw(image)
    header(image,payload,rows,'完整参照估计实验版：相对稳定性象限（尚未完全验证）');warning(draw,2580)
    x,y=s.axes(image,(135,370,1235,1470),values)
    for at,label,anchor in [((150,385),'相对更挑对手／较不挑队友','la'),((1220,385),'相对较不挑对手／较不挑队友','ra'),
                            ((150,1430),'相对更挑对手／更挑队友','la'),((1220,1430),'相对较不挑对手／更挑队友','ra')]:
        draw.text(at,label,font=h.font(19),fill=h.MUTED,anchor=anchor)
    for row in rows:point(draw,x(row['matchupMean']),y(row['synergyMean']),row,h.TEAL)
    left=1310
    draw.text((left,365),'编号／英雄／E[z] 与近似条件模型范围',font=h.font(25,True),fill=h.INK)
    for offset,label in [(0,'编号'),(70,'英雄'),(345,'对手 E[z] [下界, 上界]'),(775,'队友 E[z] [下界, 上界]')]:
        draw.text((left+offset,410),label,font=h.font(19,True),fill=h.MUTED)
    for i,row in enumerate(rows):
        at=450+i*31;color=h.INK if row['conditionalQuadrantSupported'] else h.PURPLE
        draw.text((left,at),str(row['number']),font=h.font(19),fill=color)
        draw.text((left+70,at),h.fit_text(draw,row['displayName'],h.font(19),260),font=h.font(19),fill=color)
        for mode,offset in (('matchup',345),('synergy',775)):
            axis=row['axes'][mode]
            draw.text((left+offset,at),f"{axis['meanZ']:+.3f} [{axis['lower']:+.3f}, {axis['upper']:+.3f}]",font=h.font(18),fill=color)
    h.lines(draw,(55,max(1570,450+len(rows)*31+30)),[
        f"全部 {len(rows)} 点完整 5+4；{sum(row['conditionalQuadrantSupported'] for row in rows)} 点两轴近似条件范围均不跨 0。空心仅表示象限不确定。",
        '正值：比固定完整参照更稳定；负值：相对更挑。零轴不是安全资格线，象限不等于强度或胜率。',
        '表格展示全部范围，不裁断范围作为真实边界；完整精度、块级后验与模型说明保存在 CSV。',
        '没有按原站坐标拟合、shift、rescale 或重居中；原站默认 upstream pair shrink 未精确复刻。',
    ],2460,21)
    return image


def comparison(payload: dict[str,Any],rows: list[dict[str,Any]],reference: dict[str,Any],values: list[float]) -> tuple[Image.Image,int]:
    common=[row for row in rows if row['_key'] in reference];colors={key:h.COLORS[i] for i,key in enumerate(h.HIGHLIGHT_ORDER)}
    image=Image.new('RGB',(2600,1630),h.BACKGROUND);draw=ImageDraw.Draw(image)
    header(image,payload,rows,'实验对照：原站历史默认 z／完整参照 posterior E[z]')
    warning(draw,2600)
    draw.text((555,320),'原站：16.16 PR+／历史交互默认 z',font=h.font(25,True),fill=h.INK,anchor='mt')
    draw.text((1645,320),'本次：完整参照实验 E[z]（16.21 交互）',font=h.font(25,True),fill=h.INK,anchor='mt')
    x1,y1=s.axes(image,(125,380,1015,1270),values);x2,y2=s.axes(image,(1215,380,2105,1270),values)
    for row in sorted(common,key=lambda item:item['_key'] in colors):
        chosen=row['_key'] in colors;color=colors.get(row['_key'],'#a6b2bc');old=reference[row['_key']]
        point(draw,x1(old['matchupMean']),y1(old['synergyMean']),row,color,chosen)
        point(draw,x2(row['matchupMean']),y2(row['synergyMean']),row,color,chosen)
    draw.text((2180,385),'公平选例（非排名）',font=h.font(23,True),fill=h.INK)
    at=440
    for key in h.HIGHLIGHT_ORDER:
        row=next((row for row in common if row['_key']==key),None)
        if row is None:continue
        draw.ellipse((2180,at+4,2197,at+21),fill=colors[key]);draw.text((2210,at),f"{row['number']} {row['displayName']}",font=h.font(21),fill=h.INK)
        at+=53
    h.lines(draw,(55,1400),[
        f"仅对照 {len(common)} 共有英雄。共用正常对称 z 刻度，色／编号一致；左侧形状仅映射本次象限不确定性，不代表原站范围。",
        '不按网站坐标拟合；同为无量纲不代表同一估计量。上游数据、噪声模型、收缩及历史口径不同。',
        '固定候选逐 draw 归一化后取均值，没有对 E[z] 再做标准化；范围详见主图全英雄表和 CSV。',
    ],2470,21)
    return image,len(common)


def render(source: str|Path,prefix: str|Path,reference_path: str|Path|None=None) -> dict[str,Any]:
    source=h.checked_path(source,'.json');h.require(Path(prefix).is_absolute(),'Absolute prefix required')
    paths={key:h.checked_path(str(prefix)+suffix,ext) for key,suffix,ext in [('primary','-primary.png','.png'),('comparison','-comparison.png','.png'),('csv','.csv','.csv')]}
    payload=h.load_json(source);rows=validate(payload)
    reference=h.reference_rows(h.load_json(h.checked_path(reference_path,'.json'))) if reference_path else {}
    values=[row[field] for row in rows for field in ('matchupMean','synergyMean')]
    values.extend(row[field] for row in reference.values() for field in ('matchupMean','synergyMean'))
    h.save_image(main_image(payload,rows,values),paths['primary'])
    records=[]
    for row in rows:
        record={field:row.get(field) for field in ('number','champion','name','pickRate','baselineGames','matchupMean','synergyMean','matchupRoles','synergyRoles','conditionalQuadrantSupported')}
        for mode in ('matchup','synergy'):
            for field in ('meanZ','lower','upper','roles'):record[mode+'_'+field]=row['axes'][mode][field]
        for field in ('scope','scoreDefinition','noiseModel','uncertainty'):record[field+'_json']=s.encoded(payload[field])
        record.update(method=METHOD,own_display_floor=payload['ownDisplayFloor'],target_pick_rate_floor=payload['targetPickRateFloor'],blocks_json=s.encoded(row['blocks']))
        records.append(record)
    s.csv_file(paths['csv'],records)
    result={'primary':str(paths['primary']),'csv':str(paths['csv']),'cohort':len(rows),'complete':len(rows),'conditionalQuadrantSupported':sum(row['conditionalQuadrantSupported'] for row in rows)}
    if reference_path:
        image,count=comparison(payload,rows,reference,values);h.save_image(image,paths['comparison']);result.update(comparison=str(paths['comparison']),comparisonCommon=count)
    return result


def self_test() -> dict[str,Any]:
    root=h.research_root();root.mkdir(parents=True,exist_ok=True);directory=Path(tempfile.mkdtemp(prefix='posterior-map-synthetic-',dir=root))
    names=[key.capitalize() for key in h.HIGHLIGHT_ORDER]+[f'Synthetic{i}' for i in range(10,41)]
    rows=[]
    for i,name in enumerate(names):
        mx=math.cos(i)*1.2 if i else 0.;my=math.sin(i)*1.2 if i else 0.;width=.2 if i%2 else 1.5
        axes={mode:{'meanZ':mean,'lower':mean-width,'upper':mean+width,'roles':roles} for mode,mean,roles in [('matchup',mx,5),('synergy',my,4)]}
        supported=all(axis['lower']>0 or axis['upper']<0 for axis in axes.values())
        blocks=[{'mode':mode,'otherRole':role,'meanZ':mx if mode=='matchup' else my,'zInterval95':{'lower':-2.,'upper':2.},
                 'simultaneousRoleZBounds':{'tailProbability':.05,'lower':-3.,'upper':3.},'posteriorZeroTauProbability':.1,'posteriorPriorKl':.4} for mode,role in [('matchup',role) for role in s.ROLES]+[('synergy',role) for role in s.ROLES if role!='MID']]
        rows.append({'champion':name,'name':name,'pickRate':.01,'baselineGames':1000,'matchupMean':mx,'synergyMean':my,'matchupRoles':5,'synergyRoles':4,
                     'axes':axes,'conditionalQuadrantSupported':supported,'blocks':blocks})
    payload={'method':METHOD,'scope':{'source':'SYNTHETIC ONLY','interactionPatch':'16.21','region':'synthetic','population':'No player data'},'ownRole':'MID',
             'ownDisplayFloor':.005,'targetPickRateFloor':.005,'scoreDefinition':'Synthetic complete cohort per-draw z; E[z]',
             'noiseModel':{'synthetic':True},'uncertainty':'Conditional working model only','rows':rows}
    source=directory/'input.json';source.write_text(s.encoded(payload),encoding='utf-8')
    reference=directory/'reference.json';reference.write_text(s.encoded({'rows':[{'name':row['name'],'matchupMean':row['matchupMean']*.8,'synergyMean':row['synergyMean']*.8} for row in rows[:-1]]}),encoding='utf-8')
    result=render(source,directory/'synthetic',reference);assert result['complete']==41 and result['comparisonCommon']==40
    assert validate(payload)[0]['matchupMean']==0.
    for mutate in (lambda p:p['rows'][0]['axes']['matchup'].update(lower=2,upper=-2),
                   lambda p:p['rows'][0].update(matchupMean=.1),lambda p:p['rows'][0].update(synergyRoles=3),
                   lambda p:p['rows'][0]['blocks'].pop(),lambda p:p['rows'][0]['axes']['matchup'].update(meanZ=float('nan')),
                   lambda p:p['rows'][0]['blocks'][0]['zInterval95'].update(lower=3.,upper=-3.),
                   lambda p:p['rows'][0]['blocks'][0]['simultaneousRoleZBounds'].update(tailProbability=0.)):
        invalid=json.loads(s.encoded(payload));mutate(invalid)
        try:validate(invalid)
        except (h.RenderInputError,ValueError):pass
        else:raise AssertionError('Invalid model input accepted')
    for path in (Path.cwd()/'escape.json',root/'..'/'escape.json'):
        try:h.checked_path(path,'.json')
        except h.RenderInputError:pass
        else:raise AssertionError('Outside path accepted')
    with Path(result['csv']).open(encoding='utf-8-sig',newline='') as stream:exported=list(csv.DictReader(stream))
    assert len(exported)==41 and float(exported[0]['matchupMean'])==0.
    assert json.loads(exported[0]['blocks_json'])[0]['zInterval95']=={'lower':-2.,'upper':2.}
    # A wholly uncertain result must remain an honest all-hollow experiment.
    uncertain=json.loads(s.encoded(payload))
    for row in uncertain['rows']:
        for axis in row['axes'].values():axis.update(lower=-3.,upper=3.)
        row['conditionalQuadrantSupported']=False
    uncertain_rows=validate(uncertain)
    assert len(uncertain_rows)==41 and sum(row['conditionalQuadrantSupported'] for row in uncertain_rows)==0
    h.save_image(main_image(uncertain,uncertain_rows,[-3.,3.]),directory/'all-uncertain-primary.png')
    return {'selfTest':'passed',**result}


def main() -> int:
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('input',nargs='?');parser.add_argument('prefix',nargs='?');parser.add_argument('--reference');parser.add_argument('--self-test',action='store_true');args=parser.parse_args()
    try:
        if args.self_test:result=self_test()
        elif args.input and args.prefix:result=render(args.input,args.prefix,args.reference)
        else:parser.error('Input and absolute prefix required')
        print(json.dumps(result,ensure_ascii=False));return 0
    except (h.RenderInputError,OSError,json.JSONDecodeError,ValueError) as error:
        print(json.dumps({'status':'render_failed','category':type(error).__name__}));return 1


if __name__=='__main__':raise SystemExit(main())
