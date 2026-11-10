import { expect, test } from 'vitest'

import { resolvePatchAssetIdentity } from './patch-asset-identity'

// Independently checked against public Riot 16.16.1 en_US/zh_CN catalogs.
const reviewed = [
  ["Berserker's Greaves", 3006, '狂战士胫甲'],
  ['Black Cleaver', 3071, '黑色切割者'],
  ['Eclipse', 6692, '星蚀'],
  ["Runaan's Hurricane", 3085, '卢安娜的飓风'],
  ["Sterak's Gage", 3053, '斯特拉克的挑战护手'],
  ['Sundered Sky', 6610, '焚天'],
  ['Sunfire Cape', 3068, '日炎圣盾'],
  ['Chainlaced Crushers', 3173, '带链碾碎者'],
  ["Spellslinger's Shoes", 3175, '灵能使之靴'],
  ['Tiamat', 3077, '提亚马特'],
  ['Fleet Footwork', 8021, '迅捷步法'],
  ['Hail of Blades', 9923, '丛刃'],
  ["Doran's Helm", 1120, '多兰之盔'],
  ['Imperial Mandate', 4005, '帝国指令'],
  ['Immortal Path', 3168, '不朽之路'],
  ['Protoplasm Harness', 2525, '原生质护带'],
  ['Hextech Rocketbelt', 3152, '海克斯科技火箭腰带'],
  ['Terminus', 3302, '界弓'],
  ['Yun Tal Wildarrows', 3032, '育恩塔尔荒野箭'],
  ['Jack of All Trades', 8316, '多面手'],
  ['Stormrazor', 3095, '岚切'],
  ["Guinsoo's Rageblade", 3124, '鬼索的狂暴之刃'],
  ['Experimental Hexplate', 3073, '海克斯注力刚壁'],
  ['Dawncore', 6621, '黎明核心'],
  ['Hubris', 6697, '狂妄']
] as const
const empty = () => ({
  locale: 'zh-CN',
  items: {},
  perks: {},
  itemDisplay: () => null,
  perkDisplay: () => null
})
for (const [title, id, zh] of reviewed) {
  const category = id === 8021 || id === 9923 || id === 8316 ? 'system' : 'item'
  test(`${title}: current client name wins without a tooltip; verified fallback works offline`, () => {
    const section = { title, category, entityKey: null }
    const key = category === 'item' ? 'items' : 'perks'
    expect(resolvePatchAssetIdentity(section, empty())).toMatchObject({ id, name: zh })
    const client = { ...empty(), [key]: { [id]: { name: '客户端合成名称' } } }
    expect(resolvePatchAssetIdentity(section, client)).toMatchObject({ id, name: '客户端合成名称' })
  })
}

test('Sunfire SR legacy alias never joins Classic same-name 773068', () => {
  const result = resolvePatchAssetIdentity(
    { title: 'Sunfire Cape', category: 'item', entityKey: null },
    { ...empty(), items: { 3068: { name: '客户端圣盾' }, 773068: { name: '不该选择的经典装备' } } }
  )
  expect(result).toMatchObject({ id: 3068, name: '客户端圣盾' })
})

test('unknown names are not guessed; current English client names and numeric IDs still resolve', () => {
  const section = { title: 'Unknown Item', category: 'item', entityKey: null }
  expect(resolvePatchAssetIdentity(section, empty())).toBeNull()
  expect(
    resolvePatchAssetIdentity(section, { ...empty(), items: { 7000: { name: 'Unknown Item' } } })
  ).toMatchObject({ id: 7000, name: 'Unknown Item' })
  expect(
    resolvePatchAssetIdentity(
      { ...section, entityKey: '7001' },
      { ...empty(), items: { 7001: { name: '客户端新装备' } } }
    )
  ).toMatchObject({ id: 7001, name: '客户端新装备' })
  expect(
    resolvePatchAssetIdentity({ ...section, entityKey: '9007199254740993' }, empty())
  ).toBeNull()
})

test('verified fallback follows UI locale, but client localization always takes precedence', () => {
  const section = { title: 'Fleet Footwork', category: 'system', entityKey: null }
  expect(resolvePatchAssetIdentity(section, { ...empty(), locale: 'en' })).toMatchObject({
    name: 'Fleet Footwork'
  })
  expect(
    resolvePatchAssetIdentity(section, {
      ...empty(),
      locale: 'en',
      perks: { 8021: { name: '国服符文' } }
    })
  ).toMatchObject({ name: '国服符文' })
  expect(resolvePatchAssetIdentity(section, { ...empty(), locale: 'zh_CN' })).toMatchObject({
    name: '迅捷步法'
  })
})

test('perk identity does not reinterpret an ordinary system object or a champion', () => {
  expect(
    resolvePatchAssetIdentity({ title: 'Systems', category: 'system', entityKey: null }, empty())
  ).toBeNull()
  expect(
    resolvePatchAssetIdentity(
      { title: 'Fleet Footwork', category: 'champion', entityKey: null },
      empty()
    )
  ).toBeNull()
})

test.each([
  ['Hextech Rocketbelt', 223152, 3152, '海克斯科技火箭腰带'],
  ["Runaan's Hurricane", 223085, 3085, '卢安娜的飓风']
] as const)(
  'verified SR %s ignores presentation-only Arena portrait %s',
  (title, portrait, id, zh) => {
    const section = { title, category: 'item', entityKey: String(portrait) }
    const result = resolvePatchAssetIdentity(section, {
      ...empty(),
      items: { [portrait]: { name: '不应使用的竞技场资源' }, [id]: { name: zh } }
    })
    expect(result).toMatchObject({ kind: 'item', id, name: zh })
    expect(section.entityKey).toBe(String(portrait))
    expect(resolvePatchAssetIdentity(section, empty())).toMatchObject({ id, name: zh })
  }
)

test('Stormrazor respects both verified catalog generations, not a forced cross-patch ID rewrite', () => {
  const section = { title: 'Stormrazor', category: 'item', entityKey: '3095' }
  expect(
    resolvePatchAssetIdentity(section, {
      ...empty(),
      items: { 3095: { name: '已弃用的装备' }, 3097: { name: '岚切' } }
    })
  ).toMatchObject({ id: 3097, name: '岚切' })
  expect(
    resolvePatchAssetIdentity(section, { ...empty(), items: { 3095: { name: '岚切' } } })
  ).toMatchObject({ id: 3095, name: '岚切' })
  expect(
    resolvePatchAssetIdentity(
      { ...section, entityKey: '3097' },
      { ...empty(), items: { 3095: { name: '岚切' } } }
    )
  ).toMatchObject({ id: 3095, name: '岚切' })
  expect(
    resolvePatchAssetIdentity(section, {
      ...empty(),
      items: { 3095: { name: 'Deprecated item', iconPath: '/retired-item-icon' } }
    })
  ).toMatchObject({ name: '岚切', iconPath: undefined })
  expect(section.entityKey).toBe('3095')
})

test('combined starter items are explicitly a two-item group with independently resolved names', () => {
  const section = { title: 'World Atlas and Runic Compass', category: 'item', entityKey: null }
  expect(resolvePatchAssetIdentity(section, empty())).toEqual({
    kind: 'item-group',
    ids: [3865, 3866],
    name: '云游图鉴 / 符文罗盘'
  })
  expect(
    resolvePatchAssetIdentity(section, {
      ...empty(),
      items: { 3865: { name: '客户端图鉴' }, 3866: { name: '客户端罗盘' } }
    })
  ).toEqual({ kind: 'item-group', ids: [3865, 3866], name: '客户端图鉴 / 客户端罗盘' })
  expect(
    resolvePatchAssetIdentity(section, { ...empty(), items: { 3865: { name: '客户端图鉴' } } })
  ).toMatchObject({ name: '客户端图鉴 / 符文罗盘' })
  expect(resolvePatchAssetIdentity(section, { ...empty(), locale: 'en' })).toMatchObject({
    name: 'World Atlas / Runic Compass'
  })
  expect(resolvePatchAssetIdentity(section, empty())).not.toHaveProperty('id')
  expect(resolvePatchAssetIdentity(section, empty())).not.toHaveProperty('iconPath')
})
