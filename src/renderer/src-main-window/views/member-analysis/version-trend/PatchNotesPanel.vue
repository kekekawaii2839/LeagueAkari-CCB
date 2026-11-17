<template>
  <section class="ma-native-data-view patch-notes">
    <div class="ma-data-toolbar patch-controls">
      <div class="patch-control">
        <span>{{ uiText('patchNotesVersion') }}</span>
        <NSelect
          :value="patch"
          @update:value="selectPatch"
          :options="options"
          filterable
          :aria-label="uiText('patchNotesVersion')"
          :input-props="{ 'aria-label': uiText('patchNotesVersion') }"
        />
      </div>
      <div class="patch-control patch-category">
        <span>{{ uiText('patchNotesCategory') }}</span>
        <NSelect
          v-model:value="category"
          :options="categories"
          :aria-label="uiText('patchNotesCategory')"
          :input-props="{ 'aria-label': uiText('patchNotesCategory') }"
        />
      </div>
      <NButton secondary :loading="loading" :disabled="!active || loading" @click="load(true)">{{
        uiText('patchNotesRefresh')
      }}</NButton>
      <NButton secondary :disabled="!filtered.length" @click="toggleAll">{{
        uiText(allExpanded ? 'patchNotesCollapseAll' : 'patchNotesExpandAll')
      }}</NButton>
    </div>
    <div v-if="error" class="patch-feedback" role="alert">
      <span
        >{{ error }}<template v-if="notes"> {{ uiText('patchNotesRetained') }}</template></span
      >
      <NButton secondary :disabled="!active || loading" @click="load(true)">{{
        uiText('patchNotesRetry')
      }}</NButton>
    </div>
    <p v-if="loading" class="ma-data-context" role="status">{{ uiText('patchNotesLoading') }}</p>
    <template v-if="notes && notes.patch === patch">
      <div class="patch-source ma-data-context">
        <span
          >{{ uiText('patchNotesSource')
          }}<span v-if="notes.publishedAt"> · {{ notes.publishedAt.slice(0, 10) }}</span></span
        >
        <span v-if="notes.stale" role="status">{{ uiText('patchNotesStale') }}</span>
        <NButton text tag="a" :href="notes.sourceUrl" target="_blank" rel="noopener noreferrer">{{
          uiText('patchNotesOriginal')
        }}</NButton>
      </div>
      <p v-if="notes.status === 'unavailable'" role="status">
        {{ uiText('patchNotesUnavailable') }}
      </p>
      <template v-else>
        <div v-if="!filtered.length" class="patch-feedback" role="status">
          <span>{{ uiText(notes.sections.length ? 'patchNotesNoMatch' : 'patchNotesEmpty') }}</span>
          <NButton v-if="category !== 'all'" secondary @click="clearFilters">{{
            uiText('patchNotesClearFilters')
          }}</NButton>
        </div>
        <section
          v-for="group in changeGroups"
          :key="group.kind"
          class="patch-group"
          :aria-busy="loading"
          :aria-label="uiText(group.label, { patch: notes.publicPatch })"
        >
          <h2 v-if="hasHotfix" class="patch-group-title">
            {{ uiText(group.label, { patch: notes.publicPatch }) }}
          </h2>
          <div class="patch-grid">
            <article v-for="section in group.sections" :key="section.key" class="patch-object">
              <header class="patch-identity">
                <LcuImage
                  v-if="
                    section.imageUrl && (!section.identity || section.identity.kind === 'champion')
                  "
                  :src="section.imageUrl"
                  class="patch-icon"
                  alt=""
                />
                <ChampionIcon
                  v-else-if="section.identity?.kind === 'champion'"
                  :champion-id="section.identity.id"
                  class="patch-icon"
                />
                <LcuImage
                  v-else-if="section.identity && section.identity.iconPath"
                  :src="section.identity.iconPath"
                  class="patch-icon"
                  alt=""
                />
                <div>
                  <h3>
                    {{ section.identity?.name || section.title
                    }}<span v-if="section.hotfix" class="patch-hotfix">{{
                      uiText('patchNotesHotfix')
                    }}</span>
                  </h3>
                  <p
                    v-if="section.identity?.name && section.identity.name !== section.title"
                    class="ma-data-note"
                  >
                    {{ section.title }}
                  </p>
                </div>
              </header>
              <div class="patch-object-actions">
                <span class="patch-direction">
                  <template v-for="(change, index) in section.summary" :key="change">
                    <span v-if="index" class="patch-direction-separator">{{ ' & ' }}</span>
                    <span :data-change="change">{{ uiText(changeLabels[change]) }}</span>
                  </template>
                </span>
                <NButton
                  text
                  :aria-expanded="expanded.has(section.key)"
                  :aria-controls="'patch-detail-' + section.key"
                  @click="toggleSection(section.key)"
                  >{{
                    uiText(
                      expanded.has(section.key) ? 'patchNotesHideEntries' : 'patchNotesShowEntries',
                      { count: section.entries.length }
                    )
                  }}</NButton
                >
              </div>
              <ul
                v-if="expanded.has(section.key)"
                :id="'patch-detail-' + section.key"
                class="patch-entries"
              >
                <li v-for="(entry, entryIndex) in section.entries" :key="entryIndex">
                  <div
                    v-if="
                      entry.ability &&
                      (entryIndex === 0 ||
                        entry.ability !== section.entries[entryIndex - 1].ability)
                    "
                    class="patch-ability"
                  >
                    <LcuImage
                      v-if="entry.abilityImageUrl"
                      :src="entry.abilityImageUrl"
                      class="patch-skill-icon"
                      alt=""
                    />{{ entry.ability }}
                  </div>
                  <template v-if="entry.before !== null && entry.after !== null">
                    <div class="patch-attribute">
                      {{ entry.label ?? uiText('patchNotesChange') }}
                    </div>
                    <div class="patch-values">
                      <span class="patch-before"
                        ><span class="sr-only">{{ uiText('patchNotesBefore') }} </span
                        >{{ entry.before }}</span
                      >
                      <span aria-hidden="true" class="patch-arrow">→</span>
                      <span
                        class="patch-after"
                        :data-change="patchChange(entry, section.category, section.section)"
                        ><span class="sr-only">{{ uiText('patchNotesAfter') }} </span
                        >{{ entry.after }}
                        <span class="patch-change">{{
                          uiText(
                            changeLabels[patchChange(entry, section.category, section.section)]
                          )
                        }}</span></span
                      >
                    </div>
                  </template>
                  <p v-else class="patch-prose">
                    {{ entry.text }}
                    <span
                      :data-change="patchChange(entry, section.category, section.section)"
                      class="patch-change"
                      >{{
                        uiText(changeLabels[patchChange(entry, section.category, section.section)])
                      }}</span
                    >
                  </p>
                </li>
              </ul>
            </article>
          </div>
        </section>
        <p v-if="notes.truncated" class="ma-data-note" role="status">
          {{ uiText('patchNotesTruncated') }}
        </p>
      </template>
    </template>
  </section>
</template>
<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { NButton, NSelect } from 'naive-ui'
import { useInstance } from '@renderer-shared/shards'
import { MemberAnalysisRenderer } from '@main-window/shards/member-analysis'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import LcuImage from '@renderer-shared/components/LcuImage.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useExtraAssetsStore } from '@renderer-shared/shards/extra-assets/store'
import { uiText } from '../ui-text'
import { i18next } from '@renderer-shared/i18n'
import { resolvePatchAssetIdentity, type PatchAssetIdentity } from './patch-asset-identity'
import { releasedPatchNotes, type PatchNotes } from '@shared/shards/member-analysis/patch-notes'
import { patchChange, sectionChange, type PatchChange } from './patch-change'
const changeLabels: Record<PatchChange, string> = {
  buff: 'patchNotesBuff',
  nerf: 'patchNotesNerf',
  adjusted: 'patchNotesChange',
  introduced: 'patchNotesIntroduced',
  unchanged: 'patchNotesUnchanged',
  unknown: 'patchNotesUnknown'
}
const props = withDefaults(defineProps<{ selectedPatch?: string | null; active?: boolean }>(), {
  active: true
})
const api = useInstance(MemberAnalysisRenderer)
const resources = useAkariResourceProvider()
const league = useLeagueClientStore()
const extra = useExtraAssetsStore()
const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')
const championIds = computed(() => {
  const result = new Map<string, number>()
  for (const hero of Object.values(extra.heroListMap)) {
    if (hero.alias) result.set(normalize(hero.alias), Number(hero.heroId))
  }
  for (const hero of Object.values(league.gameData.champions)) {
    if (hero.alias) result.set(normalize(hero.alias), hero.id)
  }
  return result
})
type Identity = { kind: 'champion'; id: number; name: string } | PatchAssetIdentity
const sections = computed(() =>
  (notes.value?.sections ?? []).map((section, key) => {
    let identity: Identity | null = null
    if (section.category === 'champion') {
      const id = championIds.value.get(normalize(section.entityKey ?? section.title))
      if (id && Number.isSafeInteger(id) && id > 0)
        identity = { kind: 'champion', id, name: resources.champions.name(id) }
    } else {
      identity = resolvePatchAssetIdentity(section, {
        locale: resources.runtime?.locale ?? i18next.language,
        items: league.gameData.items,
        perks: league.gameData.perks ?? {},
        itemDisplay: (id) => resources.items.display(id),
        perkDisplay: (id) => resources.perks?.display(id) ?? null
      })
    }
    return {
      ...section,
      identity,
      key,
      summary: sectionChange(section).split('-') as PatchChange[]
    }
  })
)
const expanded = ref(new Set<number>())
function toggleSection(key: number) {
  const next = new Set(expanded.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expanded.value = next
}
const allExpanded = computed(
  () =>
    filtered.value.length > 0 && filtered.value.every((section) => expanded.value.has(section.key))
)
function toggleAll() {
  expanded.value = allExpanded.value
    ? new Set()
    : new Set(filtered.value.map((section) => section.key))
}
const availablePatches = ref([...releasedPatchNotes])
const options = computed(() =>
  availablePatches.value.map((value) => ({
    label: `${Number(value.split('.')[0]) + 10}.${value.split('.')[1]}`,
    value
  }))
)
const patch = ref<string | null>(null)
const initialized = ref(false)
const followLatest = ref(true)
function selectPatch(value: string) {
  followLatest.value = false
  generation++
  loading.value = false
  patch.value = value
  notes.value = null
  expanded.value = new Set()
  if (props.active) void load()
}
const category = ref('all')
const categories = [
  { label: uiText('patchNotesAll'), value: 'all' },
  { label: uiText('patchNotesChampion'), value: 'champion' },
  { label: uiText('patchNotesItem'), value: 'item' },
  { label: uiText('patchNotesSystem'), value: 'system' }
]
const notes = ref<PatchNotes | null>(null),
  loading = ref(false),
  error = ref<string | null>(null)

let generation = 0
const filtered = computed(() =>
  sections.value.filter(
    (section) => category.value === 'all' || section.category === category.value
  )
)
// Keep original section keys: the same champion can have independent base and hotfix entries.
const hasHotfix = computed(() => sections.value.some((section) => section.hotfix))
const changeGroups = computed(() =>
  [
    {
      kind: 'regular',
      label: 'patchNotesRegularGroup',
      sections: filtered.value.filter((s) => !s.hotfix)
    },
    {
      kind: 'hotfix',
      label: 'patchNotesHotfixGroup',
      sections: filtered.value.filter((s) => s.hotfix)
    }
  ].filter((group) => group.sections.length)
)
async function load(refresh = false, cacheOnly = false) {
  if (!props.active || loading.value) return
  const id = ++generation,
    selected = patch.value ?? releasedPatchNotes[0]
  loading.value = true
  error.value = null
  try {
    const reply = await api.getPatchNotes({
      patch: selected,
      ...(followLatest.value ? { latest: true } : {}),
      ...(cacheOnly ? { cacheOnly: true } : {}),
      ...(refresh ? { refresh: true } : {})
    })
    if (id !== generation || !props.active) return
    if (reply.ok) {
      notes.value = reply.value
      availablePatches.value = [
        ...new Set([
          ...releasedPatchNotes,
          ...availablePatches.value,
          ...(reply.value.availablePatches ?? []),
          ...(reply.value.status === 'available' ? [reply.value.patch] : [])
        ])
      ].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      patch.value = reply.value.patch
    } else error.value = uiText('patchNotesFailed')
  } catch {
    if (id === generation) error.value = uiText('patchNotesFailed')
  } finally {
    if (id === generation) loading.value = false
  }
}
function clearFilters() {
  category.value = 'all'
}
watch(
  () => props.selectedPatch,
  (value) => {
    if (value && options.value.some((option) => option.value === value)) {
      if (initialized.value) selectPatch(value)
      else {
        followLatest.value = false
        patch.value = value
      }
    }
  },
  { immediate: true }
)
watch(
  () => props.active,
  (active) => {
    generation++
    loading.value = false
    if (!active) return
    if (!initialized.value) {
      const activation = generation
      void (async () => {
        await load(false, true)
        if (!props.active || generation !== activation + 1) return
        initialized.value = true
        await load(true)
      })()
    } else void load(true)
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  generation++
})
</script>
<style scoped>
.patch-notes {
  --patch-buff: #69c795;
  --patch-nerf: #ff929b;
  min-width: 0;
}
:global(.member-analysis-page .patch-notes) {
  gap: 8px;
}
:global([data-theme='light'] .patch-notes) {
  --patch-buff: #21643e;
  --patch-nerf: #a42c3c;
}
.patch-control {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 200px;
  max-width: 100%;
  min-width: 0;
}
.patch-control > span {
  flex: none;
}
.patch-control :deep(.n-select) {
  min-width: 0;
  flex: 1;
}
.patch-category {
  width: 180px;
}
.patch-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
}
.patch-source {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.patch-group {
  min-width: 0;
}
.patch-group + .patch-group {
  margin-top: 16px;
}
.patch-group-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 12px;
}
.patch-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 360px), 1fr));
  gap: 12px 24px;
  align-items: start;
}
.patch-object {
  min-width: 0;
  border-top: 1px solid var(--ma-grid);
  padding-top: 12px;
  overflow-wrap: anywhere;
}
.patch-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.patch-icon {
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 6px;
}
h3 {
  font-size: 15px;
  margin: 0;
  font-weight: 600;
}
.patch-hotfix {
  font-size: 12px;
  font-weight: 400;
  margin-left: 8px;
  color: var(--ma-muted);
}
.patch-object-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.patch-direction {
  font-size: 12px;
}
.patch-direction-separator {
  white-space: pre;
}
.patch-entries {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 8px;
}
.patch-ability {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ma-muted);
  margin-bottom: 4px;
}
.patch-skill-icon {
  width: 22px;
  height: 22px;
  flex: none;
  border-radius: 4px;
}
.patch-attribute {
  font-size: 13px;
  color: var(--ma-muted);
}
.patch-values {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 8px;
  align-items: baseline;
  font-variant-numeric: tabular-nums;
  font-size: 14px;
}
.patch-before {
  color: var(--ma-muted);
}
.patch-arrow {
  color: var(--ma-muted);
}
[data-change='buff'] {
  color: var(--patch-buff);
}
[data-change='nerf'] {
  color: var(--patch-nerf);
}
.patch-change {
  font-size: 12px;
  white-space: nowrap;
}
.patch-prose {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}
.patch-feedback {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
