<template>
  <span
    class="member-profile-avatar"
    :style="{ width: `${size}px`, height: `${size}px`, borderWidth: bordered ? '1px' : '0' }"
    aria-hidden="true"
  >
    <LcuImage class="member-profile-image" :src="source" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import LcuImage from '@renderer-shared/components/LcuImage.vue'
import { profileIconUri } from '@renderer-shared/shards/league-client/game-data-assets'

const props = withDefaults(
  defineProps<{ iconId: number | null; size?: number; bordered?: boolean }>(),
  { size: 34, bordered: false }
)
const source = computed(() =>
  props.iconId !== null && Number.isSafeInteger(props.iconId) && props.iconId >= 0
    ? profileIconUri(props.iconId)
    : undefined
)
</script>

<style scoped>
.member-profile-avatar {
  display: block;
  flex: none;
  box-sizing: content-box;
  overflow: hidden;
  border-style: solid;
  border-color: var(--ma-grid-strong);
  border-radius: 6px;
  background: var(--la-card-muted-surface);
}
.member-profile-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
</style>
