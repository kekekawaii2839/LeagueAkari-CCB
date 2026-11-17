import { useChampionNameMatch } from '@renderer-shared/composables/useChampionNameMatch'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useExtraAssetsStore } from '@renderer-shared/shards/extra-assets/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { computed } from 'vue'

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')

/** Canonical dataset names stay stable while search follows current resource keywords. */
export function useMemberAnalysisChampionMatch() {
  const { match } = useChampionNameMatch()
  const resources = useAkariResourceProvider()
  const league = useLeagueClientStore()
  const extra = useExtraAssetsStore()
  const ids = computed(() => {
    const index = new Map<string, number>()
    for (const hero of Object.values(extra.heroListMap))
      for (const name of [hero.alias, hero.name, hero.title])
        if (name) index.set(normalize(name), Number(hero.heroId))
    for (const [key, hero] of Object.entries(league.gameData.champions))
      for (const name of [hero.alias, hero.name]) if (name) index.set(normalize(name), Number(key))
    return index
  })
  return {
    matchChampion(pattern: string, canonical: string, label = canonical) {
      const id = ids.value.get(normalize(canonical))
      return (
        match(pattern, label, id) ||
        (id !== undefined && match(pattern, resources.champions.name(id), id)) ||
        match(pattern, canonical) ||
        (normalize(pattern).length > 0 && normalize(canonical).includes(normalize(pattern)))
      )
    }
  }
}
