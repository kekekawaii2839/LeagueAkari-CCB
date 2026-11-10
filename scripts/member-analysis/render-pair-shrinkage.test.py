"""Synthetic-only renderer contract; no real data/network IO."""
import copy,importlib.util,unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('pair_renderer',Path(__file__).with_name('render-pair-shrinkage.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def fixture():
    positions=[('matchup',r) for r in m.s.ROLES]+[('synergy',r) for r in m.s.ROLES if r!='MID']
    return {'method':m.METHOD,'ownRole':'MID','scope':{'interactionPatch':'synthetic','playRatePatch':'synthetic','region':'synthetic'},'referenceSize':3,
        'settings':{'shrinkAlpha':.8,'pickRateFloor':.005,'pickRateWeighted':True},
        'limits':['Synthetic model','No full CI','Not source hierarchy'],
        'rows':[{'champion':str(i),'name':f'Synthetic{i}','baselineGames':1000,'matchupRoles':5,'synergyRoles':4,'matchupMean':float(i),'synergyMean':float(i),
                 'blocks':[{'mode':mode,'otherRole':r,'sdPp':1.,'z':float(i)} for mode,r in positions]} for i in range(3)],
        'models':[{'mode':mode,'otherRole':r,'method':'role-normal-normal-pair-shrinkage-v1',
                   'fit':{'gridPp':[0.,1.,2.],'objective':[3.,1.,2.],'selectedGridIndex':1,'tauPp':1.,'atUpperGridBoundary':False}} for mode,r in positions]}
class Contract(unittest.TestCase):
    def test_complete_zero_and_large_z_are_preserved(self):
        p=fixture();rows=m.validate(p);self.assertEqual(rows[0]['matchupMean'],0.);self.assertEqual(rows[-1]['matchupMean'],2.)
    def test_invalid_score_and_fit_inputs_fail(self):
        for mutate in [lambda p:p['rows'][0].update(matchupMean=float('nan')),lambda p:p['rows'][0].update(matchupMean=.1),
                       lambda p:p['rows'][0]['blocks'].pop(),lambda p:p['models'][0]['fit'].update(atUpperGridBoundary=True),
                       lambda p:p['models'][0]['fit'].update(selectedGridIndex=0,tauPp=0.)]:
            p=fixture();mutate(p)
            with self.assertRaises(m.h.RenderInputError):m.validate(p)
    def test_pair_primary_and_comparison_do_not_change_coordinates(self):
        p=fixture();rows=m.validate(p);before=copy.deepcopy(rows)
        self.assertEqual(m.vm.single_image(p,rows).size,(2460,1940))
        reference={r['_key']:r for r in rows};self.assertEqual(m.comparison(p,rows,reference,'SYNTHETIC').size,(2600,1580));self.assertEqual(rows,before)
    def test_comparison_rejects_dropping_unmatched_heroes(self):
        p=fixture();rows=m.validate(p)
        with self.assertRaises(m.h.RenderInputError):m.comparison(p,rows,{},'invalid')
    def test_io_cannot_escape_research_root(self):
        with self.assertRaises(m.h.RenderInputError):m.h.checked_path(Path.cwd()/'escape.json','.json')
if __name__=='__main__':unittest.main()
