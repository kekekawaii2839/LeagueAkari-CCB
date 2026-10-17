import LcuImage from '@renderer-shared/components/LcuImage.vue'
import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { readFileSync } from 'node:fs'
import { transformWithEsbuild } from 'vite'
import { expect, test, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, h, nextTick, shallowReactive, ssrContextKey } from 'vue'

import MemberProfileAvatar from './MemberProfileAvatar.vue'

const resources = vi.hoisted(() => ({ connected: true }))
vi.mock('@renderer-shared/providers/akari-resource/context', () => ({
  useAkariResourceProvider: () => ({
    assets: {
      resolve: (source: string) => (resources.connected ? `akari://league-client${source}` : null)
    }
  })
}))
for (const [component, url] of [
  [MemberProfileAvatar, new URL('./MemberProfileAvatar.vue', import.meta.url)],
  [LcuImage, new URL('../../../../renderer-shared/components/LcuImage.vue', import.meta.url)]
] as const) {
  const descriptor = parse(readFileSync(url, 'utf8')).descriptor
  const code = compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: compileScript(descriptor, { id: 'profile-avatar-test' }).bindings
  }).code
  component.render = new Function(
    'Vue',
    (await transformWithEsbuild(code, 'avatar-template.ts', { loader: 'ts' })).code
  )(Vue)
}
type Node = { type: string; props: Record<string, any>; children: Node[]; parent: Node | null }
const node = (type: string): Node => ({ type, props: {}, children: [], parent: null })
function mount(iconId: number | null) {
  const renderer = createRenderer<Node, Node>({
    createElement: node,
    createComment: node,
    createText: node,
    setText() {},
    setElementText() {},
    parentNode: (n) => n.parent,
    nextSibling: () => null,
    patchProp: (n, key, _previous, value) => {
      n.props[key] = value
    },
    insert(n, parent, anchor) {
      n.parent = parent
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, n)
    },
    remove(n) {
      if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1)
    }
  })
  const props = shallowReactive({ iconId, size: 34, bordered: false })
  const root = node('root')
  const app = renderer.createApp({ render: () => h(MemberProfileAvatar, props) })
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const all = () => {
    const walk = (n: Node): Node[] => [n, ...n.children.flatMap(walk)]
    return walk(root)
  }
  return { app, props, all }
}
test('native profile assets preserve zero and fall back for missing, disconnected or failed assets', async () => {
  resources.connected = true
  const f = mount(0)
  try {
    expect(f.all().find((n) => n.type === 'img')!.props.src).toBe(
      'akari://league-client/lol-game-data/assets/v1/profile-icons/0.jpg'
    )
    const slot = f.all().find((n) => n.type === 'span')!
    expect(slot.props.style).toMatchObject({ width: '34px', height: '34px', borderWidth: '0' })
    expect(slot.props['aria-hidden']).toBe('true')
    f.all()
      .find((n) => n.type === 'img')!
      .props.onError()
    await nextTick()
    expect(f.all().some((n) => n.type === 'img')).toBe(false)
    f.props.iconId = 29
    await nextTick()
    expect(f.all().find((n) => n.type === 'img')!.props.src).toContain('/29.jpg')
    f.props.iconId = null
    await nextTick()
    expect(f.all().some((n) => n.type === 'img')).toBe(false)
    resources.connected = false
    f.props.iconId = 2
    f.props.size = 24
    f.props.bordered = true
    await nextTick()
    expect(f.all().some((n) => n.type === 'img')).toBe(false)
    expect(slot.props.style).toMatchObject({ width: '24px', height: '24px', borderWidth: '1px' })
  } finally {
    f.app.unmount()
    resources.connected = true
  }
})
