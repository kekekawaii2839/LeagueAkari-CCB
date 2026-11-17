import { createRouter, createWebHashHistory } from 'vue-router'

import Automation from '@main-window/views/automation/Automation.vue'
import ChampionPool from '@main-window/views/champion-pool/ChampionPool.vue'
import MemberAnalysis from '@main-window/views/member-analysis/MemberAnalysis.vue'
import OngoingGame from '@main-window/views/ongoing-game/OngoingGame.vue'
import PatchNotes from '@main-window/views/patch-notes/PatchNotes.vue'
import PlayerTabs from '@main-window/views/player-tabs/PlayerTabs.vue'
import Test from '@main-window/views/test/Test.vue'
import Toolkit from '@main-window/views/toolkit/Toolkit.vue'

// console.log(import.meta.env.BASE_URL)
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'root',
      redirect: { name: 'player-tabs' }
    },
    {
      name: 'player-tabs',
      path: '/player-tabs/:sgpServerId?/:puuid?',
      component: PlayerTabs
    },
    {
      path: '/member-analysis/patch-notes',
      redirect: { name: 'patch-notes' }
    },
    {
      name: 'patch-notes',
      path: '/patch-notes',
      component: PatchNotes
    },
    { name: 'champion-pool', path: '/champion-pool', component: ChampionPool },
    {
      name: 'member-analysis',
      path: '/member-analysis/:section?',
      component: MemberAnalysis
    },
    {
      name: 'ongoing-game',
      path: '/ongoing-game',
      component: OngoingGame
    },
    {
      name: 'toolkit',
      path: '/toolkit/:section?',
      component: Toolkit
    },
    {
      name: 'automation',
      path: '/automation/:section?',
      component: Automation
    },
    {
      name: 'test',
      path: '/test/:section?',
      component: Test
    }
  ]
})

router.beforeEach((to) => {
  if (to.name === 'member-analysis' && to.params.section === 'patch-notes') {
    return { name: 'patch-notes', query: to.query, hash: to.hash, replace: true }
  }
  return undefined
})

export { router }
