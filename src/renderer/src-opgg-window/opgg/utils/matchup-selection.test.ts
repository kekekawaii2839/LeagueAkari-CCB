import type { ChampSelectSession, ChampSelectTeam } from '@shared/types/league-client/champ-select'
import { describe, expect, it } from 'vitest'

import { getVisibleEnemyChampionIds } from './matchup-selection'

function enemy(championId: number) {
  return { championId } as ChampSelectTeam
}

describe('matchup selection', () => {
  it('returns only unique enemy champions currently revealed by champion select', () => {
    const session = {
      theirTeam: [enemy(24), enemy(0), enemy(157), enemy(24), enemy(-1)]
    } as ChampSelectSession

    expect(getVisibleEnemyChampionIds(session)).toEqual([24, 157])
  })

  it('returns an empty list outside champion select', () => {
    expect(getVisibleEnemyChampionIds(null)).toEqual([])
  })
})
