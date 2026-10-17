import type { MemberAnalysisOverview } from '@shared/shards/member-analysis'

/** Most recent valid cached match icon, not the player's current client profile.
 * Display labels are never identity keys: collisions or unproved rows fail closed. */
export function resolveMemberProfileIcons(
  overview: MemberAnalysisOverview | null
): Record<string, number | null> {
  const result: Record<string, number | null> = Object.create(null)
  const labels = new Map<string, Set<string>>()
  const latest = new Map<string, { time: number; gameId: number; icon: number }>()
  if (!overview?.publicationToken) return result
  for (const game of overview.games)
    for (const player of game.players) {
      result[player.player] = null
      let identities = labels.get(player.player)
      if (!identities) labels.set(player.player, (identities = new Set()))
      // An unproved older row could be another identity with the same label.
      identities.add(player.profileIdentity ?? 'unproved')
      const icon = player.profileIconId
      if (!player.profileIdentity || !Number.isSafeInteger(icon) || icon! < 0) continue
      const previous = latest.get(player.profileIdentity)
      if (
        !previous ||
        game.timestamp > previous.time ||
        (game.timestamp === previous.time && game.gameId > previous.gameId)
      )
        latest.set(player.profileIdentity, {
          time: game.timestamp,
          gameId: game.gameId,
          icon: icon!
        })
    }
  for (const [label, identities] of labels) {
    if (identities.size !== 1 || identities.has('unproved')) continue
    result[label] = latest.get([...identities][0])?.icon ?? null
  }
  return result
}
