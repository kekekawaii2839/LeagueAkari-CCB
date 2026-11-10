<template>
  <div class="scatter-filter-panel">
    <div class="scatter-filter-heading">
      <NButton :aria-expanded="expanded" @click="expanded = !expanded">{{
        uiText('scatterFilters')
      }}</NButton>
      <span>{{ uiText('scatterFilterScope') }}</span>
      <NButton
        v-if="active"
        quaternary
        @click="emit('update:modelValue', defaultScatterFilters())"
        >{{ uiText('scatterClearFilters') }}</NButton
      >
    </div>
    <div v-if="expanded" class="scatter-filter-fields">
      <label
        >{{ text('member')
        }}<NSelect
          :value="modelValue.memberId"
          :options="[{ label: uiText('scatterAllMembers'), value: 'all' }, ...members]"
          @update:value="update({ memberId: $event })"
      /></label>
      <label
        >{{ text('champion')
        }}<NSelect
          :value="modelValue.champion"
          :options="champions"
          clearable
          filterable
          @update:value="update({ champion: $event })"
      /></label>
      <label
        >{{ text('side')
        }}<NSelect
          :value="modelValue.side"
          :options="[
            { label: text('all'), value: 'all' },
            { label: text('blue'), value: 'Blue' },
            { label: text('red'), value: 'Red' }
          ]"
          @update:value="update({ side: $event })"
      /></label>
      <label
        >{{ text('outcome')
        }}<NSelect
          :value="modelValue.outcome"
          :options="[
            { label: text('all'), value: 'all' },
            { label: text('win'), value: 'win' },
            { label: text('loss'), value: 'loss' }
          ]"
          @update:value="update({ outcome: $event })"
      /></label>
      <label
        >{{ text('patchFrom')
        }}<NInput :value="modelValue.patchFrom" @update:value="update({ patchFrom: $event })"
      /></label>
      <label
        >{{ text('patchTo')
        }}<NInput :value="modelValue.patchTo" @update:value="update({ patchTo: $event })"
      /></label>
      <label
        >{{ text('dateFrom')
        }}<NInput
          :value="modelValue.dateFrom"
          placeholder="YYYY-MM-DD"
          @update:value="update({ dateFrom: $event })"
      /></label>
      <label
        >{{ text('dateTo')
        }}<NInput
          :value="modelValue.dateTo"
          placeholder="YYYY-MM-DD"
          @update:value="update({ dateTo: $event })"
      /></label>
      <label
        >{{ text('durationMin')
        }}<NInputNumber
          :value="modelValue.durationMin"
          :min="0"
          :max="180"
          @update:value="update({ durationMin: $event })"
      /></label>
      <label
        >{{ text('durationMax')
        }}<NInputNumber
          :value="modelValue.durationMax"
          :min="0"
          :max="180"
          @update:value="update({ durationMax: $event })"
      /></label>
      <label
        >{{ text('includeMembers')
        }}<NSelect
          :value="modelValue.includeMemberIds"
          :options="
            members.filter(
              (m) =>
                m.value !== modelValue.memberId && !modelValue.excludeMemberIds.includes(m.value)
            )
          "
          multiple
          @update:value="update({ includeMemberIds: $event })"
      /></label>
      <label
        >{{ text('excludeMembers')
        }}<NSelect
          :value="modelValue.excludeMemberIds"
          :options="
            members.filter(
              (m) =>
                m.value !== modelValue.memberId && !modelValue.includeMemberIds.includes(m.value)
            )
          "
          multiple
          @update:value="update({ excludeMemberIds: $event })"
      /></label>
      <label
        >{{ text('completeness')
        }}<NSelect
          :value="modelValue.completeness"
          :options="[
            { label: uiText('scatterAllObservations'), value: 'all' },
            { label: uiText('scatterCompletePairs'), value: 'metric-known' }
          ]"
          @update:value="update({ completeness: $event })"
      /></label>
    </div>
    <p v-if="active" class="scatter-filter-summary" role="status">{{ summary }}</p>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NInput, NInputNumber, NSelect } from 'naive-ui'
import { defaultScatterFilters, hasScatterFilters, type ScatterFilters } from './scatter-filters'
import { uiText } from './ui-text'
const props = defineProps<{
  modelValue: ScatterFilters
  members: { label: string; value: string }[]
  champions: { label: string; value: string }[]
}>()
const emit = defineEmits<{ 'update:modelValue': [value: ScatterFilters] }>()
const expanded = ref(false)
const active = computed(() => hasScatterFilters(props.modelValue))
const text = (key: string) =>
  uiText(`versionTrend${key[0].toUpperCase()}${key.slice(1)}` as Parameters<typeof uiText>[0])
const update = (patch: Partial<ScatterFilters>) =>
  emit('update:modelValue', { ...props.modelValue, ...patch })
const summary = computed(() => {
  const f = props.modelValue
  const labels = props.members.filter((m) =>
    [f.memberId, ...f.includeMemberIds, ...f.excludeMemberIds].includes(m.value)
  )
  return [
    f.memberId === 'all' ? '' : labels.find((m) => m.value === f.memberId)?.label,
    f.champion,
    f.side === 'all' ? '' : text(f.side === 'Blue' ? 'blue' : 'red'),
    f.outcome === 'all' ? '' : text(f.outcome === 'win' ? 'win' : 'loss'),
    f.patchFrom || f.patchTo
      ? `${text('patchFrom')} ${f.patchFrom || '—'} → ${f.patchTo || '—'}`
      : '',
    f.dateFrom || f.dateTo ? `${f.dateFrom || '—'} → ${f.dateTo || '—'}` : '',
    f.durationMin !== null || f.durationMax !== null
      ? `${f.durationMin ?? '—'}–${f.durationMax ?? '—'} ${uiText('scatterMinutes')}`
      : '',
    f.includeMemberIds.length
      ? `${text('includeMembers')}：${labels
          .filter((m) => f.includeMemberIds.includes(m.value))
          .map((m) => m.label)
          .join('、')}`
      : '',
    f.excludeMemberIds.length
      ? `${text('excludeMembers')}：${labels
          .filter((m) => f.excludeMemberIds.includes(m.value))
          .map((m) => m.label)
          .join('、')}`
      : '',
    f.completeness === 'metric-known' ? uiText('scatterCompletePairs') : ''
  ]
    .filter(Boolean)
    .join(' · ')
})
</script>
<style scoped>
.scatter-filter-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: var(--ma-muted);
  font-size: 12px;
}
.scatter-filter-heading {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.scatter-filter-fields {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px 12px;
}
.scatter-filter-fields label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 14px;
}
.scatter-filter-summary {
  margin: 0;
  overflow-wrap: anywhere;
}
</style>
