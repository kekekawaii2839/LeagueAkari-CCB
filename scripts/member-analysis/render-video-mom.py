"""Offline video-MoM experiment renderer. All IO restricted to research userData."""
from __future__ import annotations
import argparse
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageDraw

spec=importlib.util.spec_from_file_location('source_helpers',Path(__file__).with_name('render-source-style-z.py'))
assert spec and spec.loader
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
h=s.h

def validate(payload):
    h.require(payload.get('method')=='video-mom-alignment-experiment-v1','Unexpected method')
    rows=payload.get('rows');h.require(isinstance(rows,list) and 2<=len(rows)<=200,'Invalid rows')
    expected={('matchup',r) for r in s.ROLES}|{('synergy',r) for r in s.ROLES if r!=payload['ownRole']}
    ids=set()
    for row in rows:
        h.require(row['champion'] not in ids,'Duplicate champion');ids.add(row['champion'])
        h.require(row['matchupRoles']==5 and row['synergyRoles']==4 and row['complete'] is True,'Incomplete roles')
        h.require(all(s.number(row.get(k)) for k in ('matchupMean','synergyMean')),'Nonfinite axis')
        h.require(len(row.get('blocks',[]))==9 and {(b['mode'],b['otherRole']) for b in row['blocks']}==expected,'Missing score blocks')
        for mode,count in [('matchup',5),('synergy',4)]:
            values=[b.get('z') for b in row['blocks'] if b['mode']==mode]
            h.require(len(values)==count and all(s.number(v) for v in values),'Incomplete score axis')
            h.require(abs(sum(values)/count-row[mode+'Mean'])<1e-8,'Axis not full-role mean')
        h.require(len(row['estimates'])==9 and {(b['mode'],b['otherRole']) for b in row['estimates']}==expected,'Missing blocks')
        boundaries=[]
        for b in row['estimates']:
            e=b['estimate'];v=e['signedCorrectedVariancePp2']
            h.require(all(s.number(e.get(k)) for k in ('observedVariancePp2','samplingVariancePp2','signedCorrectedVariancePp2')),'Missing variance')
            h.require(abs(v-e['observedVariancePp2']+e['samplingVariancePp2'])<1e-8,'Invalid decomposition')
            h.require(b['atBoundary']==(v<=0) and abs(b['sdPp']**2-max(0,v))<1e-8,'Invalid boundary point')
            if b['atBoundary']:boundaries.append(b['mode']+':'+b['otherRole'])
        h.require(sorted(boundaries)==sorted(row['boundaryBlocks']),'Boundary mismatch')
    h.require(len(payload.get('aggregateFirst',[]))==len(rows),'Missing aggregation sensitivity')
    h.require(len({r['champion'] for r in payload['aggregateFirst']})==len(rows),'Duplicate sensitivity champion')
    for row in payload['aggregateFirst']:
        h.require(row['champion'] in ids and all(s.number(row.get(k)) for k in ('matchupMean','synergyMean')),'Invalid sensitivity')
    s.encoded(payload)
    return [{**r,'number':i+1,'_key':h.key(r['name']),
        'displayName':{'nasus':'内瑟斯'}.get(h.key(r['name']),h.display_name(r))} for i,r in enumerate(rows)]

def validate_source_check(check,reference):
    h.require(isinstance(check.get('cases'),list) and bool(check['cases']),'Missing source audit')
    h.require(all(c.get('samePrecomputedInput') is True and s.number(c.get('maximumError')) and
        0<=c['maximumError']<=1e-5 and type(c.get('compared')) is int and c['compared']>0 for c in check['cases']),'Failed source comparison')
    primary=check.get('primary',{});ours=primary.get('rows',[]);remote=primary.get('reference',[])
    h.require(len(ours)==len(reference)==len(remote) and len({h.key(r['champion']) for r in ours})==len(ours),'Candidate mismatch')
    for rows,fields in [(ours,['matchupMean','synergyMean']),(remote,['matchup_mean','synergy_mean'])]:
        for r in rows:
            key=h.key(r['champion']);h.require(key in reference,'Unknown reference champion')
            for field,axis in zip(fields,['matchupMean','synergyMean']):
                h.require(s.number(r.get(field)) and abs(r[field]-reference[key][axis])<=1e-5,'Inconsistent source-check point')
    s.encoded(check)

def single_image(payload,rows):
    """All heroes have a numeric lookup; only label positions move, never data."""
    pair_mode=payload.get('method')=='pair-shrinkage-source-score-v1'
    height=max(1940,470+len(rows)*30+190)
    im=Image.new('RGB',(2460,height),h.BACKGROUND);d=ImageDraw.Draw(im)
    d.text((45,25),'中单 Blindability：配对收缩版（All Ranks）' if pair_mode else '中单 Blindability：All Ranks 数据重算',font=h.font(35,True),fill=h.INK)
    scope=payload['scope']
    h.lines(d,(45,85),[
        f"交互：{scope['interactionPatch']} All Ranks / {scope['region']} / 单双排；对照权重：{scope['playRatePatch']} Diamond PR。",
        f"固定{payload.get('referenceSize',len(payload.get('cohort',rows)))}个参考英雄；展示{len(rows)}个中单，均完整5敌4友。零轴为相对参照，不是安全选人资格线。"],2360,22)
    d.rectangle((35,167,2425,297),fill='#fff0d6')
    h.lines(d,(50,179),([
        '独立零均值Normal-Normal配对收缩；参数只由本批数据估计，不是已还原作者的层级模型。',
        '每格先收缩，再按80%收缩+20%原始交互融合后评分；不叠加整行MoM扣噪声，没有截零补分。',
        '实心只是数据点标记，不代表统计显著；未计算完整置信区间，没有按原站坐标拟合或重新拉伸分数。'] if pair_mode else [
        '视频式方差去噪 + 已核对的原站评分规则；原站的上游层级配对收缩尚未复刻，不宣称全流程完成。',
        '实心：九块均为正的修正方差点估计；空心：至少一块触及零边界。两者都不代表统计显著或已证明稳定。',
        '没有强制正反交互对称、没有按原站坐标拟合或重新拉伸分数；并排图另用同一刻度直接比较。']),2330,21,'#694400')
    values=[r[k] for r in rows for k in ('matchupMean','synergyMean')]
    rect=(125,370,1225,1470);x,y=s.axes(im,rect,values)
    for at,text,anchor in [((140,382),'较挑对手／较不挑队友','la'),((1210,382),'较不挑对手／较不挑队友','ra'),
        ((140,1435),'较挑对手／较挑队友','la'),((1210,1435),'较不挑对手／较挑队友','ra')]:
        d.text(at,text,font=h.font(18),fill=h.MUTED,anchor=anchor)
    occupied=[]
    for r in rows:
        px,py=x(r['matchupMean']),y(r['synergyMean']);flagged=bool(r.get('boundaryBlocks')) and not pair_mode;color=h.PURPLE if flagged else h.TEAL
        d.ellipse((px-5,py-5,px+5,py+5),fill='white' if flagged else color,outline=color,width=2)
        offsets=[(10,-18),(10,8),(-30,-18),(-30,8),(0,-35),(0,22),(28,-5),(-46,-5)]
        offsets += [(dx,dy) for dy in (-55,42,-75,62) for dx in (0,28,-30,56,-58)]
        for dx,dy in offsets:
            lx,ly=px+dx,py+dy;box=(lx-2,ly-1,lx+26,ly+22)
            if box[0]<rect[0]+4 or box[2]>rect[2]-4 or box[1]<rect[1]+35 or box[3]>rect[3]-35:continue
            if any(not(box[2]<a or box[0]>c or box[3]<b or box[1]>e) for a,b,c,e in occupied):continue
            break
        else:lx,ly=px+10,py-18;box=(lx-2,ly-1,lx+26,ly+22)
        occupied.append(box)
        d.line((px,py,lx+10,ly+10),fill='#9babb5',width=1)
        d.rectangle(box,fill=h.BACKGROUND)
        d.text((lx,ly),str(r['number']),font=h.font(18,True),fill=color)
    left=1310
    d.text((left,365),'编号／英雄／坐标（编号非排名）',font=h.font(25,True),fill=h.INK)
    columns=[(0,'编号'),(65,'英雄'),(365,'对手 z'),(550,'队友 z'),(745,'角色' if pair_mode else '边界块'),(895,'场次')]
    for dx,text in columns:d.text((left+dx,410),text,font=h.font(20,True),fill=h.MUTED)
    for i,r in enumerate(rows):
        at=450+i*30;color=h.PURPLE if r.get('boundaryBlocks') and not pair_mode else h.INK
        texts=[str(r['number']),h.fit_text(d,r['displayName'],h.font(20),285),f"{r['matchupMean']:+.3f}",
            f"{r['synergyMean']:+.3f}",'5/4' if pair_mode else str(len(r['boundaryBlocks'])),f"{r.get('baselineGames',0):,}"]
        for (dx,_),text in zip(columns,texts):d.text((left+dx,at),text,font=h.font(20),fill=color)
    h.lines(d,(50,max(1570,450+len(rows)*30+35)),[
        ('参数、收缩权重、原始/收缩矩阵及样本保留；这是独立首版，不宣称已经完整复刻作者上游。' if pair_mode else
         f"{sum(bool(r['boundaryBlocks']) for r in rows)}个英雄含边界块；保留signed修正方差和完整角色明细，不把边界0解释为完美稳定。"),
        '右/上＝对不同对手/队友的表现相对更稳定；不等于绝对胜率更高，也不等于配合能力的因果评价。',
        '本主图自动放大坐标视窗以便查点，没有改变数值；原站并排图使用双方共同的对称刻度。'],2360,21)
    return im

def pair_image(payload,rows,reference,alternative=False,source_check=None):
    im=Image.new('RGB',(2600,1580),h.BACKGROUND);d=ImageDraw.Draw(im)
    d.text((45,25),'同输入核验：原站程序 vs 我们的评分实现' if source_check else '对齐参考名单与PR后的独立去噪重算',font=h.font(35,True),fill=h.INK)
    scope=payload['scope']
    h.lines(d,(45,85),[('同一份作者预处理矩阵、16.16 Diamond PR、79中单参考、alpha=0.8；本图只验证评分器，不验证上游数据重建。' if source_check else
        f"MID | 交互 {scope['interactionPatch']} / {scope['population']} | PR {scope.get('playRatePatch')} | 参考{len(payload.get('cohort',rows))}、展示{len(rows)}"),
        '矩阵交互 → PR加权sample SD → 各位置反向z → 5敌/4友均值；不对最终坐标再标准化。' if source_check else
        '赔率校正 → PR加权方差 → 扣二项噪声方差 → 开方 → 原站式评分；无贝叶斯、无后验E[z]。'],2460,22)
    d.rectangle((35,168,2565,306),fill='#fff0d6')
    h.lines(d,(50,180),([
        '原站真实输入12配置核验通过；参考名单、原始/收缩矩阵融合、sample分母、逐块z和聚合均参与核验。',
        '两边使用同一份作者预处理数据，因此重合只证明计算器正确，不等于从原始胜率复刻去噪/层级收缩。',
        '原站使用预处理raw/shrunk矩阵；视频的MoM去噪与该离线矩阵生成过程尚未证明等价。'] if source_check else [
        '原站已确认：逐位置sample SD → z → 均值；参考名单/PR按原站对齐。未还原的是上游层级收缩。',
        '本图明确约定：非正方差暂取0作边界点估计，但保留原signed值；空心=至少一块触边，不代表已证实完全稳定。',
        '视频的负估计边界规则仍未公开；本图独立MoM不是作者alpha=.8的pair shrink，不声称全流程复刻完成。',
        f"参考群中 {sum(b['estimate']['weightedCoverage']!=1 for r in payload.get('referenceProfiles',[]) for b in r['blocks'])} 个角色块配对覆盖不全；逐块coverage保留在JSON。"]),2460,21,'#694400')
    if source_check:
        left=reference
        right={h.key(r['champion']):{**r,'complete':False} for r in source_check['primary']['rows']}
        titles=['原站程序：直接运行作者引擎','我们的评分实现：相同输入']
    elif alternative:
        left={r['_key']:r for r in rows}
        alt={str(r['champion']):r for r in payload['aggregateFirst']}
        right={r['_key']:{**alt[r['champion']],'complete':not any(alt[r['champion']][m]['atBoundary'] for m in ('matchup','synergy'))} for r in rows}
        titles=['逐位置SD → 各位置z → 完整5/4均值（网站式）','先平均signed方差 → 开方 → z（顺序敏感性）']
    else:
        left=reference
        right={r['_key']:{**r,'complete':not r['boundaryBlocks']} for r in rows}
        titles=['原站：16.16 PR／历史交互／默认结果','本次：视频去噪 + 网站式聚合（含边界约定）']
    common=[r for r in rows if r['_key'] in left and r['_key'] in right]
    values=[v[k] for table in (left,right) for v in table.values() for k in ('matchupMean','synergyMean')]
    colors={key:h.COLORS[i] for i,key in enumerate(h.HIGHLIGHT_ORDER)}
    for rect,table,title,is_left in [((125,385,1015,1275),left,titles[0],True),((1215,385,2105,1275),right,titles[1],False)]:
        d.text(((rect[0]+rect[2])/2,338),title,font=h.font(24,True),fill=h.INK,anchor='mm')
        x,y=s.axes(im,rect,values)
        for row in common:
            v=table[row['_key']]
            point={**row,'complete':False if source_check or (not alternative and is_left) else v.get('complete',not row['boundaryBlocks'])}
            color=colors.get(row['_key'],'#a2b0bc')
            s.marker(d,x(v['matchupMean']),y(v['synergyMean']),point,color,row['_key'] in colors)
    d.text((2180,390),'同色同英雄（非排名）',font=h.font(23,True),fill=h.INK)
    for i,key in enumerate(h.HIGHLIGHT_ORDER):
        row=next((r for r in common if r['_key']==key),None)
        if row:d.text((2180,440+i*52),f"{row['number']} {row['displayName']}",font=h.font(23),fill=colors[key])
    h.lines(d,(50,1425),[
        f"共同显示 {len(common)} 英雄；同一对称刻度，右/上表示相对更稳定。没有按原站坐标拟合。",
        ('12配置最大绝对误差约1.08e-6；本图标记只用于对应英雄，不编码统计确定性。' if source_check else
         f"本图方差口径：{payload['settings']['varianceConvention']}；噪声：{payload['settings']['noiseModel']}。"),
        '相同预处理输入的评分验证，与从原始胜率独立重建，是两种不同的验收。'],2460,21)
    return im

def render(source,prefix,reference,source_check=None,include_aggregation=True):
    payload=h.load_json(h.checked_path(source,'.json'));rows=validate(payload)
    ref=h.reference_rows(h.load_json(h.checked_path(reference,'.json')))
    paths={k:h.checked_path(str(prefix)+suffix,ext) for k,suffix,ext in [('primary','-primary.png','.png'),('comparison','-comparison.png','.png'),('aggregation','-aggregation.png','.png'),('csv','.csv','.csv')]}
    h.save_image(single_image(payload,rows),paths['primary'])
    h.save_image(pair_image(payload,rows,ref),paths['comparison'])
    if source_check:
        check=h.load_json(h.checked_path(source_check,'.json'))
        validate_source_check(check,ref)
        paths.pop('aggregation');paths['sameInput']=h.checked_path(str(prefix)+'-same-input.png','.png')
        h.save_image(pair_image(payload,rows,ref,source_check=check),paths['sameInput'])
    elif include_aggregation:h.save_image(pair_image(payload,rows,ref,True),paths['aggregation'])
    else:paths.pop('aggregation')
    records=[{**{k:r[k] for k in ('number','champion','name','baselineGames','matchupMean','synergyMean')},
        'boundary_blocks':s.encoded(r['boundaryBlocks']),'role_estimates':s.encoded(r['estimates']),
        'settings':s.encoded(payload['settings']),'evidence':s.encoded(payload['evidence']),
        'source_scope_json':s.encoded(payload['scope']),'method':payload['method'],
        'coordinate_units':'dimensionless reverse sample-z; full-role means',
        'reference_size':len(payload['cohort']),'display_size':len(rows)} for r in rows]
    s.csv_file(paths['csv'],records)
    return {**{k:str(v) for k,v in paths.items()},'cohort':len(rows),'boundaryRows':sum(bool(r['boundaryBlocks']) for r in rows)}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('input');p.add_argument('prefix');p.add_argument('--reference',required=True);p.add_argument('--source-check');p.add_argument('--no-aggregation',action='store_true');a=p.parse_args()
    try:print(json.dumps(render(a.input,a.prefix,a.reference,a.source_check,not a.no_aggregation),ensure_ascii=False))
    except (h.RenderInputError,OSError,ValueError,KeyError,TypeError) as e:
        print(json.dumps({'status':'render_failed','category':type(e).__name__}));raise SystemExit(1)
