// sort-imports-ignore
// Register locale mocks before importing renderer components.
import './test-i18n'

import { describe, expect, test, vi } from 'vitest'
import { createSSRApp, h, reactive } from 'vue'
import { renderToString } from 'vue/server-renderer'

import MemberAnalysisSettingsDrawer from './MemberAnalysisSettingsDrawer.vue'
import { parseRiotId } from './riot-id'

vi.mock('@renderer-shared/composables/useSgpTagOptions', () => ({
  ALL_SGPTAG_VALUE: '<akari:all>',
  useSgpTagOptions: () => ({
    value: [
      {
        type: 'group',
        label: '通用模式',
        children: [
          { label: '所有模式', value: '<akari:all>' },
          { label: '排位积分类模式', value: 'ranked' }
        ]
      },
      {
        type: 'group',
        label: '游戏模式',
        children: [{ label: '5人排位赛', value: 'q_6' }]
      }
    ]
  })
}))

vi.mock('naive-ui', () => {
  const Stub = (_: unknown, { slots }: { slots: Record<string, Function> }) => slots.default?.()
  return {
    NAlert: Stub,
    NButton: Stub,
    NDrawer: (props: Record<string, unknown>, { slots }: { slots: Record<string, Function> }) =>
      h('div', { 'data-drawer-target': props.to }, slots.default?.()),
    NDrawerContent: (_: unknown, { slots }: { slots: Record<string, Function> }) => [
      slots.default?.(),
      slots.footer?.()
    ],
    NFormItem: Stub,
    NInput: Stub,
    NInputNumber: Stub,
    NSelect: (props: Record<string, unknown>) => h('div', JSON.stringify(props.options ?? [])),
    NSwitch: Stub
  }
})

describe('member analysis settings drawer', () => {
  test('parses a pasted full Riot ID into game name and tag', () => {
    const separator = '#'
    expect(parseRiotId(['示例玩家名称', 'ABCDE'].join(separator))).toEqual({
      gameName: '示例玩家名称',
      tagLine: 'ABCDE'
    })
    expect(parseRiotId(['  Player Name ', ' CN1  '].join(separator))).toEqual({
      gameName: 'Player Name',
      tagLine: 'CN1'
    })
  })

  test('leaves ordinary game-name paste unchanged', () => {
    expect(parseRiotId('我为莱纳下塑料FQ')).toBeNull()
    expect(parseRiotId('#41020')).toBeNull()
    expect(parseRiotId('Player#')).toBeNull()
  })

  test('opens with reactive Pinia settings without cloning the Vue proxy', async () => {
    const settings = reactive({
      enabled: false,
      members: [],
      historyDepth: 100 as const,
      scanLimitPerMember: 2000,
      historyTag: 'ranked',
      storageLimitGiB: 10,
      opggEnabled: false
    })
    const app = createSSRApp({
      render: () =>
        h(MemberAnalysisSettingsDrawer, {
          show: true,
          settings,
          saving: false,
          storageStatus: null,
          cleanupPreview: null,
          cleaning: false
        })
    })

    const html = await renderToString(app)
    expect(html).toContain('保存设置')
    expect(html).toContain('采集范围')
    expect(html).toContain('存储与参考')
    expect(html).toContain('启用成员分析')
    expect(html).toContain('排位积分类模式')
    expect(html).toContain('5人排位赛')
    expect(html).not.toContain('所有模式')
    expect(html).toContain('data-drawer-target=".member-analysis-page"')
  })
})
