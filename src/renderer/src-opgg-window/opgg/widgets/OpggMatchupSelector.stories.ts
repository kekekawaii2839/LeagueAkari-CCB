import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { ref } from 'vue'

import OpggMatchupSelector from './OpggMatchupSelector.vue'

const meta = {
  title: 'OP.GG/Matchup Selector',
  component: OpggMatchupSelector,
  parameters: {
    akariStoryPanelMaxWidth: '560px'
  },
  render: (args) => ({
    components: { OpggMatchupSelector },
    setup() {
      const selectedChampionId = ref<number | null>(args.matchupChampionId ?? null)
      return { args, selectedChampionId }
    },
    template: `
      <OpggMatchupSelector
        :enemy-champion-ids="args.enemyChampionIds"
        :matchup-champion-id="selectedChampionId"
        :is-loading="args.isLoading"
        @select="selectedChampionId = $event"
      />
    `
  })
} satisfies Meta<typeof OpggMatchupSelector>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    enemyChampionIds: [24, 64, 103, 222, 89],
    matchupChampionId: null,
    isLoading: false
  }
}

export const Selected: Story = {
  args: {
    enemyChampionIds: [24, 64, 103, 222, 89],
    matchupChampionId: 24,
    isLoading: false
  }
}

export const Loading: Story = {
  args: {
    enemyChampionIds: [24, 64, 103, 222, 89],
    matchupChampionId: 24,
    isLoading: true
  }
}
