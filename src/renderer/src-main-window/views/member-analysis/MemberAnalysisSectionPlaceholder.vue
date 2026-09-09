<template>
  <div class="member-analysis-placeholder">
    <NResult status="info" :title="title" :description="description" />
  </div>
</template>

<script setup lang="ts">
import { NResult } from 'naive-ui'

defineProps<{ title: string; description: string }>()
</script>

<style scoped>
.member-analysis-placeholder {
  display: grid;
  min-height: 280px;
  place-items: center;
  padding: 24px;
}
</style>
