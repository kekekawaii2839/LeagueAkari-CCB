import type { MemberAnalysisGame } from '@shared/shards/member-analysis'

import type { PairAggregate, SynergyAggregate } from './analytics'

export type CombinationMembers = readonly [string, string]
export type RolePairLocation = Pick<PairAggregate, 'pairType' | 'pair'>
export type RolePairLink = RolePairLocation & { members: CombinationMembers }

const rolePairs = {
  upper_pair: ['TOP', 'JUNGLE'],
  mid_jg_pair: ['MIDDLE', 'JUNGLE'],
  bot_pair: ['BOTTOM', 'UTILITY']
} as const

// The legacy aggregate carries a display string, not two identities. Recover
// identities from its actual population; never split a name or strip a tag.
// Ambiguous legacy labels must not navigate to a possibly different member.
export function rolePairMembers(
  games: readonly MemberAnalysisGame[],
  location: RolePairLocation
): CombinationMembers | null {
  const [firstRole, secondRole] = rolePairs[location.pairType]
  let found: CombinationMembers | null = null
  for (const game of games) {
    const first = game.players.find((player) => player.role === firstRole)
    const second = game.players.find((player) => player.role === secondRole)
    if (!first || !second || `${first.player} + ${second.player}` !== location.pair) continue
    if (first.player === second.player) return null
    const members = [first.player, second.player] as const
    if (found && (found[0] !== members[0] || found[1] !== members[1])) return null
    found = members
  }
  return found
}

export function sameCombinationMembers(a: CombinationMembers, b: CombinationMembers): boolean {
  return (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0])
}

// The role aggregate's exact ordered population, not every shared match of
// these identities. Refuse ambiguous legacy labels instead of naming heroes
// for a possibly different pair. No metric/baseline is recalculated here.
export function rolePairEvidence(games: readonly MemberAnalysisGame[], location: RolePairLocation) {
  const members = rolePairMembers(games, location)
  if (!members) return null
  const [firstRole, secondRole] = rolePairs[location.pairType]
  return {
    members,
    gamesList: games.filter(
      (game) =>
        game.players.find((player) => player.role === firstRole)?.player === members[0] &&
        game.players.find((player) => player.role === secondRole)?.player === members[1]
    )
  }
}

export function relatedRolePairs(
  rows: readonly PairAggregate[],
  games: readonly MemberAnalysisGame[],
  members: CombinationMembers
): RolePairLink[] {
  return rows.flatMap((row) => {
    if (row.sideLabel !== '总计') return []
    const identities = rolePairMembers(games, row)
    return identities && sameCombinationMembers(identities, members)
      ? [{ pairType: row.pairType, pair: row.pair, members: identities }]
      : []
  })
}

export function relatedSynergy(
  rows: readonly SynergyAggregate[],
  members: CombinationMembers
): SynergyAggregate | undefined {
  return rows.find((row) => sameCombinationMembers([row.playerA, row.playerB], members))
}
