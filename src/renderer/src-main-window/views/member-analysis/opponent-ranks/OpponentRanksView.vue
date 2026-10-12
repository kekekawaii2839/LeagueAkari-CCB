<template>
  <div class="ma-panel ma-workspace opponent-ranks-view">
    <OpponentRankSummary :games="games" />
  </div>
</template>

<script setup lang="ts">
import { useMemberAnalysisData } from '../useMemberAnalysisData'
import OpponentRankSummary from './OpponentRankSummary.vue'

const { games } = useMemberAnalysisData()
</script>
