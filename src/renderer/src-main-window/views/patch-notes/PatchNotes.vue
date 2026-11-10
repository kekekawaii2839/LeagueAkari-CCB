<template>
  <main class="patch-notes-page member-analysis-page">
    <header class="patch-notes-header">
      <NIcon :component="DocumentBulletList24Regular" :size="24" />
      <h1>版本改动</h1>
    </header>
    <div class="patch-notes-content"><PatchNotesPanel :active="active" /></div>
  </main>
</template>
<script setup lang="ts">
import { DocumentBulletList24Regular } from '@vicons/fluent'
import { NIcon } from 'naive-ui'
import { onActivated, onDeactivated, ref } from 'vue'
import PatchNotesPanel from '../member-analysis/version-trend/PatchNotesPanel.vue'
import '../member-analysis/member-analysis-visuals.css'
const active = ref(true)
onActivated(() => {
  active.value = true
})
onDeactivated(() => {
  active.value = false
})
</script>
<style scoped>
.patch-notes-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  color: var(--la-color-text-primary);
}
.patch-notes-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 24px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.14);
}
.patch-notes-header h1 {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
}
.patch-notes-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 16px 24px;
}
@media (max-width: 900px) {
  .patch-notes-header {
    padding-inline: 12px;
  }
  .patch-notes-content {
    padding: 12px;
  }
}
</style>
