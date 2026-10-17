<template>
  <section ref="root" class="combination-workspace" :aria-label="uiText('combinationWorkspace')">
    <div class="combination-selector">
      <MemberAnalysisSegments
        :model-value="view"
        :options="viewOptions"
        :slot-width="i18next.language.startsWith('en') ? 184 : 112"
        :ariaLabel="uiText('combinationView')"
        @update:model-value="changeView"
      />
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
            @keydown.esc.stop.prevent="closeScopeHelp"
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
        </div>
      </NPopover>
    </div>
    <div v-if="linkedMembers" class="combination-link" role="status">
      <span>{{ linkedMembers[0] }} × {{ linkedMembers[1] }}</span>
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
import { NButton, NPopover } from 'naive-ui'
import { i18next } from '@renderer-shared/i18n'
import { computed, nextTick, ref, useId, watch } from 'vue'
import MemberAnalysisSegments from './components/MemberAnalysisSegments.vue'
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
const viewOptions = computed(() => [
  { value: 'pairs', label: uiText('combinationRoles') },
  { value: 'synergy', label: uiText('combinationMembers') }
])
const linkedMembers = ref<CombinationMembers | null>(null)
const origin = ref<{ view: View; trigger: HTMLElement | null } | null>(null)
const { games, pairs, synergy } = useMemberAnalysisData()
const related = computed(() =>
  linkedMembers.value ? relatedRolePairs(pairs.value, games.value, linkedMembers.value) : []
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
function changeView(value: string | number) {
  if ((value === 'pairs' || value === 'synergy') && value !== props.view) emit('update:view', value)
}
async function openSynergy(link: RolePairLink) {
  origin.value = { view: 'pairs', trigger: document.activeElement as HTMLElement | null }
  linkedMembers.value = link.members
  emit('update:view', 'synergy')
  await nextTick()
  await nextTick()
  await memberView.value?.selectMembers(link.members)
}
async function openRolePairs(members: CombinationMembers) {
  origin.value = { view: 'synergy', trigger: document.activeElement as HTMLElement | null }
  linkedMembers.value = members
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
  origin.value = null
}
watch([pairs, synergy], () => {
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
.combination-selector,
.combination-link {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px 12px;
  padding: 8px 16px;
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
  margin: 0;
}
.combination-scope-content p + p {
  margin-top: 8px;
}
@media (max-height: 600px) {
  .combination-selector {
    padding-top: 4px;
    padding-bottom: 4px;
  }
  .combination-scope-help {
    display: inline-flex;
  }
}
</style>
