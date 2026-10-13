<template>
  <section ref="root" class="combination-workspace" :aria-label="uiText('combinationWorkspace')">
    <div class="combination-selector">
      <div class="combination-switch">
        <span
          ref="switchIndicator"
          class="combination-switch-indicator"
          aria-hidden="true"
          :style="{ transform: view === 'synergy' ? 'translateX(100%)' : 'translateX(0)' }"
        />
        <NRadioGroup
          class="combination-switch-options"
          :value="view"
          :aria-label="uiText('combinationView')"
          @update:value="changeView"
        >
          <NRadioButton value="pairs">{{ uiText('combinationRoles') }}</NRadioButton>
          <NRadioButton value="synergy">{{ uiText('combinationMembers') }}</NRadioButton>
        </NRadioGroup>
      </div>
      <span class="combination-scope">{{
        uiText(view === 'pairs' ? 'combinationRoleScope' : 'combinationMemberScope')
      }}</span>
      <NPopover
        v-model:show="scopeHelp"
        trigger="click"
        placement="bottom"
        @keydown.esc.stop.prevent="closeScopeHelp"
      >
        <template #trigger
          ><NButton
            ref="scopeTrigger"
            size="small"
            quaternary
            class="combination-scope-help"
            :aria-expanded="scopeHelp"
            :aria-controls="scopeHelpId"
            >{{ uiText('combinationScopeHelp') }}</NButton
          ></template
        >
        <div
          :id="scopeHelpId"
          class="combination-scope-content"
          @keydown.esc.stop.prevent="closeScopeHelp"
        >
          <p>{{ uiText(view === 'pairs' ? 'combinationRoleScope' : 'combinationMemberScope') }}</p>
          <p v-if="contextNote">{{ contextNote }}</p>
          <NButton size="small" quaternary @click="closeScopeHelp">{{
            uiText('combinationCloseScopeHelp')
          }}</NButton>
        </div>
      </NPopover>
    </div>
    <div v-if="linkedMembers" class="combination-link" role="status">
      <span
        >{{ short(linkedMembers[0]) }} × {{ short(linkedMembers[1]) }} ·
        {{
          roleContext
            ? uiText('combinationLinkedSamples', {
                role: roleName(roleContext.pairType),
                roleGames,
                jointGames
              })
            : uiText('combinationRelatedSamples', { count: related.length, jointGames })
        }}
      </span>
      <NButton v-if="origin" size="small" quaternary @click="returnToOrigin">{{
        uiText(origin.view === 'pairs' ? 'combinationReturnRoles' : 'combinationReturnMembers')
      }}</NButton>
      <NButton size="small" quaternary @click="clearLink">{{
        uiText('combinationClearLink')
      }}</NButton>
    </div>
    <KeepAlive>
      <PairView
        v-if="view === 'pairs'"
        ref="roleView"
        :linked-context="linkedMembers"
        @open-synergy="openSynergy"
      />
      <SynergyView v-else ref="memberView" @open-role-pairs="openRolePairs" />
    </KeepAlive>
  </section>
</template>

<script setup lang="ts">
import { NButton, NPopover, NRadioButton, NRadioGroup } from 'naive-ui'
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, useId, watch } from 'vue'
import { useDocumentVisibility, useElementVisibility, useMediaQuery } from '@vueuse/core'
import { createCombinationMotion } from './combination-motion'
import PairView from './PairView.vue'
import SynergyView from './SynergyView.vue'
import {
  relatedRolePairs,
  relatedSynergy,
  type CombinationMembers,
  type RolePairLink
} from './combination-navigation'
import { useMemberAnalysisData } from './useMemberAnalysisData'
import { uiText } from './ui-text'

type View = 'pairs' | 'synergy'
const props = defineProps<{ view: View; contextNote?: string }>()
const emit = defineEmits<{ 'update:view': [view: View] }>()
const root = ref<HTMLElement | null>(null)
const scopeHelp = ref(false)
const scopeHelpId = useId()
const scopeTrigger = ref<InstanceType<typeof NButton> | null>(null)
async function closeScopeHelp() {
  scopeHelp.value = false
  await nextTick()
  const trigger = scopeTrigger.value?.$el as HTMLElement | undefined
  trigger?.focus()
}
const roleView = ref<InstanceType<typeof PairView> | null>(null)
const memberView = ref<InstanceType<typeof SynergyView> | null>(null)
const switchIndicator = ref<HTMLElement | null>(null)
const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)')
const visible = useElementVisibility(root)
const documentVisibility = useDocumentVisibility()
const childMotion = createCombinationMotion({
  active: () => props.view,
  indicator: () => switchIndicator.value,
  reduced: () => reducedMotion.value,
  visible: () => visible.value && documentVisibility.value === 'visible',
  rendered: nextTick
})
watch(
  () => props.view,
  (view) => void childMotion.changed(view)
)
watch([reducedMotion, visible, documentVisibility], () => childMotion.cancel())
onDeactivated(childMotion.cancel)
onBeforeUnmount(childMotion.cancel)
const linkedMembers = ref<CombinationMembers | null>(null)
const roleContext = ref<RolePairLink | null>(null)
const origin = ref<{ view: View; trigger: HTMLElement | null } | null>(null)
const { games, pairs, synergy } = useMemberAnalysisData()
const roleName = (type: RolePairLink['pairType']) =>
  uiText(
    (
      {
        upper_pair: 'combinationUpperPair',
        mid_jg_pair: 'combinationMidPair',
        bot_pair: 'combinationBotPair'
      } as const
    )[type]
  )
const short = (name: string) => name.split('#')[0]
const related = computed(() =>
  linkedMembers.value ? relatedRolePairs(pairs.value, games.value, linkedMembers.value) : []
)
const jointGames = computed(() =>
  linkedMembers.value ? (relatedSynergy(synergy.value, linkedMembers.value)?.games ?? 0) : 0
)
const roleGames = computed(() =>
  roleContext.value
    ? (pairs.value.find(
        (row) =>
          row.sideLabel === '总计' &&
          row.pairType === roleContext.value!.pairType &&
          row.pair === roleContext.value!.pair
      )?.games ?? 0)
    : 0
)

// Session-only DOM state. Each population keeps its own reading position;
// KeepAlive retains selection, sorting and the three hero-table page numbers.
const positions = new Map<View, { top: number; horizontal: number[]; vertical: number[] }>()
const scroller = () => root.value?.closest<HTMLElement>('.member-analysis-scroll')
const regions = () => [...(root.value?.querySelectorAll<HTMLElement>('[role="region"]') ?? [])]
watch(
  () => props.view,
  async (_, previous) => {
    const scroll = scroller()
    if (scroll)
      positions.set(previous, {
        top: scroll.scrollTop,
        horizontal: regions().map((e) => e.scrollLeft),
        vertical: regions().map((e) => e.scrollTop)
      })
    await nextTick()
    const saved = positions.get(props.view)
    const current = scroller()
    if (current && saved) current.scrollTop = saved.top
    else if (current && root.value) {
      const nav = current.querySelector<HTMLElement>(
        '.member-analysis-ready > .n-tabs > .n-tabs-nav'
      )
      current.scrollTop +=
        root.value.getBoundingClientRect().top -
        (nav?.getBoundingClientRect().bottom ?? current.getBoundingClientRect().top) -
        8
    }
    if (saved)
      regions().forEach((region, index) => {
        region.scrollLeft = saved.horizontal[index] ?? 0
        region.scrollTop = saved.vertical[index] ?? 0
      })
  }
)
watch(
  () => props.view,
  () => {
    scopeHelp.value = false
  }
)
function changeView(value: string | number | boolean) {
  if (value === 'pairs' || value === 'synergy')
    childMotion.request(value, () => emit('update:view', value))
}
async function openSynergy(link: RolePairLink) {
  origin.value = { view: 'pairs', trigger: document.activeElement as HTMLElement | null }
  linkedMembers.value = link.members
  roleContext.value = link
  emit('update:view', 'synergy')
  await nextTick()
  await nextTick()
  await memberView.value?.selectMembers(link.members)
}
async function openRolePairs(members: CombinationMembers) {
  origin.value = { view: 'synergy', trigger: document.activeElement as HTMLElement | null }
  linkedMembers.value = members
  roleContext.value = null
  emit('update:view', 'pairs')
  await nextTick()
  await nextTick()
  await roleView.value?.selectMembers(members)
}
async function returnToOrigin() {
  const target = origin.value
  if (!target) return
  emit('update:view', target.view)
  await nextTick()
  await nextTick()
  if (target.trigger?.isConnected) target.trigger.focus({ preventScroll: true })
}
function clearLink() {
  linkedMembers.value = null
  roleContext.value = null
  origin.value = null
}
watch([pairs, synergy], () => {
  childMotion.cancel()
  if (
    linkedMembers.value &&
    !relatedSynergy(synergy.value, linkedMembers.value) &&
    !related.value.length
  )
    clearLink()
})
</script>

<style scoped>
.combination-workspace {
  min-width: 0;
}
.combination-switch {
  position: relative;
  padding: 3px;
  max-width: 100%;
  border-radius: 6px;
  background: color-mix(in srgb, var(--la-card-muted-surface) 72%, transparent);
}
.combination-switch-indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 3px;
  width: calc(50% - 3px);
  border-radius: 4px;
  background: var(--la-card-surface-95);
  box-shadow: inset 0 0 0 1px var(--ma-grid);
  pointer-events: none;
}
.combination-switch-options {
  position: relative;
  display: inline-grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.combination-switch-options :deep(.n-radio-button) {
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 0 14px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  box-shadow: none;
  color: var(--ma-muted);
}
.combination-switch-options :deep(.n-radio-button--checked) {
  color: var(--la-color-text-primary);
  font-weight: 600;
}
.combination-switch-options :deep(.n-radio-button__state-border) {
  display: none;
}
.combination-switch-options :deep(.n-radio-button:has(input:focus-visible)) {
  outline: 1px solid var(--la-color-link);
  outline-offset: -2px;
}
.combination-selector,
.combination-link {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 8px 16px;
}
.combination-selector {
  border-bottom: 1px solid var(--ma-grid);
}
.combination-scope {
  font-size: 12px;
  line-height: 1.5;
  color: var(--ma-muted);
}
.combination-link {
  font-size: 13px;
  line-height: 1.5;
  border-bottom: 1px solid var(--ma-grid);
}
.combination-link > span {
  overflow-wrap: anywhere;
}
.combination-scope-help {
  display: none;
}
.combination-scope-content {
  max-width: 320px;
  font-size: 14px;
  line-height: 1.5;
}
.combination-scope-content p {
  margin: 0 0 8px;
}
@media (max-height: 600px) {
  .combination-selector {
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .combination-scope {
    display: none;
  }
  .combination-scope-help {
    display: inline-flex;
  }
}
</style>
