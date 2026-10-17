<template>
  <section
    ref="overview"
    class="ten-overview"
    :class="game.win ? 'ten-win' : 'ten-loss'"
    :aria-busy="loading"
  >
    <div class="ten-surface" :class="game.win ? 'shadow-win' : 'shadow-loss'" aria-hidden="true" />
    <div class="ten-body">
      <template v-if="teams">
        <div
          v-for="team in teams"
          :key="team.id"
          v-memo="[team, tooltip, appStore.settings.streamerMode, appStore.settings.locale]"
          class="ten-team"
          role="group"
          :aria-label="uiText(team.id === 100 ? 'matchBlueSide' : 'matchRedSide')"
        >
          <div class="ten-roster">
            <div v-for="player in team.players" :key="player.participantId" class="ten-player">
              <ChampionIcon :champion-id="player.championId" class="ten-portrait" />
              <div class="ten-player-copy">
                <span
                  class="ten-name"
                  tabindex="0"
                  :aria-label="identityText(player)"
                  :aria-describedby="
                    tooltip === player.participantId + ':name' ? tooltipId : undefined
                  "
                  @focus="showTooltip(player, 'name', $event)"
                  @click="showTooltip(player, 'name', $event)"
                  @mouseenter="showTooltip(player, 'name', $event)"
                  @mouseleave="leaveTooltip"
                  @blur="closeTooltip"
                  @keydown.esc.stop="closeTooltip"
                >
                  <strong v-if="team.own">{{ nameText(player) }}</strong
                  ><template v-else>{{ nameText(player) }}</template>
                </span>
                <span
                  class="ten-player-meta"
                  tabindex="0"
                  :aria-label="rankAccessibleLabel(player)"
                  :aria-describedby="
                    tooltip === player.participantId + ':rank' ? tooltipId : undefined
                  "
                  @focus="showTooltip(player, 'rank', $event)"
                  @click="showTooltip(player, 'rank', $event)"
                  @mouseenter="showTooltip(player, 'rank', $event)"
                  @mouseleave="leaveTooltip"
                  @blur="closeTooltip"
                  @keydown.esc.stop="closeTooltip"
                >
                  <PositionIcon
                    v-if="player.position && Object.hasOwn(roleNames, player.position)"
                    class="ten-role-icon"
                    :position="player.position"
                    aria-hidden="true"
                  />
                  <span class="ten-meta-copy"
                    >{{
                      player.position ? roleNames[player.position] : uiText('matchRoleUnknown')
                    }}
                    · {{ rankCompact(player) }}</span
                  >
                </span>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-else class="ten-unavailable" role="status">
        {{
          uiText(
            loading ? 'matchTenLoading' : error ? 'matchTenReadFailed' : 'matchTenUnavailable'
          )
        }}<NButton v-if="error" size="small" quaternary @click="load">{{
          uiText('retry')
        }}</NButton>
      </div>
      <div class="ten-footer">
        <strong class="ten-outcome" :class="game.win ? 'ten-outcome-win' : 'ten-outcome-loss'">{{
          uiText(game.win ? 'matchWin' : 'matchLoss')
        }}</strong>
        <span>{{ timeLabel }}</span
        ><span>{{ formatSeconds(game.duration) }}</span
        ><span>{{ uiText('matchPatch', { patch: game.patch }) }}</span
        ><span>#{{ game.gameId }}</span>
      </div>
    </div>
    <NTooltip v-if="tooltipPlayer" trigger="manual" :show="true" placement="top">
      <template #trigger>
        <span
          class="ten-tooltip-anchor"
          aria-hidden="true"
          :style="{
            left: `${tooltipRect.left}px`,
            top: `${tooltipRect.top}px`,
            width: `${tooltipRect.width}px`,
            height: `${tooltipRect.height}px`
          }"
        />
      </template>
      <div
        :id="tooltipId"
        :class="tooltip.endsWith(':rank') ? 'ten-rank-tooltip' : 'ten-name-tooltip'"
      >
        {{ tooltip.endsWith(':rank') ? rankDetails(tooltipPlayer) : identityText(tooltipPlayer) }}
      </div>
    </NTooltip>
    <button
      type="button"
      class="ten-expand"
      :style="expandStyle"
      :aria-expanded="expanded"
      :aria-controls="`match-detail-${game.gameId}`"
      :aria-label="expandLabel"
      @click="$emit('toggle')"
    >
      <ArrowBackIosFilled
        class="ten-arrow"
        :class="expanded ? 'ten-arrow-expanded' : 'ten-arrow-collapsed'"
        aria-hidden="true"
        focusable="false"
      />
    </button>
  </section>
</template>
<script setup lang="ts">
import { ArrowBackIosFilled } from '@vicons/material'
import { NButton, NTooltip, useThemeVars } from 'naive-ui'
import { computed, onDeactivated, ref, watch } from 'vue'
import { useStreamerModeMaskedText } from '@renderer-shared/composables/useStreamerModeMaskedText'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { getNaiveUiThemeOverrides } from '@renderer-shared/theme/naive-ui'
import type { MemberAnalysisGame } from '@shared/shards/member-analysis'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import PositionIcon from '@renderer-shared/components/icons/position-icons/PositionIcon.vue'
import { formatSeconds } from '@renderer-shared/components/match-card/utils/time'
import { useMemberMatchOverview } from './useMemberMatchDetails'
import { memberMatchTeams, type MemberMatchParticipant } from './member-match-overview'
import { uiText } from './ui-text'
import { queueRankText, rankFailureText, snapshotTime } from './opponent-ranks/format'
import { rankLabel } from '@shared/shards/member-analysis/opponent-ranks'
import '@renderer-shared/components/match-card/match-card.css'

const props = defineProps<{
  game: MemberAnalysisGame
  expanded: boolean
  timeLabel: string
  expandLabel: string
  active: boolean
}>()
defineEmits<{ toggle: [] }>()
const appStore = useAppCommonStore()
const themeVars = useThemeVars()
// Same live tokens as the default quaternary NButton, without mounting a
// separate Button/Icon theme/slot graph for every summary's disclosure.
const expandStyle = computed(() => {
  const common = themeVars.value
  const button = getNaiveUiThemeOverrides(appStore.themeId).Button
  return {
    '--ma-expand-color':
      typeof button?.textColor === 'string' ? button.textColor : common.textColor2,
    '--ma-expand-hover':
      typeof button?.colorQuaternaryHover === 'string'
        ? button.colorQuaternaryHover
        : common.buttonColor2Hover,
    '--ma-expand-pressed':
      typeof button?.colorQuaternaryPressed === 'string'
        ? button.colorQuaternaryPressed
        : common.buttonColor2Pressed,
    '--ma-expand-disabled-opacity': common.opacityDisabled,
    '--ma-expand-bezier': common.cubicBezierEaseInOut
  }
})
const { masked } = useStreamerModeMaskedText()
const tooltip = ref('')
const closeTooltip = () => {
  tooltip.value = ''
}
const tooltipRect = ref({ left: 0, top: 0, width: 0, height: 0 })
const overview = ref<HTMLElement | null>(null)
const tooltipId = computed(() => `match-${props.game.gameId}-participant-tooltip`)
function showTooltip(player: MemberMatchParticipant, kind: 'name' | 'rank', event: Event) {
  if (!props.active) return
  const target = event.currentTarget as HTMLElement | null
  const container = overview.value
  if (!target || !container) return
  const rect = target.getBoundingClientRect()
  const parentRect = container.getBoundingClientRect()
  // Give the native follower the entire target area. A zero-height point at
  // its top edge can overlap the trigger when the tooltip flips below it.
  tooltipRect.value = {
    left: rect.left - parentRect.left - (container.clientLeft || 0),
    top: rect.top - parentRect.top - (container.clientTop || 0),
    width: rect.width,
    height: rect.height
  }
  tooltip.value = `${player.participantId}:${kind}`
}
function leaveTooltip(event: MouseEvent) {
  if (event.currentTarget !== (event.currentTarget as HTMLElement)?.ownerDocument.activeElement)
    closeTooltip()
}
watch(tooltip, (value, _previous, cleanup) => {
  if (!value || typeof window === 'undefined') return
  window.addEventListener('scroll', closeTooltip, true)
  window.addEventListener('resize', closeTooltip)
  cleanup(() => {
    window.removeEventListener('scroll', closeTooltip, true)
    window.removeEventListener('resize', closeTooltip)
  })
})
watch(
  [() => props.active, () => props.game.gameId, () => appStore.settings.streamerMode],
  closeTooltip
)
onDeactivated(closeTooltip)
const nameText = (player: MemberMatchParticipant) =>
  masked(player.name || uiText('matchNameMissing'))
const identityText = (player: MemberMatchParticipant) =>
  masked(player.identity || uiText('matchIdentityMissing'))
const { match, loading, error, load } = useMemberMatchOverview(
  () => props.game.gameId,
  () => props.active
)
const roleNames = { TOP: '上路', JUNGLE: '打野', MIDDLE: '中路', BOTTOM: '下路', UTILITY: '辅助' }
const teams = computed(() => memberMatchTeams(props.game, match.value))
const tooltipPlayer = computed(() =>
  teams.value
    ?.flatMap((team) => team.players)
    .find((player) => tooltip.value.startsWith(player.participantId + ':'))
)
watch(teams, closeTooltip)
const rankAccessibleLabel = (player: MemberMatchParticipant) => {
  const snapshot = player.rank?.snapshot
  if (!snapshot) return uiText('matchPersonalRankMissing', { identity: identityText(player) })
  return [
    identityText(player),
    player.position ? roleNames[player.position] : uiText('matchRoleUnknown'),
    rankCompact(player),
    timingText(player),
    snapshot.status === 'stale' ? uiText('matchRankStale') : '',
    rankFailureText(snapshot)
  ]
    .filter(Boolean)
    .join(' · ')
}
const timingText = (player: MemberMatchParticipant) =>
  uiText(
    player.rank?.timing === 'during-game'
      ? 'matchRankTimingDuring'
      : player.rank?.timing === 'after-game'
        ? 'matchRankTimingAfter'
        : 'matchRankTimingUnknown'
  )
function rankCompact(player: MemberMatchParticipant) {
  const flex = player.rank?.snapshot?.flex
  if (flex?.status === 'provisional') return uiText('matchRankProvisional')
  if (flex?.status === 'unranked') return uiText('matchRankNone')
  if (flex?.status !== 'ranked') return uiText('matchRankMissing')
  const label = rankLabel(flex.rank)
  return flex.rank.leaguePoints === null ? label : `${label} · ${flex.rank.leaguePoints} LP`
}
function rankDetails(player: MemberMatchParticipant) {
  const snapshot = player.rank?.snapshot
  if (!snapshot) return uiText('matchPersonalRankMissing', { identity: identityText(player) })
  return uiText('matchPersonalRankDetails', {
    identity: identityText(player),
    role: player.position ? roleNames[player.position] : uiText('matchRoleUnknown'),
    solo: queueRankText(snapshot, 'solo'),
    flex: queueRankText(snapshot, 'flex'),
    timing: timingText(player),
    source: match.value?.participantRanks?.source,
    observed: snapshotTime(player.rank?.observedAt, uiText('matchObservedUnknown')),
    fetched: snapshotTime(snapshot.fetchedAt, uiText('matchFetchedMissing')),
    attempted: snapshotTime(snapshot.attemptedAt, uiText('matchAttemptedUnknown')),
    reason: rankFailureText(snapshot) || uiText('matchRankNoFailure')
  })
}
</script>
<style scoped>
.ten-overview {
  position: relative;
  display: flex;
  box-sizing: border-box;
  width: 100%;
  min-width: 930px;
  height: 116px;
  overflow: hidden;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.2);
  border-radius: 3px;
  background: var(--la-card-surface-95);
  color: var(--la-color-text-primary);
}
.ten-surface {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.ten-body {
  position: relative;
  z-index: 1;
  display: grid;
  grid-template-rows: 40px 40px 20px;
  min-width: 0;
  flex: 1;
  padding: 6px 12px;
}
.ten-team {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ten-roster {
  display: grid;
  min-width: 0;
  flex: 1;
  grid-template-columns: repeat(5, minmax(168px, 1fr));
  gap: 8px;
}
.ten-player {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
}
.ten-portrait {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  overflow: hidden;
  border-radius: 5px;
}
.ten-portrait :deep(img) {
  width: 100%;
  height: 100%;
}
.ten-player-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
}
.ten-name {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}
.ten-name strong {
  font-weight: 700;
}
.ten-name:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
}
.ten-player-meta:focus-visible {
  outline: 2px solid var(--la-color-link);
  outline-offset: -2px;
}
.ten-tooltip-anchor {
  position: absolute;
  pointer-events: none;
}
.ten-rank-tooltip,
.ten-name-tooltip {
  max-width: 540px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.ten-rank-tooltip {
  font-size: 12px;
  line-height: 1.6;
}
.ten-player-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  color: var(--ma-muted);
}
.ten-role-icon {
  flex: none;
  width: 14px;
  height: 14px;
  font-size: 14px;
  line-height: 1;
}
.ten-meta-copy {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.ten-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 20px;
  margin-top: 2px;
  transform: translateY(2px);
  white-space: nowrap;
  font-size: 12px;
  line-height: 20px;
  color: var(--ma-muted);
}
.ten-outcome {
  font-size: 12px;
  font-weight: 600;
}
.ten-outcome-win {
  color: var(--ma-blue);
}
.ten-outcome-loss {
  color: var(--ma-red);
}
.ten-expand {
  appearance: none;
  box-sizing: border-box;
  position: relative;
  z-index: 1;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  min-width: 32px;
  height: 114px;
  margin: 0;
  padding: 0;
  border: 0;
  border-left: 1px solid rgb(var(--la-card-border-rgb) / 0.12);
  border-radius: 0 3px 3px 0;
  background: transparent;
  color: var(--ma-expand-color);
  font: inherit;
  line-height: 1;
  text-align: center;
  text-decoration: none;
  user-select: none;
  cursor: pointer;
  outline: none;
  transition:
    color 0.3s var(--ma-expand-bezier),
    background-color 0.3s var(--ma-expand-bezier),
    opacity 0.3s var(--ma-expand-bezier);
}
.ten-expand:not(:disabled):hover,
.ten-expand:not(:disabled):focus {
  background-color: var(--ma-expand-hover);
}
.ten-expand:not(:disabled):active {
  background-color: var(--ma-expand-pressed);
}
.ten-expand:focus-visible {
  outline: 2px solid var(--ma-expand-color);
  outline-offset: -2px;
}
.ten-expand:disabled {
  opacity: var(--ma-expand-disabled-opacity);
  cursor: not-allowed;
}
.ten-arrow {
  flex: none;
  width: 18px;
  height: 18px;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .ten-expand {
    transition: none;
  }
}
.ten-arrow-expanded {
  transform: rotate(90deg);
}
.ten-arrow-collapsed {
  transform: rotate(-90deg);
}
.ten-unavailable {
  grid-row: 1 / 3;
  display: flex;
  align-items: center;
  font-size: 14px;
}
</style>
