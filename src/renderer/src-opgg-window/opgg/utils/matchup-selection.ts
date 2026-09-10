import type { ChampSelectSession } from '@shared/types/league-client/champ-select'

export function getVisibleEnemyChampionIds(session: ChampSelectSession | null) {
  const ids = session?.theirTeam
    .map((player) => player.championId)
    .filter((championId) => championId > 0)
  return [...new Set(ids ?? [])]
}
