"""Synthetic-only renderer contract tests; no data/network/credential IO."""
import copy
import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('video_renderer',Path(__file__).with_name('render-video-mom.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def fixture():
    pairs=[('matchup',r) for r in m.s.ROLES]+[('synergy',r) for r in m.s.ROLES if r!='MID']
    return {'method':'video-mom-alignment-experiment-v1','ownRole':'MID','rows':[
        {'champion':str(i),'name':f'Synthetic{i}','complete':True,'matchupRoles':5,'synergyRoles':4,
         'matchupMean':float(i),'synergyMean':float(i),'boundaryBlocks':[],
         'blocks':[{'mode':mode,'otherRole':role,'z':float(i),'sdPp':1.} for mode,role in pairs],
         'estimates':[{'mode':mode,'otherRole':role,'atBoundary':False,'sdPp':1.,'estimate':{
             'observedVariancePp2':2.,'samplingVariancePp2':1.,'signedCorrectedVariancePp2':1.}} for mode,role in pairs]}
        for i in range(2)],'aggregateFirst':[{'champion':str(i),'matchupMean':float(i),'synergyMean':float(i)} for i in range(2)]}

class Contract(unittest.TestCase):
    def test_zero_coordinate_preserved(self):
        self.assertEqual(m.validate(fixture())[0]['matchupMean'],0.)
    def test_nonpositive_boundary_preserves_signed_value(self):
        p=fixture();b=p['rows'][0]['estimates'][0];b.update(atBoundary=True,sdPp=0.)
        b['estimate'].update(observedVariancePp2=.5,signedCorrectedVariancePp2=-.5)
        p['rows'][0]['boundaryBlocks']=['matchup:TOP']
        self.assertEqual(m.validate(p)[0]['estimates'][0]['estimate']['signedCorrectedVariancePp2'],-.5)
    def test_invalid_contracts_rejected(self):
        for mutate in [lambda p:p['rows'][0].update(matchupMean=float('nan')),
                       lambda p:p['rows'][0].update(matchupMean=1.),
                       lambda p:p['rows'][0]['estimates'].pop(),
                       lambda p:p['rows'][0]['estimates'][0].update(atBoundary=True),
                       lambda p:p['rows'][0]['estimates'][0]['estimate'].update(signedCorrectedVariancePp2=2.),
                       lambda p:p['aggregateFirst'][1].update(champion='0')]:
            p=copy.deepcopy(fixture());mutate(p)
            with self.assertRaises(m.h.RenderInputError):m.validate(p)
    def test_export_path_cannot_escape_research_root(self):
        with self.assertRaises(m.h.RenderInputError):m.h.checked_path(Path.cwd()/'not-user-data.png','.png')
    def test_same_input_panel_cannot_claim_success_with_inconsistent_points(self):
        ref={'a':{'matchupMean':0.,'synergyMean':1.}}
        check={'cases':[{'samePrecomputedInput':True,'maximumError':0.,'compared':2}],
            'primary':{'rows':[{'champion':'A','matchupMean':0.,'synergyMean':1.}],
                'reference':[{'champion':'A','matchup_mean':0.,'synergy_mean':1.}]}}
        m.validate_source_check(check,ref)
        for mutate in [lambda c:c['primary']['rows'][0].update(synergyMean=2.),
                       lambda c:c['cases'][0].update(maximumError=float('nan')),
                       lambda c:c['cases'][0].update(samePrecomputedInput=False)]:
            c=copy.deepcopy(check);mutate(c)
            with self.assertRaises(m.h.RenderInputError):m.validate_source_check(c,ref)
    def test_primary_image_uses_all_lookup_rows_without_mutating_coordinates(self):
        p=fixture();p.update(scope={'interactionPatch':'synthetic','playRatePatch':'synthetic','region':'synthetic'},
            cohort=[{'champion':'0'},{'champion':'1'}])
        rows=m.validate(p);before=copy.deepcopy(rows)
        image=m.single_image(p,rows)
        self.assertEqual(image.size,(2460,1940));self.assertEqual(rows,before)

if __name__=='__main__':unittest.main()
