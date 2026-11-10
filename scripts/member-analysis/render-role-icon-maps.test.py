"""Synthetic-only layout and figure contracts."""
import copy,importlib.util,io,unittest,xml.etree.ElementTree as ET
from pathlib import Path
from PIL import Image
spec=importlib.util.spec_from_file_location('icon_renderer',Path(__file__).with_name('render-role-icon-maps.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def fixture(role='MID'):
    positions=[('matchup',r) for r in m.ROLES]+[('synergy',r) for r in m.ROLES if r!=role]
    return {'method':'five-role-pair-shrinkage-v1','ownRole':role,'scope':{'population':'all','interactionPatch':'16.21','playRatePatch':'16.21','queueId':420},
        'referenceSize':10,'settings':{'shrinkAlpha':.8},'limits':['Synthetic only'],
        'rows':[{'champion':str(i+1),'name':f'Synthetic{i}','baselineGames':1000+i,'matchupRoles':5,'synergyRoles':4,'matchupMean':.01,'synergyMean':.01,
                 'blocks':[{'mode':mode,'otherRole':r,'z':.01,'sdPp':1.} for mode,r in positions]} for i in range(10)]}
class Contract(unittest.TestCase):
    def test_double_size_keeps_centres_axes_and_doubles_icon_extent(self):
        p=fixture();bounds,small=m.direct_layout(p['rows']);large_bounds,large=m.direct_layout(p['rows'],icon_size=96)
        self.assertEqual(bounds,large_bounds)
        for a,b in zip(small,large):
            self.assertEqual((a['ix'],a['iy']),(b['ix'],b['iy']))
            self.assertEqual(b['box'][2]-b['box'][0],2*(a['box'][2]-a['box'][0]))
        icons={r['champion']:Image.new('RGB',(128,128),'#ff0000') for r in p['rows']}
        panel=m.render_png(p,icons,large,bounds,white=True,icon_size=96)
        x,y=large[0]['ix'],large[0]['iy']
        self.assertEqual(panel.getpixel((round(x)+40,round(y))),(255,0,0))
    def test_direct_icons_are_centred_with_overlap_and_independent_padded_axes(self):
        rows=fixture()['rows'];rows[0]['matchupMean']=-3.2;rows[0]['synergyMean']=1.2
        before=copy.deepcopy(rows);bounds,positions=m.direct_layout(rows)
        self.assertEqual(rows,before);self.assertNotEqual(bounds[:2],bounds[2:])
        byid={r['champion']:r for r in rows}
        for q in positions:
            r=byid[q['champion']]
            self.assertEqual((q['ix'],q['iy']),m.coordinate(r['matchupMean'],r['synergyMean'],bounds))
            self.assertEqual((q['ix'],q['iy']),(q['px'],q['py']))
            self.assertGreater(q['box'][0],m.RECT[0]);self.assertLess(q['box'][2],m.RECT[2])
            self.assertGreater(q['box'][1],m.RECT[1]);self.assertLess(q['box'][3],m.RECT[3])
        self.assertEqual(positions[0]['box'],positions[1]['box'])
        icons={r['champion']:Image.new('RGB',(64,64),'#789abc') for r in rows}
        self.assertEqual(m.render_png(fixture(),icons,positions,bounds,white=True).size,(1900,1900))
    def test_all_roles_and_zero_are_valid(self):
        for role in m.ROLES:self.assertEqual(len(m.validate(fixture(role))),10)
    def test_overlap_dodging_keeps_all_actual_points_and_avoids_hidden_icons(self):
        p=fixture();rows=m.validate(p);before=copy.deepcopy(rows);layout=m.layout(rows,4)
        self.assertEqual(len(layout),10);self.assertEqual(rows,before)
        for q in layout:self.assertEqual((q['px'],q['py']),m.coordinate(.01,.01,4))
        for i,a in enumerate(layout):
            for b in layout[i+1:]:
                x0,y0,x1,y1=a['box'];u0,v0,u1,v1=b['box']
                self.assertTrue(x1+m.GAP<=u0 or x0-m.GAP>=u1 or y1+m.GAP<=v0 or y0-m.GAP>=v1)
    def test_png_and_svg_use_icons_not_numeric_hero_labels(self):
        p=fixture();p['rows'][0]['name']='<script>unsafe</script>';rows=m.validate(p);layout=m.layout(rows,4)
        icons={r['champion']:Image.new('RGB',(64,64),'#789abc') for r in rows};raw={}
        for key,img in icons.items():
            buffer=io.BytesIO();img.save(buffer,format='PNG');raw[key]=buffer.getvalue()
        self.assertEqual(m.render_png(p,icons,layout,4).size,(1900,1900))
        svg=m.render_svg(p,raw,layout,4);tree=ET.fromstring(svg)
        self.assertEqual(len(tree.findall('.//{http://www.w3.org/2000/svg}image')),10)
        self.assertNotIn('<script>',svg);self.assertIn('&lt;script&gt;',svg)
        visible=' '.join(t.text or '' for t in tree.findall('.//{http://www.w3.org/2000/svg}text'))
        self.assertNotIn('Synthetic',visible);self.assertNotIn('收缩',visible)
    def test_common_axis_bounds_never_clip_outliers(self):
        p=fixture();p['rows'][0]['matchupMean']=3.54
        self.assertEqual(m.shared_limit([p]),4)
        with self.assertRaises(m.h.RenderInputError):m.layout(p['rows'],3)
    def test_mixed_scopes_partial_and_nonfinite_are_rejected(self):
        for mutate in [lambda p:p['scope'].update(population='diamond_plus'),lambda p:p['scope'].update(playRatePatch='16.16'),
                       lambda p:p['rows'][0].update(matchupMean=float('nan')),lambda p:p['rows'][0]['blocks'].pop()]:
            p=fixture();mutate(p)
            with self.assertRaises(m.h.RenderInputError):m.validate(p)
    def test_io_is_restricted_to_research_userdata(self):
        with self.assertRaises(m.h.RenderInputError):m.h.checked_path(Path.cwd()/'escape.png','.png')
    def test_white_panel_and_combination_keep_data_and_all_five_panels(self):
        p=fixture();rows=m.validate(p);positions=m.layout(rows,4);before=copy.deepcopy(positions)
        icons={r['champion']:Image.new('RGB',(64,64),'#789abc') for r in rows}
        panel=m.render_png(p,icons,positions,4,white=True,role_title_only=True)
        self.assertEqual(panel.getpixel((0,0)),(255,255,255));self.assertEqual(positions,before)
        panels=[Image.new('RGB',(m.SIZE,m.SIZE),(i*40,20,30)) for i in range(5)]
        combined=m.compose_white_panels(panels,'16.21');self.assertEqual(combined.size,(5820,3980))
        for i,(x,y) in enumerate([(0,120),(1960,120),(3920,120),(980,2080),(2940,2080)]):
            self.assertEqual(combined.getpixel((x+500,y+500)),(i*40,20,30))
if __name__=='__main__':unittest.main()
