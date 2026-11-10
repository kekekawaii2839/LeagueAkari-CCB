"""Minimal five-role icon figures. IO is allowlisted to research userData."""
from __future__ import annotations
import argparse,base64,copy,hashlib,html,importlib.util,io,json,math
from pathlib import Path
from PIL import Image,ImageDraw

spec=importlib.util.spec_from_file_location('figure_helpers',Path(__file__).with_name('render-source-style-z.py'))
assert spec and spec.loader
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
h=s.h
ROLES=['TOP','JUNGLE','MID','ADC','SUP']
LABELS={'TOP':'上单','JUNGLE':'打野','MID':'中单','ADC':'下路','SUP':'辅助'}
SIZE=1900;RECT=(150,130,1800,1780);ICON=48;GAP=4
BG='#101820';INK='#dce6e8';GRID='#34464d';ZERO='#8ba3a7'

def validate(p):
    h.require(p.get('method')=='five-role-pair-shrinkage-v1' and p.get('ownRole') in ROLES,'Invalid method/role')
    scope=p.get('scope',{})
    h.require(scope.get('population')=='all' and scope.get('interactionPatch')==scope.get('playRatePatch'),'Mismatched chart rank/patch')
    h.require(isinstance(scope.get('interactionPatch'),str) and scope.get('queueId')==420,'Invalid scope')
    rows=p.get('rows');h.require(isinstance(rows,list) and 2<=len(rows)<=200,'Invalid plotted cohort')
    h.require(type(p.get('referenceSize')) is int and len(rows)<=p['referenceSize']<=300,'Invalid reference count')
    expected={('matchup',r) for r in ROLES}|{('synergy',r) for r in ROLES if r!=p['ownRole']}
    seen=set()
    for row in rows:
        h.require(isinstance(row.get('champion'),str) and row['champion'].isdigit() and row['champion'] not in seen,'Invalid hero ID');seen.add(row['champion'])
        h.require(isinstance(row.get('name'),str) and type(row.get('baselineGames')) is int and row['baselineGames']>0,'Invalid identity/sample')
        h.require(row.get('matchupRoles')==5 and row.get('synergyRoles')==4,'Incomplete roles')
        h.require(len(row.get('blocks',[]))==9 and {(b['mode'],b['otherRole']) for b in row['blocks']}==expected,'Invalid blocks')
        for mode,n in [('matchup',5),('synergy',4)]:
            values=[b.get('z') for b in row['blocks'] if b['mode']==mode]
            h.require(len(values)==n and all(s.number(v) for v in values) and s.number(row.get(mode+'Mean')),'Nonfinite scores')
            h.require(abs(sum(values)/n-row[mode+'Mean'])<1e-8,'Wrong aggregation')
    s.encoded(p)
    return copy.deepcopy(rows)

def shared_limit(payloads):
    values=[abs(r[k]) for p in payloads for r in p['rows'] for k in ('matchupMean','synergyMean')]
    return max(3,math.ceil(max(values)*1.08))

def coordinate(x,y,limit):
    l,t,r,b=RECT
    xmin,xmax,ymin,ymax=axis_bounds(limit)
    return l+(x-xmin)/(xmax-xmin)*(r-l),t+(ymax-y)/(ymax-ymin)*(b-t)

def axis_bounds(limit):
    return (-limit,limit,-limit,limit) if isinstance(limit,(int,float)) else limit

def direct_layout(rows,icon_size=ICON):
    """Independent padded axes; icon centres are exact, overlapping data points."""
    bounds=[]
    for key in ('matchupMean','synergyMean'):
        values=[r[key] for r in rows]+[0.]
        lo,hi=min(values),max(values);pad=max(.15,(hi-lo)*.08)
        bounds.extend([math.floor((lo-pad)*2)/2,math.ceil((hi+pad)*2)/2])
    out=[]
    for row in sorted(rows,key=lambda r:(-r['baselineGames'],int(r['champion']))):
        px,py=coordinate(row['matchupMean'],row['synergyMean'],bounds)
        out.append({**row,'px':px,'py':py,'ix':px,'iy':py,
                    'box':(px-icon_size/2,py-icon_size/2,px+icon_size/2,py+icon_size/2)})
    return bounds,out

def layout(rows,limit):
    """Icons may dodge overlaps; dot/leader anchors remain exact data positions."""
    h.require(limit>0 and all(abs(r[k])<=limit for r in rows for k in ('matchupMean','synergyMean')),'Clipped plot')
    l,t,r,b=RECT;zx,zy=coordinate(0,0,limit);occupied=[];out=[]
    order=sorted(rows,key=lambda row:(-row['baselineGames'],int(row['champion'])))
    offsets=[(0.,0.)]+[(radius*math.cos(k*math.pi/12),radius*math.sin(k*math.pi/12)) for radius in range(12,601,12) for k in range(24)]
    for row in order:
        px,py=coordinate(row['matchupMean'],row['synergyMean'],limit)
        for dx,dy in offsets:
            ix,iy=px+dx,py+dy;half=ICON/2;box=(ix-half,iy-half,ix+half,iy+half)
            if box[0]<l+4 or box[1]<t+4 or box[2]>r-4 or box[3]>b-4:continue
            if (ix-zx)*(px-zx)<-1e-8 or (iy-zy)*(py-zy)<-1e-8:continue
            if any(not(box[2]+GAP<=x0 or box[0]-GAP>=x1 or box[3]+GAP<=y0 or box[1]-GAP>=y1) for x0,y0,x1,y1 in occupied):continue
            break
        else:raise h.RenderInputError('Could not place every icon without hiding a hero')
        occupied.append(box);out.append({'champion':row['champion'],'name':row['name'],'px':px,'py':py,'ix':ix,'iy':iy,'box':box,
            'matchupMean':row['matchupMean'],'synergyMean':row['synergyMean'],'baselineGames':row['baselineGames']})
    return out

def gradient():
    image=Image.new('RGB',(128,128));pixels=image.load();a=(61,32,40);mid=(27,36,43);b=(25,72,62)
    for y in range(128):
        for x in range(128):
            z=(x/127+1-y/127)/2
            c,d,v=(a,mid,z*2) if z<=.5 else (mid,b,(z-.5)*2)
            pixels[x,y]=tuple(round(c[i]+(d[i]-c[i])*v) for i in range(3))
    return image.resize((RECT[2]-RECT[0],RECT[3]-RECT[1]),Image.Resampling.BILINEAR)

def render_png(p,icons,positions,limit,white=False,role_title_only=False,icon_size=ICON):
    bg,ink,grid,zero=('#ffffff','#27313b','#e7ebef','#98a3ad') if white else (BG,INK,GRID,ZERO)
    im=Image.new('RGB',(SIZE,SIZE),bg)
    if not white:im.paste(gradient(),RECT[:2])
    d=ImageDraw.Draw(im)
    title=LABELS[p['ownRole']] if role_title_only else f"{LABELS[p['ownRole']]}  ·  Patch {p['scope']['interactionPatch']}  ·  All Ranks"
    d.text((SIZE/2,38),title,font=h.font(34,True),fill=ink,anchor='mt')
    l,t,r,b=RECT
    bounds=axis_bounds(limit)
    for axis,(low,high) in enumerate((bounds[:2],bounds[2:])):
        step=.5 if high-low<=5 else 1
        for k in range(math.ceil(low/step),math.floor(high/step)+1):
            v=k*step;px,py=coordinate(v,v,limit);color=zero if v==0 else grid;width=2 if v==0 else 1
            if axis==0:
                d.line((px,t,px,b),fill=color,width=width)
                d.text((px,b+15),f'{v:g}',font=h.font(24),fill=ink,anchor='mt')
            else:
                d.line((l,py,r,py),fill=color,width=width)
                d.text((l-18,py),f'{v:g}',font=h.font(24),fill=ink,anchor='rm')
    d.rectangle(RECT,outline=grid if white else zero,width=2)
    d.text(((l+r)/2,SIZE-42),'对手稳定性（z）',font=h.font(29),fill=ink,anchor='mm')
    label=Image.new('RGBA',(550,55));ld=ImageDraw.Draw(label);ld.text((275,27),'队友稳定性（z）',font=h.font(29),fill=ink,anchor='mm');label=label.rotate(90,expand=True);im.paste(label,(28,round((t+b-label.height)/2)),label)
    for q in positions:
        if math.hypot(q['ix']-q['px'],q['iy']-q['py'])>2:
            d.line((q['px'],q['py'],q['ix'],q['iy']),fill='#aab4bd' if white else '#8ea8a9',width=1)
            d.ellipse((q['px']-3,q['py']-3,q['px']+3,q['py']+3),fill='#5c6b78' if white else '#dce6e8')
    mask=Image.new('L',(icon_size,icon_size));ImageDraw.Draw(mask).rounded_rectangle((0,0,icon_size-1,icon_size-1),radius=4,fill=255)
    for q in positions:
        h.require(q['champion'] in icons,'Missing hero icon')
        icon=icons[q['champion']].convert('RGB').resize((icon_size,icon_size),Image.Resampling.LANCZOS)
        at=(round(q['ix']-icon_size/2),round(q['iy']-icon_size/2));im.paste(icon,at,mask)
        d.rounded_rectangle((at[0],at[1],at[0]+icon_size-1,at[1]+icon_size-1),radius=4,outline='#798795' if white else '#d1dedc',width=1)
    return im

def compose_white_panels(panels,patch):
    h.require(len(panels)==5 and all(im.size==(SIZE,SIZE) for im in panels),'Expected five full-size panels')
    gap=60;header=120;width=3*SIZE+2*gap;height=header+2*SIZE+gap
    image=Image.new('RGB',(width,height),'white');draw=ImageDraw.Draw(image)
    draw.text((width/2,25),f'Patch {patch}  ·  All Ranks',font=h.font(46,True),fill='#27313b',anchor='mt')
    positions=[(i*(SIZE+gap),header) for i in range(3)]
    left=(width-(2*SIZE+gap))//2
    positions.extend([(left,header+SIZE+gap),(left+SIZE+gap,header+SIZE+gap)])
    for panel,at in zip(panels,positions):image.paste(panel,at)
    return image

def render_white_combined(manifest_path):
    manifest_path=h.checked_path(manifest_path,'.json');root=manifest_path.parent;manifest=h.load_json(manifest_path)
    h.require([p['role'] for p in manifest['plots']]==ROLES,'Expected five role order')
    payloads=[h.load_json(h.checked_path(root/p['input'],'.json')) for p in manifest['plots']]
    for p in payloads:validate(p)
    h.require(len({p['scope']['interactionPatch'] for p in payloads})==1,'Mixed patch')
    assets=h.load_json(h.checked_path(root/'icon-manifest.json','.json'));icons={}
    required={r['champion'] for p in payloads for r in p['rows']}
    for a in assets:
        if str(a['id']) not in required:continue
        f=h.checked_path(a['file'],'.png');data=f.read_bytes()
        h.require(a['status']=='ready' and hashlib.sha256(data).hexdigest()==a['sha256'],'Invalid icon asset')
        with Image.open(io.BytesIO(data)) as im:im.load();icons[str(a['id'])]=im.copy()
    h.require(set(icons)==required,'Missing icons')
    panels=[];layouts={}
    for p in payloads:
        limit,positions=direct_layout(p['rows'],icon_size=96)
        layouts[p['ownRole']]={'bounds':limit,'iconSize':96,'icons':positions}
        panels.append(render_png(p,icons,positions,limit,white=True,role_title_only=True,icon_size=96))
    image=compose_white_panels(panels,payloads[0]['scope']['interactionPatch'])
    path=h.checked_path(root/'five-roles-white-direct-large.png','.png');h.save_image(image,path)
    h.atomic_bytes(h.checked_path(root/'five-roles-white-direct-large-layout.json','.json'),s.encoded(layouts).encode('utf8'))
    return {'combined':str(path),'size':list(image.size),'roles':ROLES,'bounds':{r:v['bounds'] for r,v in layouts.items()}}

def render_svg(p,icon_bytes,positions,limit):
    esc=lambda x:html.escape(str(x),quote=True);l,t,r,b=RECT
    title=f"{LABELS[p['ownRole']]} · Patch {p['scope']['interactionPatch']} · All Ranks"
    parts=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{SIZE}" height="{SIZE}" viewBox="0 0 {SIZE} {SIZE}">',
        '<defs><linearGradient id="bg" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#3d2028"/><stop offset=".5" stop-color="#1b242b"/><stop offset="1" stop-color="#19483e"/></linearGradient></defs>',
        f'<metadata>{esc(json.dumps({"scope":p["scope"],"settings":p["settings"],"limits":p["limits"]},ensure_ascii=False))}</metadata>',
        f'<rect width="{SIZE}" height="{SIZE}" fill="{BG}"/><rect x="{l}" y="{t}" width="{r-l}" height="{b-t}" fill="url(#bg)"/>',
        '<g font-family="Microsoft YaHei,Noto Sans CJK SC,sans-serif" fill="#dce6e8">',f'<text x="950" y="70" text-anchor="middle" font-size="34" font-weight="bold">{esc(title)}</text>']
    for v in range(-limit,limit+1):
        px,py=coordinate(v,v,limit);color=ZERO if v==0 else GRID;stroke=2 if v==0 else 1
        parts.extend([f'<path d="M{px} {t}V{b} M{l} {py}H{r}" stroke="{color}" stroke-width="{stroke}"/>',
            f'<text x="{px}" y="{b+42}" text-anchor="middle" font-size="24">{v}</text>',f'<text x="{l-18}" y="{py+8}" text-anchor="end" font-size="24">{v}</text>'])
    parts.extend([f'<rect x="{l}" y="{t}" width="{r-l}" height="{b-t}" fill="none" stroke="{ZERO}"/>',
        '<text x="975" y="1868" text-anchor="middle" font-size="29">对手稳定性（z）</text>',
        '<text transform="translate(65 955) rotate(-90)" text-anchor="middle" font-size="29">队友稳定性（z）</text>'])
    for q in positions:
        if math.hypot(q['ix']-q['px'],q['iy']-q['py'])>2:
            parts.append(f'<path d="M{q["px"]} {q["py"]}L{q["ix"]} {q["iy"]}" stroke="#8ea8a9" stroke-width="1"/><circle cx="{q["px"]}" cy="{q["py"]}" r="3" fill="#dce6e8"/>')
    for q in positions:
        data=base64.b64encode(icon_bytes[q['champion']]).decode('ascii');title=f"{q['name']} | x={q['matchupMean']:.4f}, y={q['synergyMean']:.4f} | N={q['baselineGames']}"
        parts.append(f'<g><title>{esc(title)}</title><image x="{q["ix"]-ICON/2}" y="{q["iy"]-ICON/2}" width="{ICON}" height="{ICON}" href="data:image/png;base64,{data}"/><rect x="{q["ix"]-ICON/2}" y="{q["iy"]-ICON/2}" width="{ICON}" height="{ICON}" rx="4" fill="none" stroke="#d1dedc"/></g>')
    return ''.join(parts)+ '</g></svg>'

def render(manifest_path):
    manifest_path=h.checked_path(manifest_path,'.json');root=manifest_path.parent;manifest=h.load_json(manifest_path)
    h.require([p['role'] for p in manifest['plots']]==ROLES,'Expected all five roles in order')
    payloads=[h.load_json(h.checked_path(root/p['input'],'.json')) for p in manifest['plots']]
    for p in payloads:validate(p)
    h.require(len({p['scope']['interactionPatch'] for p in payloads})==1,'Mixed figure patch')
    limit=shared_limit(payloads);assets=h.load_json(h.checked_path(root/'icon-manifest.json','.json'));icons={};raw={}
    required={r['champion'] for p in payloads for r in p['rows']}
    for a in assets:
        if str(a['id']) not in required:continue
        h.require(a['status']=='ready' and str(a['id']) not in icons,'Missing/duplicate icon asset');f=h.checked_path(a['file'],'.png');data=f.read_bytes()
        h.require(hashlib.sha256(data).hexdigest()==a.get('sha256'),'Icon integrity mismatch')
        with Image.open(io.BytesIO(data)) as im:
            h.require(im.format=='PNG' and min(im.size)>=32 and max(im.size)<=512,'Invalid icon raster');im.load();icons[str(a['id'])]=im.copy()
        raw[str(a['id'])]=data
    h.require(set(icons)==required,'Unresolved hero icons')
    outputs=[]
    for p in payloads:
        role=p['ownRole'];rows=validate(p);positions=layout(rows,limit)
        png=h.checked_path(root/f'{role}.png','.png');svg=h.checked_path(root/f'{role}.svg','.svg');csv=h.checked_path(root/f'{role}.csv','.csv')
        h.save_image(render_png(p,icons,positions,limit),png);h.atomic_bytes(svg,render_svg(p,raw,positions,limit).encode('utf8'))
        records=[{'champion':r['champion'],'name':r['name'],'x':r['matchupMean'],'y':r['synergyMean'],'sample':r['baselineGames'],
            'scope_json':s.encoded(p['scope']),'settings_json':s.encoded(p['settings']),'limits_json':s.encoded(p['limits']),'units':'dimensionless reverse sample-z; full-role means'} for r in rows]
        s.csv_file(csv,records)
        h.atomic_bytes(h.checked_path(root/f'{role}-icon-layout.json','.json'),s.encoded({'limit':limit,'dataPointsNotMoved':True,'icons':positions}).encode('utf8'))
        outputs.append({'role':role,'heroes':len(rows),'png':str(png),'svg':str(svg),'csv':str(csv)})
    return {'limit':limit,'plots':outputs}

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('manifest');parser.add_argument('--white-combined',action='store_true');a=parser.parse_args()
    try:print(json.dumps(render_white_combined(a.manifest) if a.white_combined else render(a.manifest),ensure_ascii=False))
    except (h.RenderInputError,OSError,ValueError,KeyError,TypeError) as e:
        print(json.dumps({'status':'render_failed','category':type(e).__name__}));raise SystemExit(1)
