<template>
  <main class="pool-page" @keydown.esc="infoOpen = false">
    <header class="pool-header">
      <NIcon :component="ViewModuleRound" :size="22" />
      <h1>{{ t('championPool.title') }}</h1>
      <NTag v-if="catalog" size="small" class="pool-version"
        >{{ catalog.patch }}<span v-if="catalog.stale"> · {{ t('championPool.stale') }}</span></NTag
      >
      <NPopover v-model:show="infoOpen" trigger="click" placement="bottom-start"
        ><template #trigger
          ><NButton text size="small">{{ t('championPool.info') }}</NButton></template
        >
        <div class="pool-info">
          <p>{{ t('championPool.method') }}</p>
          <p v-if="catalog">
            {{ t('championPool.source', { patch: catalog.patch }) }}<br />
            {{ t('championPool.updated', { time: new Date(catalog.fetchedAt).toLocaleString() }) }}
          </p>
          <p>{{ t('championPool.top3Help') }}</p>
          <p>{{ t('championPool.heatmap.scale') }}</p>
          <p>{{ t('championPool.heatmap.help') }}</p>
        </div></NPopover
      >
    </header>
    <div class="pool-content">
      <section class="pool-controls" :aria-label="t('championPool.edit')">
        <div class="control role-control">
          <label for="pool-role">{{ t('championPool.role') }}</label
          ><NSelect
            :render-label="renderRoleLabel"
            :input-props="{ id: 'pool-role' }"
            filterable
            :value="role"
            :options="roleOptions"
            :disabled="busy || initializing"
            @update:value="changeRole"
          />
        </div>
        <div class="control champion-control">
          <label for="pool-champions">{{ t('championPool.champions') }}</label
          ><NSelect
            :render-label="renderChampionLabel"
            :render-tag="renderChampionTag"
            :input-props="{ id: 'pool-champions' }"
            v-model:value="selected"
            multiple
            filterable
            :options="championOptions"
            :disabled="busy || initializing || !catalog"
            :placeholder="t('championPool.selectChampions')"
            :filter="filterChampion"
          />
        </div>
        <div class="pool-actions">
          <NButton type="primary" :disabled="busy || !validSelection" @click="analyze">{{
            t('championPool.analyze')
          }}</NButton>
          <NButton v-if="busy" @click="cancel">{{ t('championPool.cancel') }}</NButton>
          <NButton v-else :disabled="initializing" @click="loadCatalog(true)">{{
            t(catalog ? 'championPool.refresh' : 'championPool.retry')
          }}</NButton>
        </div>
      </section>

      <div v-if="busy" class="pool-progress" role="status" aria-live="polite">
        <NSpin :size="14" />
        <span>{{
          referenceProgress
            ? t('championPool.referenceProgress', referenceProgress)
            : t('championPool.loadingShort')
        }}</span>
      </div>
      <NAlert
        v-if="error"
        type="warning"
        :title="t('championPool.errors.' + error)"
        class="pool-alert"
      />
      <NAlert
        v-if="storageError"
        type="warning"
        :title="t('championPool.errors.storage')"
        class="pool-alert"
      />
      <NAlert
        v-if="coverage?.cacheWarning"
        type="warning"
        :title="t('championPool.errors.cacheWrite')"
        class="pool-alert"
      />
      <NAlert
        v-if="catalog && selected.length && !validSelection"
        type="warning"
        :title="t('championPool.errors.invalidSelection')"
        class="pool-alert"
      />
      <NTabs v-model:value="mode" type="line" :animated="false">
        <NTab name="matchup">{{ t('championPool.matchup') }}</NTab
        ><NTab name="synergy">{{ t('championPool.synergy') }}</NTab>
      </NTabs>

      <template v-if="coverage && !dirty">
        <div class="pool-filters">
          <div class="control">
            <label for="pool-target-role">{{ t('championPool.targetRole') }}</label
            ><NSelect
              :render-label="renderRoleLabel"
              :input-props="{ id: 'pool-target-role' }"
              filterable
              v-model:value="targetRole"
              :options="targetRoleOptions"
            />
          </div>
          <div class="control">
            <label for="pool-search">{{ t('championPool.search') }}</label
            ><NInput :input-props="{ id: 'pool-search' }" v-model:value="search" clearable />
          </div>
          <NCheckbox v-model:checked="commonOnly">{{ t('championPool.commonOnly') }}</NCheckbox>
        </div>
        <CoverageHeatmap
          v-if="visibleTargets.length"
          :key="mode + targetRole"
          :targets="visibleTargets"
          :champions="coverage.champions"
          :resolve-name="name"
          :own-role="coverage.role"
          :patch="coverage.patch"
          :fetched-at="coverage.fetchedAt"
        />
        <NEmpty v-else :description="t('championPool.noTargets')" />
      </template>
      <NEmpty
        v-else-if="!busy"
        :description="t(dirty ? 'championPool.changed' : 'championPool.empty')"
        class="pool-empty"
      />
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, onDeactivated, onBeforeUnmount, onActivated, ref, watch } from 'vue'
import { useTranslation } from 'i18next-vue'
import { useChampionNameMatch } from '@renderer-shared/composables/useChampionNameMatch'
import type { SelectOption } from 'naive-ui'
import {
  NAlert,
  NButton,
  NCheckbox,
  NEmpty,
  NIcon,
  NInput,
  NSelect,
  NSpin,
  NTab,
  NTabs,
  NPopover,
  NTag
} from 'naive-ui'
import { ViewModuleRound } from '@vicons/material'
import { useInstance } from '@renderer-shared/shards'
import { ChampionPoolRenderer } from '@main-window/shards/champion-pool'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import CoverageHeatmap from './CoverageHeatmap.vue'
import { renderRoleLabel, renderChampionLabel, renderChampionTag } from './select-renderers'
import {
  type PoolCatalog,
  type PoolCoverage,
  type PoolErrorCode,
  type PoolResult,
  type PoolPreferences,
  type PoolReferenceProgress
} from '@shared/shards/champion-pool/coverage'
import {
  DRAFT_ROLES,
  type DraftRole,
  type InteractionMode
} from '@shared/shards/member-analysis/champion-pool/scoring'

const { t } = useTranslation()
const api = useInstance(ChampionPoolRenderer)
const league = useLeagueClientStore()
const { match } = useChampionNameMatch()
const filterChampion = (pattern: string, option: SelectOption) =>
  match(pattern, String(option.label), Number(option.value))
const role = ref<DraftRole>('MID')
const mode = ref<InteractionMode>('matchup')
const defaultSynergyRole: Record<DraftRole, DraftRole> = {
  TOP: 'JUNGLE',
  JUNGLE: 'MID',
  MID: 'JUNGLE',
  ADC: 'SUP',
  SUP: 'ADC'
}
const targetRoleOverrides = ref<Partial<Record<InteractionMode, DraftRole>>>({})
const targetRole = computed({
  get: () =>
    targetRoleOverrides.value[mode.value] ??
    (mode.value === 'matchup' ? role.value : defaultSynergyRole[role.value]),
  set: (value: DraftRole) => {
    targetRoleOverrides.value[mode.value] = value
  }
})
watch(
  role,
  () => {
    targetRoleOverrides.value = {}
  },
  { flush: 'sync' }
)
const selected = ref<number[]>([]),
  catalog = ref<PoolCatalog | null>(null),
  coverage = ref<PoolCoverage | null>(null)
const busy = ref(false),
  error = ref<PoolErrorCode | 'transport' | null>(null),
  search = ref(''),
  commonOnly = ref(true)
let generation = 0,
  requestId: string | null = null,
  progressTimer: ReturnType<typeof setInterval> | null = null
const name = (id: number, fallback: string) => league.gameData.champions[id]?.name || fallback
const roleOptions = computed(() =>
  DRAFT_ROLES.map((value) => ({ value, label: t('championPool.roles.' + value) }))
)
const targetRoleOptions = computed(() =>
  roleOptions.value.filter((r) => mode.value !== 'synergy' || r.value !== role.value)
)
const championOptions = computed(() =>
  (catalog.value?.champions ?? []).map((c) => ({
    value: c.id,
    label: name(c.id, c.name)
  }))
)
const initializing = ref(true),
  initialStorageError = ref(false),
  preferencesLoaded = ref(false),
  infoOpen = ref(false),
  referenceProgress = ref<PoolReferenceProgress | null>(null)
const pools = ref<PoolPreferences['pools']>({ TOP: [], JUNGLE: [], MID: [], ADC: [], SUP: [] })
let restoring = false,
  active = true
const validSelection = computed(
  () =>
    !!catalog.value &&
    !!selected.value.length &&
    selected.value.every((id) => catalog.value!.champions.some((c) => c.id === id))
)
const saveTokens: Record<DraftRole, number> = { TOP: 0, JUNGLE: 0, MID: 0, ADC: 0, SUP: 0 }
const saveErrors = ref<Record<DraftRole, boolean>>({
  TOP: false,
  JUNGLE: false,
  MID: false,
  ADC: false,
  SUP: false
})
const storageError = computed(
  () => initialStorageError.value || Object.values(saveErrors.value).some(Boolean)
)
function rememberPool(target: DraftRole, ids: number[]) {
  const token = ++saveTokens[target]
  void api
    .savePool(target, [...ids])
    .then((result) => {
      if (token !== saveTokens[target]) return
      saveErrors.value[target] = result.status !== 'ready'
      if (result.status === 'ready') {
        initialStorageError.value = false
        preferencesLoaded.value = true
        for (const other of DRAFT_ROLES)
          if (other !== target && saveTokens[other] === 0)
            pools.value[other] = [...result.data.pools[other]]
      }
    })
    .catch(() => {
      if (token === saveTokens[target]) saveErrors.value[target] = true
    })
}
watch(
  selected,
  (ids) => {
    if (initializing.value || restoring) return
    pools.value[role.value] = [...ids]
    rememberPool(role.value, ids)
  },
  { deep: true, flush: 'sync' }
)
const dirty = computed(
  () =>
    !!coverage.value &&
    (coverage.value.role !== role.value ||
      coverage.value.champions.map((c) => c.id).join(',') !== selected.value.join(','))
)
const scopedTargets = computed(() =>
  (coverage.value?.targets ?? []).filter(
    (target) =>
      target.mode === mode.value &&
      target.role === targetRole.value &&
      (!commonOnly.value || target.pickRate >= 0.005)
  )
)
const visibleTargets = computed(() => {
  const needle = search.value.trim()
  return scopedTargets.value
    .filter(
      (c) =>
        !needle ||
        match(needle, name(c.championId, c.name), c.championId) ||
        match(needle, c.name, c.championId)
    )
    .sort(
      (a, b) =>
        (a.top3?.score === null || a.top3?.score === undefined ? 1 : 0) -
          (b.top3?.score === null || b.top3?.score === undefined ? 1 : 0) ||
        (b.top3?.score ?? 0) - (a.top3?.score ?? 0) ||
        b.pickRate - a.pickRate ||
        a.championId - b.championId
    )
})
async function run<T>(
  work: (id: string) => Promise<PoolResult<T>>,
  apply: (value: T) => void,
  reference = false
) {
  if (busy.value) return false
  const ownGeneration = ++generation,
    id = crypto.randomUUID()
  requestId = id
  busy.value = true
  error.value = null
  let timer: ReturnType<typeof setInterval> | undefined
  if (reference) {
    referenceProgress.value = coverage.value?.reference || null
    timer = setInterval(() => {
      void api
        .getReferenceProgress(id)
        .then((p) => {
          if (generation === ownGeneration && p) referenceProgress.value = p
        })
        .catch(() => {})
    }, 1000)
    progressTimer = timer
  }
  try {
    const result = await work(id)
    if (generation !== ownGeneration) return false
    if (result.status === 'ready') {
      apply(result.data)
      return true
    }
    error.value = result.code
    return false
  } catch {
    if (generation === ownGeneration) error.value = 'transport'
    return false
  } finally {
    if (timer) clearInterval(timer)
    if (progressTimer === timer) progressTimer = null
    if (generation === ownGeneration) {
      busy.value = false
      requestId = null
      referenceProgress.value = null
    }
  }
}
async function loadCatalog(refresh = false) {
  const ok = await run<PoolCatalog>(
    (id) => api.getCatalog(role.value, refresh, id),
    (value) => {
      catalog.value = value
      coverage.value = null
    }
  )
  if (ok && active && validSelection.value) await analyze()
}
async function changeRole(value: DraftRole) {
  restoring = true
  role.value = value
  selected.value = [...pools.value[value]]
  restoring = false
  if (preferencesLoaded.value) rememberPool(value, selected.value)
  catalog.value = null
  coverage.value = null
  await loadCatalog()
}
async function analyze() {
  if (!catalog.value || !validSelection.value) return
  const datasetId = catalog.value.datasetId,
    championIds = [...selected.value]
  const ok = await run<PoolCoverage>(
    (id) => api.getCoverage(datasetId, championIds, id),
    (value) => {
      coverage.value = value
    }
  )
  if (
    ok &&
    active &&
    coverage.value?.reference &&
    coverage.value.reference.completed < coverage.value.reference.total
  ) {
    await run<PoolCoverage>(
      (id) => api.prepareReference(datasetId, championIds, id),
      (value) => {
        coverage.value = value
      },
      true
    )
  }
}
function cancel() {
  if (progressTimer) clearInterval(progressTimer)
  progressTimer = null
  infoOpen.value = false
  const id = requestId
  ++generation
  requestId = null
  busy.value = false
  referenceProgress.value = null
  if (id) {
    error.value = 'cancelled'
    void api.cancel(id).catch(() => {})
  }
}
onMounted(async () => {
  try {
    const result = await api.getPreferences()
    if (result.status === 'ready') {
      restoring = true
      preferencesLoaded.value = true
      pools.value = result.data.pools
      role.value = result.data.lastRole
      selected.value = [...pools.value[role.value]]
      restoring = false
    } else initialStorageError.value = true
  } catch {
    initialStorageError.value = true
  }
  initializing.value = false
  if (active) await loadCatalog()
})
onActivated(() => {
  active = true
  if (!initializing.value && !catalog.value && !busy.value) void loadCatalog()
})
onDeactivated(() => {
  active = false
  cancel()
})
onBeforeUnmount(() => {
  active = false
  cancel()
})
</script>

<style scoped>
.pool-page {
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: var(--la-color-text-primary);
  font-size: 14px;
  line-height: 1.5;
}
.pool-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  flex-wrap: wrap;
  flex-shrink: 0;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.18);
}
.pool-version {
  height: 24px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.pool-version :deep(.n-tag__content) {
  display: flex;
  align-items: center;
  line-height: 1;
}
h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.pool-content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px 24px;
  overflow: auto;
  min-height: 0;
}
.pool-content > * {
  flex-shrink: 0;
}
.pool-controls,
.pool-filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
}
.pool-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 25px;
}
.pool-controls {
  align-items: flex-start;
}
.pool-progress {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
  font-size: 13px;
  color: var(--la-color-text-primary);
  font-variant-numeric: tabular-nums;
}
.control {
  min-width: 0;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 160px;
}
.role-control {
  width: 110px;
}
.champion-control {
  flex: 1;
  min-width: min(240px, 100%);
}
.pool-info {
  max-width: min(440px, calc(100vw - 48px));
  font-size: 13px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.pool-info p {
  margin: 0;
}
.pool-info p + p {
  margin-top: 12px;
}
.pool-filters :deep(.n-checkbox) {
  min-height: 34px;
  align-items: center;
}
.pool-empty {
  padding: 40px 0;
}
@media (max-width: 900px) {
  .pool-header {
    padding-inline: 12px;
  }
  .pool-content {
    padding: 12px;
  }
}
</style>
