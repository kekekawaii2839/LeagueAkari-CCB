import type { PatchNotes } from '@shared/shards/member-analysis/patch-notes'

import { reviewedPatchMechanic } from './patch-change-mechanics'
import {
  canonicalPatchExpression,
  comparePatchExpressions,
  negativePatchMetrics,
  positivePatchMetrics
} from './patch-change-metrics'

type Entry = PatchNotes['sections'][number]['entries'][number]
export type PatchChange = 'buff' | 'nerf' | 'adjusted' | 'introduced' | 'unchanged' | 'unknown'
type DirectionSummary =
  | 'buff'
  | 'nerf'
  | 'adjusted'
  | 'buff-nerf'
  | 'buff-adjusted'
  | 'nerf-adjusted'
  | 'buff-nerf-adjusted'
type KnownSummary = DirectionSummary | 'introduced' | `${DirectionSummary}-introduced`
export type PatchSummary = KnownSummary | 'unchanged' | 'unknown' | `${KnownSummary}-unknown`

// Accept positive additive formulas, not arbitrary prose or subtraction. Changed
// units/structure and crossing power curves cannot establish a single direction.
const number = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`
const ranks = `${number}(?:%?\\s*[/–—-]\\s*${number})*`

/** Direction of explicit numbers, not an overall strength rating. */
export function patchChange(entry: Entry, category: string, sectionHeading = ''): PatchChange {
  // Display policy: fixes are neutral adjustments, even when their gameplay
  // effect could be directional. This does not invent an old numerical value.
  if (
    /\bbug\s*fix(?:es)?\b/i.test([sectionHeading, entry.label, entry.ability].join(' ')) ||
    /^\s*(?:\[bug\s*fix\]|bug\s*fix\b|fixed\b)/i.test(entry.text) ||
    /\bfixing (?:that |this |a )?bug\b/i.test(entry.text)
  )
    return 'adjusted'
  const mechanic = reviewedPatchMechanic(entry, category)
  if (mechanic) return mechanic
  if (entry.after && /^unchanged$/i.test(entry.after.trim())) return 'unchanged'
  if (entry.before && entry.after && entry.before.trim() === entry.after.trim()) return 'unchanged'
  if (!entry.label || !entry.before || !entry.after) return 'unknown'
  let label = entry.label
    .trim()
    .toLowerCase()
    .replace(/^[qwer]\s+(?:-\s*)?/, '')
    .replace(/^(base )?ad(?= growth|$)/, '$1attack damage')
    .replace(/\s*\((?:seconds?|gold)\)$/, '')
  // A skill's "Mana" is its cost, not the champion's mana pool. Base
  // stats/items retain resource semantics; absent context must not guess.
  if (label === 'mana' && category === 'champion' && /^[QWER](?:\s|$)/i.test(entry.ability ?? ''))
    label = 'mana cost'
  if (category === 'champion' && entry.ability === 'Base Stats') {
    if (label === 'ar') label = 'armor'
    if (label === 'as') label = 'attack speed'
  }
  // Damage lost to minions is a penalty, not damage dealt.
  if (label === 'first stack damage against minions') {
    const penalty = /^(\d+(?:\.\d+)?)% Less$/i
    const a = penalty.exec(entry.before),
      b = penalty.exec(entry.after)
    if (a && b) return comparePatchExpressions(a[1], b[1], -1, true)
  }
  // Reviewed mechanic transitions, not a blanket "removed = nerf" rule.
  // Removing small-monster targeting prevents Mounting Dread being wasted;
  // removing slow stacking takes power away from Arc of Judgement.
  if (label === 'slow stacking') {
    const states = ['no longer stacks with other slows', 'stacks with other slows']
    const before = states.indexOf(entry.before.toLowerCase()),
      after = states.indexOf(entry.after.toLowerCase())
    return before < 0 || after < 0
      ? 'unknown'
      : before === after
        ? 'unchanged'
        : after > before
          ? 'buff'
          : 'nerf'
  }
  if (label === 'small monster targeting' && entry.ability === 'E - Mounting Dread') {
    return entry.before === 'Enabled' && entry.after === 'Removed' ? 'buff' : 'unknown'
  }
  if (label === 'critical strike damage reduction') {
    const signed = /^-(\d+(?:\.\d+)?)%$/
    const before = signed.exec(entry.before),
      after = signed.exec(entry.after)
    if (before && after) {
      const delta = Number(before[1]) - Number(after[1])
      return delta > 0 ? 'buff' : delta < 0 ? 'nerf' : 'unchanged'
    }
  }
  if (
    label === 'sabotage duration' &&
    /^\d+(?:\.\d+)?s$/.test(entry.before) &&
    entry.after === 'Infinite'
  )
    return 'buff'
  if (label === 'minion damage modifier' && entry.after === 'Removed') {
    const curve = /^(\d+(?:\s*\/\s*\d+)*)%$/.exec(entry.before)
    if (
      curve &&
      curve[1]
        .split('/')
        .map(Number)
        .every((value) => value === 100)
    )
      return 'unchanged'
    if (
      curve &&
      curve[1]
        .split('/')
        .map(Number)
        .every((v) => v > 0 && v <= 100) &&
      curve[1]
        .split('/')
        .map(Number)
        .some((v) => v < 100)
    )
      return 'buff'
  }
  if (label === 'number of strikes') {
    const parse = (value: string) => /^(\d+) \+ (\d+) per (\d+)% bonus Attack Speed$/.exec(value)
    const a = parse(entry.before),
      b = parse(entry.after)
    if (a && b && Number(a[3]) > 0 && Number(b[3]) > 0) {
      return comparePatchExpressions(
        `${a[1]} + ${Number(a[2]) / Number(a[3])}`,
        `${b[1]} + ${Number(b[2]) / Number(b[3])}`,
        1,
        false
      )
    }
  }
  if (label === 'bonus attack damage per stack') {
    const branches = /^(\d+(?:\.\d+)?) Melee \/ (\d+(?:\.\d+)?) Ranged$/.exec(entry.after)
    if (branches && /^\d+(?:\.\d+)?$/.test(entry.before))
      return comparePatchExpressions(
        `${entry.before} + ${entry.before}`,
        `${branches[1]} + ${branches[2]}`,
        1,
        false
      )
  }
  if (label === 'basic ability cooldown refund') {
    const parse = (value: string) =>
      /^(\d+(?:\.\d+)?)%(?: per stack)?, increased by up to (\d+(?:\.\d+)?)% based on Q Channel$/.exec(
        value
      )
    const a = parse(entry.before),
      b = parse(entry.after)
    if (a && b) {
      // Same per-stack refund throughout the channel. The source omits the
      // repeated "per stack" after the arrow; compare start AND full channel,
      // not refund percent and amplification percent as independent benefits.
      const curve = (m: RegExpExecArray) => `${m[1]}% + ${Number(m[1]) * (1 + Number(m[2]) / 100)}%`
      return comparePatchExpressions(curve(a), curve(b), 1, false)
    }
  }
  // Equivalent source annotations do not change the underlying formula.
  const normalizeFormula = (value: string) => {
    let withoutAnnotation = value
      .replace(/\s*\((?:based on (?:champion )?level|both level based)\)/gi, '')
      .trim()
    // Unit/alias normalization does not erase sources or scaling bases.
    withoutAnnotation = withoutAnnotation.replace(/\s+at all ranks$/i, '')
    if (label === 'monster damage modifier')
      withoutAnnotation = withoutAnnotation.replace(/ against Monsters$/i, '')
    if (label === 'remaining recharge time reduction from autos')
      withoutAnnotation = withoutAnnotation.replace(/ \(based on critical strike chance\)$/i, '')
    if (label === 'ability power ratio')
      withoutAnnotation = withoutAnnotation.replace(
        / \(It is already 100% in Arena, so this is standardizing the value\)$/,
        ''
      )
    if (label === 'unique - shadow')
      withoutAnnotation = withoutAnnotation.replace(/ Magic Damage On-Hit$/i, '')
    if (label === 'damage reduction on enemy hit') {
      const match =
        /^-(\d+(?:\.\d+)?)%(?: multiplicatively)?, down to (?:a minimum of )?(\d+)% \(at \d+ hits\)$/.exec(
          withoutAnnotation
        )
      if (match && Number(match[1]) < 100) return `${100 - Number(match[1])}% + ${match[2]}%`
    }
    if (label === 'slow') {
      const match =
        /^(\d+)% for (\d+(?:\.\d+)?) seconds, decaying to (\d+)% after (\d+(?:\.\d+)?) seconds$/.exec(
          withoutAnnotation
        )
      if (match && Number(match[1]) >= Number(match[3]))
        return `${match[1]}% + ${match[2]}s + ${match[3]}% + ${match[4]}s`
    }
    if (label === 'mini-crescendum damage') {
      const match =
        /^(\d+)% AD, decreasing by (\d+(?:\.\d+)?)% AD to a minimum of (\d+)% AD for the (\d+)(?:th|st|nd|rd)\+ chakram$/.exec(
          withoutAnnotation
        )
      if (
        match &&
        Number(match[2]) > 0 &&
        Number(match[2]) < 100 &&
        Math.ceil((Number(match[1]) - Number(match[3])) / Number(match[2])) + 1 === Number(match[4])
      )
        return `${match[1]}% AD + ${100 - Number(match[2])}% + ${match[3]}% AD`
    }
    if (/^(?:super scorcher|flap flap flap) bonus magic damage$/.test(label)) {
      const match = new RegExp(
        `^(${ranks})% \\(\\+(${ranks})% with IE\\) of Dragon Practice Stacks, scaling with Crit Chance$`,
        'i'
      ).exec(withoutAnnotation)
      return match ? `${match[1]}% + ${match[2]}%` : withoutAnnotation
    }
    if (label === 'ranged mod') {
      const match = new RegExp(
        `^(${number})% of Value \\((${number})% Attack Speed, (${number})% Move Speed\\)$`,
        'i'
      ).exec(withoutAnnotation)
      return match ? `${match[1]}% + ${match[2]}% + ${match[3]}%` : withoutAnnotation
    }
    if (/^scaling level \d+-\d+$/.test(label)) {
      const match = new RegExp(`^\\(\\+(${number})/lvl\\)$`, 'i').exec(withoutAnnotation)
      return match ? `${match[1]}/Level` : withoutAnnotation
    }
    // This named output has separate melee/ranged curves. Validate both bases
    // and lethality coefficients before comparing them component by component;
    // never flatten arbitrary prose or sum the two curves.
    if (label === 'shaped charge damage') {
      const branches = new RegExp(
        `^(${number}) Melee \\+ (${number})/Lethality / (${number}) Ranged \\+ (${number})/Lethality$`,
        'i'
      ).exec(withoutAnnotation)
      return branches ? branches.slice(1).join(' + ') : withoutAnnotation
    }
    // Sion R states base and ratio amplification separately before the change,
    // then one shared range afterwards. Expand only this explicit metric; do
    // not drop either component or compare unrelated prose as raw numbers.
    if (label === 'damage increase over the first 3s of channeling') {
      const separate = new RegExp(
        `^\\+(${number})\\s*[-–—]\\s*(${number})% Base Damage, (${number})\\s*[-–—]\\s*(${number})% Ratio Damage$`,
        'i'
      ).exec(withoutAnnotation)
      if (separate) return `${separate[1]} - ${separate[2]}% + ${separate[3]} - ${separate[4]}%`
      const shared = new RegExp(`^\\+(${number})\\s*[-–—]\\s*(${number})%$`).exec(withoutAnnotation)
      if (shared) return `${shared[1]} - ${shared[2]}% + ${shared[1]} - ${shared[2]}%`
    }
    if (label === 'cooldown' || label === 'seed ammo cooldown') {
      return withoutAnnotation.replace(/\s*(?:s|seconds?)$/i, '')
    }
    return label === 'damage increase over channel time'
      ? withoutAnnotation.replace(/^Up to\s+(?=\d)/i, '')
      : withoutAnnotation
  }
  const beforeText = normalizeFormula(entry.before),
    afterText = normalizeFormula(entry.after)
  if (label === 'total magic damage') {
    // A shared duration is a fixed condition, not an extra damage coefficient.
    const duration = / over (\d+(?:\.\d+)?)s$/
    const a = duration.exec(beforeText),
      b = duration.exec(afterText)
    if (a && b && a[1] === b[1])
      return comparePatchExpressions(
        canonicalPatchExpression(beforeText.slice(0, a.index)),
        canonicalPatchExpression(afterText.slice(0, b.index)),
        1,
        false
      )
  }
  if (label === 'retribution') {
    const condition = ', based on % Missing Health'
    if (beforeText.endsWith(condition) && afterText.endsWith(condition))
      return comparePatchExpressions(
        canonicalPatchExpression(beforeText.slice(0, -condition.length)),
        canonicalPatchExpression(afterText.slice(0, -condition.length)),
        1,
        false
      )
  }
  // Explicit output per input ratios: a smaller denominator is a buff when
  // output is beneficial. Keep metric/unit/source identical and denominator > 0.
  if (/^(?:attack speed scaling|passive bonus ad and ap on kill\/takedown)$/.test(label)) {
    const ratio = (value: string) => {
      const canonical = value.replace(/^\((.+)\) as bonus AD and AP$/i, '$1')
      const match =
        /^(\d+(?:\.\d+)?)(%?) per (\d+(?:\.\d+)?)% (AS|bonus Attack Speed from permanent sources)$/i.exec(
          canonical
        )
      return match && Number(match[3]) > 0
        ? {
            output: Number(match[1]),
            input: Number(match[3]),
            unit: match[2],
            basis: match[4].toLowerCase()
          }
        : null
    }
    const before = ratio(beforeText),
      after = ratio(afterText)
    if (!before || !after || before.unit !== after.unit || before.basis !== after.basis)
      return 'unknown'
    const delta = after.output * before.input - before.output * after.input
    return delta > 0 ? 'buff' : delta < 0 ? 'nerf' : 'unchanged'
  }
  const lowerBetter =
    /^(?:(?:base|bonus|total|seed ammo) )?(?:cooldown|mana cost|energy cost|health cost|self damage|cost|total cost|combine cost)$/
  const higherBetter =
    /^(?:(?:base|bonus|total|physical|magic|true|minimum|maximum|kick|collision|blink|detonation|active|on-hit|critical strike|self) )?(?:damage|health|mana|armor|magic resist|magic resistance|attack damage|ability power|attack speed|movement speed|move speed|healing|heal|shield|shield strength|shield amount|range|attack range|health regeneration|mana regeneration|ability haste|lethality)(?: growth| per level| per strike| per stack| (?:bonus health|ap|ad) ratio)?$/
  const registryLabel = label.replace(/attack damage/g, 'ad')
  const sign =
    lowerBetter.test(label) ||
    negativePatchMetrics.has(label) ||
    (label === 'recipe' && /^\d+\s*g$/.test(beforeText) && /^\d+\s*g$/.test(afterText))
      ? -1
      : higherBetter.test(label) ||
          positivePatchMetrics.has(label) ||
          positivePatchMetrics.has(registryLabel) ||
          [
            'onslaught damage',
            'duskwave damage',
            'sentry damage',
            'bonus true damage',
            'damage reduction on enemy hit',
            'mini-crescendum damage'
          ].includes(label) ||
          label === 'shaped charge damage' ||
          label === 'damage increase over the first 3s of channeling' ||
          label === 'damage increase over channel time' ||
          /^(?:(?:passive|active) on hit damage|monster mod|slow duration|empowered root duration|base\/all-out damage reduction|attack damage per bolt|ranged mod)$/.test(
            label
          ) ||
          /^(?:super scorcher|flap flap flap) bonus magic damage$/.test(label) ||
          /^scaling level \d+-\d+$/.test(label) ||
          (label === 'duration' && entry.ability === 'R - Lilting Lullaby') ||
          /^(?:grey|gray) health store based on current health$/.test(label) ||
          /^ability power per \d+% base mana regeneration$/.test(label)
        ? 1
        : 0
  return comparePatchExpressions(
    canonicalPatchExpression(beforeText),
    canonicalPatchExpression(afterText),
    sign,
    lowerBetter.test(label) ||
      negativePatchMetrics.has(label) ||
      ['duration', 'lifesteal', 'life steal', 'move speed', 'slow amount'].includes(label)
  )
}

/** Preserve every observed category, deduplicated in a stable semantic order. */
export function sectionChange(section: PatchNotes['sections'][number]): PatchSummary {
  const changes = new Set(
    section.entries.map((entry) => patchChange(entry, section.category, section.section))
  )
  return (['buff', 'nerf', 'adjusted', 'introduced', 'unknown']
    .filter((change) => changes.has(change as PatchChange))
    .join('-') || (changes.has('unchanged') ? 'unchanged' : 'adjusted')) as PatchSummary
}
