<template>
  <NDataTable
    :columns="columns"
    :data="rows"
    :pagination="rows.length > pageSize ? { pageSize } : false"
    :scroll-x="scrollX"
    :bordered="false"
    :single-line="true"
    size="small"
    class="member-analysis-metric-table"
  />
</template>

<script setup lang="ts">
import { NDataTable, type DataTableColumns } from 'naive-ui'

withDefaults(
  defineProps<{
    columns: DataTableColumns<Record<string, unknown>>
    rows: Record<string, unknown>[]
    pageSize?: number
    scrollX?: number
  }>(),
  { pageSize: 25, scrollX: 720 }
)
</script>

<style scoped>
.member-analysis-metric-table {
  border-top: 1px solid var(--ma-grid-strong);
  --n-td-color: transparent !important;
  --n-th-color: transparent !important;
  --n-td-color-hover: var(--ma-hover) !important;
}

.member-analysis-metric-table :deep(.n-data-table-th) {
  background: transparent;
  color: var(--ma-muted);
  font-size: 14px;
  font-weight: 500;
}

.member-analysis-metric-table :deep(.n-data-table-td) {
  background: transparent;
  font-variant-numeric: tabular-nums;
}
</style>
