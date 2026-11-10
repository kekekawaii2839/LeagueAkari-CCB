"""Offline pair-shrinkage charts; all IO stays in research Electron userData."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
from PIL import Image,ImageDraw

spec=importlib.util.spec_from_file_location('video_helpers',Path(__file__).with_name('render-video-mom.py'))
assert spec and spec.loader
vm=importlib.util.module_from_spec(spec);spec.loader.exec_module(vm)
s,h=vm.s,vm.h
METHOD='pair-shrinkage-source-score-v1'

def validate(p):
    h.require(p.get('method')==METHOD and p.get('ownRole')=='MID','Unexpected method/role')
    h.require(isinstance(p.get('scope'),dict) and isinstance(p.get('settings'),dict),'Missing provenance')
    h.require(type(p.get('referenceSize')) is int and 2<=p['referenceSize']<=300,'Invalid reference')
    for field in ('shrinkAlpha','pickRateFloor'):
        h.require(h.finite_number(p['settings'].get(field)) and 0<=p['settings'][field]<=1,'Invalid scoring settings')
    h.require(p['settings'].get('pickRateWeighted') is True,'Expected PR weights')
    expected={('matchup',r) for r in s.ROLES}|{('synergy',r) for r in s.ROLES if r!='MID'}
    rows=p.get('rows');h.require(isinstance(rows,list) and 2<=len(rows)<=p['referenceSize'],'Invalid cohort')
    ids=set();keys=set();out=[]
    for i,r in enumerate(rows):
        h.require(isinstance(r,dict) and isinstance(r.get('champion'),str) and r['champion'] not in ids,'Duplicate champion');ids.add(r['champion'])
        h.require(isinstance(r.get('name'),str) and h.key(r['name']) not in keys,'Duplicate name');keys.add(h.key(r['name']))
        h.require(type(r.get('baselineGames')) is int and r['baselineGames']>0,'Missing sample')
        h.require(r.get('matchupRoles')==5 and r.get('synergyRoles')==4,'Incomplete roles')
        h.require(len(r.get('blocks',[]))==9 and {(b['mode'],b['otherRole']) for b in r['blocks']}==expected,'Missing role blocks')
        for b in r['blocks']:
            h.require(s.number(b.get('sdPp')) and b['sdPp']>=0 and s.number(b.get('z')),'Invalid block score')
        for mode,count in [('matchup',5),('synergy',4)]:
            values=[b['z'] for b in r['blocks'] if b['mode']==mode]
            h.require(s.number(r.get(mode+'Mean')) and abs(sum(values)/count-r[mode+'Mean'])<1e-8,'Wrong axis aggregation')
        out.append({**r,'number':i+1,'_key':h.key(r['name']),
            'displayName':{'nasus':'内瑟斯'}.get(h.key(r['name']),h.display_name(r))})
    h.require(isinstance(p.get('models'),list) and len(p['models'])==9 and
        {(m['mode'],m['otherRole']) for m in p['models']}==expected,'Missing fitted models')
    for model in p['models']:
        fit=model.get('fit',{});grid=fit.get('gridPp',[]);objectives=fit.get('objective',[]);index=fit.get('selectedGridIndex')
        h.require(model.get('method')=='role-normal-normal-pair-shrinkage-v1','Unexpected pair estimator')
        h.require(len(grid)>=2 and len(objectives)==len(grid) and all(s.number(x) for x in grid+objectives),'Invalid fit trace')
        h.require(type(index) is int and 0<=index<len(grid) and fit.get('tauPp')==grid[index],'Invalid selected prior scale')
        h.require(abs(objectives[index]-min(objectives))<1e-8 and fit.get('atUpperGridBoundary') is False,'Unsupported fit boundary/objective')
    h.require(isinstance(p.get('limits'),list) and len(p['limits'])>=3,'Missing model limits')
    s.encoded(p)
    return out

def comparison(p,rows,left,title,old=False):
    right={r['_key']:r for r in rows};common=[r for r in rows if r['_key'] in left]
    h.require(len(common)==len(rows),'Comparison must retain every displayed hero')
    values=[r[k] for table in [left,right] for r in table.values() for k in ('matchupMean','synergyMean')]
    im=Image.new('RGB',(2600,1580),h.BACKGROUND);d=ImageDraw.Draw(im)
    d.text((45,25),'中单 Blindability：配对收缩首版对照',font=h.font(35,True),fill=h.INK)
    h.lines(d,(45,85),[
        '本次交互：16.21 All Ranks；固定原站79参考、16.16 Diamond PR；展示43英雄，完整5敌4友。',
        '每格按样本量收缩，再融合80%收缩+20%原始交互 → 位置SD → z → 位置均值；没有整行MoM重复去噪。'],2470,22)
    d.rectangle((35,168,2565,306),fill='#fff0d6')
    h.lines(d,(50,180),[
        '独立零均值Normal-Normal角色先验；参数只从本批原始配对估计，未拟合原站坐标，不是作者层级模型的精确复刻。',
        '样本量决定每格的收缩程度；最终坐标没有乘倍数、shift或重新归一化。未计算完整CI，点标记不是统计显著性。',
        ('旧版空心只标示整行去噪零边界；新版不使用该规则，实心仅为数据点。' if old else
         '原站使用历史D+交互，本次All Ranks16.21；版本、人群和上游模型仍不完全相同。')],2460,21,'#694400')
    colors={key:h.COLORS[i] for i,key in enumerate(h.HIGHLIGHT_ORDER)}
    for rect,table,label,isleft in [((125,385,1015,1275),left,title,True),((1215,385,2105,1275),right,'本次：配对收缩首版（α=0.8）',False)]:
        d.text(((rect[0]+rect[2])/2,338),label,font=h.font(25,True),fill=h.INK,anchor='mm')
        x,y=s.axes(im,rect,values)
        for r in common:
            v=table[r['_key']];complete=not v.get('boundaryBlocks') if old and isleft else True
            s.marker(d,x(v['matchupMean']),y(v['synergyMean']),{**r,'complete':complete},colors.get(r['_key'],'#a2b0bc'),r['_key'] in colors)
    d.text((2180,390),'同色同英雄（非排名）',font=h.font(23,True),fill=h.INK)
    for i,key in enumerate(h.HIGHLIGHT_ORDER):
        r=next((r for r in rows if r['_key']==key),None)
        if r:d.text((2180,440+i*52),f"{r['number']} {r['displayName']}",font=h.font(23),fill=colors[key])
    h.lines(d,(50,1425),[
        f"共同显示{len(common)}英雄；两边同一对称刻度。右/上表示相对更不挑对手/队友，不是绝对胜率或安全资格线。",
        '原始/收缩/融合矩阵、每格样本与权重、角色先验网格拟合轨迹均保留在本地研究数据。',
        '灰点没有删除；阿克尚等仍不吻合的例子同样保留。'],2460,21)
    return im

def render(source,prefix,reference,previous=None):
    p=h.load_json(h.checked_path(source,'.json'));rows=validate(p)
    ref=h.reference_rows(h.load_json(h.checked_path(reference,'.json')))
    old=None
    if previous:
        oldrows=vm.validate(h.load_json(h.checked_path(previous,'.json')));old={r['_key']:r for r in oldrows}
    paths={k:h.checked_path(str(prefix)+suffix,ext) for k,suffix,ext in
        [('primary','-primary.png','.png'),('comparison','-comparison.png','.png'),('csv','.csv','.csv')]}
    h.save_image(vm.single_image(p,rows),paths['primary'])
    h.save_image(comparison(p,rows,ref,'原站：历史交互／默认结果'),paths['comparison'])
    if old:
        paths['previous']=h.checked_path(str(prefix)+'-previous.png','.png')
        h.save_image(comparison(p,rows,old,'上一版：整行MoM方差去噪',True),paths['previous'])
    records=[{**{k:r[k] for k in ('number','champion','name','baselineGames','matchupMean','synergyMean','matchupRoles','synergyRoles')},
        'blocks_json':s.encoded(r['blocks']),'scope_json':s.encoded(p['scope']),'settings_json':s.encoded(p['settings']),
        'method':METHOD,'reference_size':p['referenceSize'],'units':'dimensionless reverse sample-z; full-role means',
        'limits_json':s.encoded(p['limits'])} for r in rows]
    s.csv_file(paths['csv'],records)
    return {**{k:str(v) for k,v in paths.items()},'cohort':len(rows),'reference':p['referenceSize']}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('input');parser.add_argument('prefix');parser.add_argument('--reference',required=True);parser.add_argument('--previous');a=parser.parse_args()
    try:print(json.dumps(render(a.input,a.prefix,a.reference,a.previous),ensure_ascii=False))
    except (h.RenderInputError,OSError,ValueError,KeyError,TypeError) as e:
        print(json.dumps({'status':'render_failed','category':type(e).__name__}));raise SystemExit(1)
