export type PatchAssetIdentity =
  | { kind: 'item' | 'perk'; id: number; name: string; iconPath?: string }
  | { kind: 'item-group'; ids: readonly number[]; name: string; iconPath?: never }

type NamedAsset = { name: string; iconPath?: string }
type SourceSection = { category: string; title: string; entityKey: string | null }
type IdentityResources = {
  locale: string
  items: Readonly<Record<number, NamedAsset>>
  perks: Readonly<Record<number, NamedAsset>>
  itemDisplay: (id: number) => NamedAsset | null
  perkDisplay: (id: number) => NamedAsset | null
}

export const normalizePatchAssetName = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9\p{L}]/gu, '')

// Public Riot game-resource names, not translations inferred from article prose.
// IDs and names verified in 16.16.1/data/{en_US,zh_CN}/{item,runesReforged}.json;
// Stormrazor's ID changed: 3097 in 16.16.1, 3095 in 16.17.1 and 16.21.1.
// Both catalog generations are supported without mistaking a Deprecated item.
// the two pre-existing 26.21 aliases also verified in that patch's item catalog.
// Sunfire Cape is the SR article's legacy title: its Hollow Radiance comparison
// and 600g -> 700g combine cost identify 3068, NOT Classic's same-name 773068.
// Keep this context-specific alias distinct from a generic catalog-name join.
const knownAssets = [
  { kind: 'item', id: 3006, en: "Berserker's Greaves", zh: '狂战士胫甲' },
  { kind: 'item', id: 3071, en: 'Black Cleaver', zh: '黑色切割者' },
  { kind: 'item', id: 6692, en: 'Eclipse', zh: '星蚀' },
  { kind: 'item', id: 3085, en: "Runaan's Hurricane", zh: '卢安娜的飓风' },
  { kind: 'item', id: 3053, en: "Sterak's Gage", zh: '斯特拉克的挑战护手' },
  { kind: 'item', id: 6610, en: 'Sundered Sky', zh: '焚天' },
  { kind: 'item', id: 3068, en: 'Sunfire Aegis', zh: '日炎圣盾', aliases: ['Sunfire Cape'] },
  { kind: 'item', id: 3173, en: 'Chainlaced Crushers', zh: '带链碾碎者' },
  { kind: 'item', id: 3175, en: "Spellslinger's Shoes", zh: '灵能使之靴' },
  { kind: 'item', id: 3077, en: 'Tiamat', zh: '提亚马特' },
  { kind: 'item', id: 3008, en: 'Gluttonous Greaves', zh: '暴食胫甲' },
  { kind: 'item', id: 2520, en: 'Bastionbreaker', zh: '破垒者', aliases: ['Bastion Breaker'] },
  { kind: 'perk', id: 8021, en: 'Fleet Footwork', zh: '迅捷步法' },
  { kind: 'perk', id: 9923, en: 'Hail of Blades', zh: '丛刃' },
  { kind: 'item', id: 1120, en: "Doran's Helm", zh: '多兰之盔' },
  { kind: 'item', id: 4005, en: 'Imperial Mandate', zh: '帝国指令' },
  { kind: 'item', id: 3168, en: 'Immortal Path', zh: '不朽之路' },
  { kind: 'item', id: 2525, en: 'Protoplasm Harness', zh: '原生质护带' },
  { kind: 'item', id: 3152, en: 'Hextech Rocketbelt', zh: '海克斯科技火箭腰带' },
  { kind: 'item', id: 3302, en: 'Terminus', zh: '界弓' },
  { kind: 'item', id: 3032, en: 'Yun Tal Wildarrows', zh: '育恩塔尔荒野箭' },
  { kind: 'perk', id: 8316, en: 'Jack Of All Trades', zh: '多面手' },
  { kind: 'item', id: 3095, alternateIds: [3097], en: 'Stormrazor', zh: '岚切' },
  { kind: 'item', id: 3124, en: "Guinsoo's Rageblade", zh: '鬼索的狂暴之刃' },
  { kind: 'item', id: 3073, en: 'Experimental Hexplate', zh: '海克斯注力刚壁' },
  { kind: 'item', id: 6621, en: 'Dawncore', zh: '黎明核心' },
  { kind: 'item', id: 6697, en: 'Hubris', zh: '狂妄' },
  { kind: 'item', id: 3865, en: 'World Atlas', zh: '云游图鉴' },
  { kind: 'item', id: 3866, en: 'Runic Compass', zh: '符文罗盘' }
] as const

export function resolvePatchAssetIdentity(
  section: SourceSection,
  resources: IdentityResources
): PatchAssetIdentity | null {
  if (
    section.category === 'item' &&
    normalizePatchAssetName(section.title) === 'worldatlasandruniccompass'
  ) {
    const identities = ['World Atlas', 'Runic Compass'].map((title) =>
      resolvePatchAssetIdentity({ category: 'item', title, entityKey: null }, resources)
    )
    if (
      identities.every(
        (identity): identity is Extract<PatchAssetIdentity, { id: number }> =>
          identity !== null && identity.kind === 'item'
      )
    ) {
      return {
        kind: 'item-group',
        ids: identities.map((identity) => identity.id),
        name: identities.map((identity) => identity.name).join(' / ')
      }
    }
    return null
  }
  const kind = section.category === 'item' ? 'item' : section.category === 'system' ? 'perk' : null
  if (!kind) return null
  const key = normalizePatchAssetName(section.title)
  const byName = knownAssets.find(
    (asset) =>
      asset.kind === kind &&
      [asset.en, ...('aliases' in asset ? asset.aliases : [])].some(
        (name) => normalizePatchAssetName(name) === key
      )
  )
  const catalog = kind === 'item' ? resources.items : resources.perks
  const numericKey =
    section.entityKey && /^\d+$/.test(section.entityKey) ? Number(section.entityKey) : null
  // A current English-client name can resolve a source not in the reviewed
  // bilingual fallback list. Never match substrings or infer a translated name.
  const catalogMatch = Object.entries(catalog).find(
    ([, asset]) => normalizePatchAssetName(asset.name) === key
  )
  // Reviewed SR title identities override presentation-only portraits: Riot's
  // articles sometimes reuse Arena icons. Stormrazor additionally has two
  // verified catalog generations; 3095 is retired only in the older one.
  const candidateIds = byName
    ? [byName.id, ...('alternateIds' in byName ? byName.alternateIds : [])]
    : []
  const isRetired = (name: string | undefined) =>
    /^(?:Deprecated item|已弃用的装备)$/i.test(name?.trim() ?? '')
  const displayFor = kind === 'item' ? resources.itemDisplay : resources.perkDisplay
  const clientCandidate = candidateIds.find(
    (id) => catalog[id]?.name && !isRetired(catalog[id].name)
  )
  const providerCandidate = candidateIds.find((id) => {
    const display = displayFor(id)
    return display?.name && !isRetired(display.name)
  })
  const id =
    clientCandidate ??
    providerCandidate ??
    byName?.id ??
    numericKey ??
    (catalogMatch ? Number(catalogMatch[0]) : null)
  if (!id || !Number.isSafeInteger(id) || id < 1) return null
  const known = byName ?? knownAssets.find((asset) => asset.kind === kind && asset.id === id)
  const client = catalog[id]
  const display = kind === 'item' ? resources.itemDisplay(id) : resources.perkDisplay(id)
  const fallback = known ? (/^zh[-_]CN$/i.test(resources.locale) ? known.zh : known.en) : null
  // Name-only LCU data remains authoritative even if its tooltip/icon has not
  // loaded, which makes provider.display unavailable. Fallback is offline-only.
  const name =
    (!isRetired(client?.name) && client?.name) ||
    (!isRetired(display?.name) && display?.name) ||
    fallback
  const iconPath =
    (!isRetired(client?.name) && client?.iconPath) ||
    (!isRetired(display?.name) && display?.iconPath) ||
    undefined
  return name ? { kind, id, name, iconPath } : null
}
