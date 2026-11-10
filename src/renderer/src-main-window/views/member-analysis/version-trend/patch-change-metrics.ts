// Explicit output metrics reviewed against Riot's public 26.12–26.21 notes.
// Do not infer polarity from a suffix such as "damage" (self damage exists).
export const positivePatchMetrics = new Set([
  'sweet spot bonus damage',
  'ability power healing ratio',
  'ability power ratio',
  'ability power slow ratio',
  'armor and magic resistance',
  'attack speed ratio',
  'attack speed to ability haste conversion',
  'base ability power ratio',
  'base damage (x3 attacks)',
  'base damage - nail',
  'base damage per snip',
  'basic attack damage modifier',
  'bonus armor and magic resistance',
  'bonus attack damage ratio',
  'bonus resistances',
  'caustic wounds',
  'critical strike damage modifier',
  'damage increase per stack',
  'damage increase while above 50% maximum health',
  'damage per hit',
  'damage per meep',
  'damage reduction ability power ratio',
  'damage taken grey health cap',
  'empowered on-hit damage',
  'enhanced ability power ratio',
  'evolved range bonus',
  'evolved slow duration',
  'fervor move speed',
  'first lash damage',
  'flux bonus damage',
  'grey health base value',
  'heal amount',
  'heal per bonus health',
  'heal per tick',
  'heal range',
  'healing on champions',
  'healing, shielding, and regeneration increase while below 50% maximum health',
  'health heal ratio',
  'initial damage',
  'life steal',
  'lifesteal',
  'lightning on-hit damage',
  'magic penetration',
  'mark / root damage',
  'mark base bonus damage',
  'maximum epic monster stacks',
  'maximum heal',
  'min damage',
  'minion / monster modifier',
  'minion damage modifier',
  'minion/monster maximum health cap',
  'monster bonus physical damage',
  'monster cap',
  'monster damage',
  'monster damage cap',
  'monster damage modifier',
  'moonshot damage',
  'move speed bonus',
  'nail damage',
  'nail recast hold time',
  'on champ kill ad and ap',
  'on non-champ kill ad and ap',
  'on non-champ kill as',
  'outer cone bonus damage',
  'overheat attack speed',
  'passive magic damage on-hit',
  'passive mark damage',
  'passive true damage',
  'q2 damage',
  'qe slow',
  'qq damage',
  'qw damage',
  'remaining recharge time reduction from autos',
  'reset time window',
  'return damage',
  'return damage ability power ratio',
  'rift duration',
  'rq1 / re1 damage',
  'rw damage',
  'seething strike stack duration',
  'sleep duration',
  'slow',
  'soul drop chance (ally kill)',
  'soul drop chance (senna kill)',
  'splinter mana',
  'stat steal',
  'stolen stats',
  't3 attack speed',
  'target max health damage',
  'target maximum health monster cap',
  'three nails damage',
  'total armor and magic resistance',
  'unique - command',
  'unique - control',
  'unique - shadow',
  'wall damage',
  "wind's fury bolt damage"
])

export const negativePatchMetrics = new Set([
  'active cooldown',
  'duskwave cooldown',
  'mana cost per second',
  'attack cast time',
  'time between casts',
  'post-cast lockout'
])

export function canonicalPatchExpression(value: string) {
  return value
    .replace(/(\d)(s|g)\b/gi, '$1 $2')
    .replace(/\bAttack Damage\b/gi, 'AD')
    .replace(/\bAbility Power\b/gi, 'AP')
    .replace(/\btAD\b/g, 'total AD')
    .replace(/\b(?:Max HP|Max Health)\b/gi, 'Maximum Health')
    .replace(/\bHP\b/gi, 'Health')
    .replace(/\bseconds?\b/gi, 's')
    .replace(/%\s*([/–—-])\s*(?=\d)/g, '$1')
    .replace(/^\+\s*(?=\d)/, '')
    .replace(/\(\s*(?=\d)/g, '(+')
    .replace(/per (\d+)% per Crit Chance/gi, 'per $1% Crit Chance')
    .replace(/\b(minimum(?: damage)?)\s*\/\s*(?=\d)/gi, '$1 + ')
    .trim()
}

/** Same non-negative inputs and same units, componentwise dominance only.
 * Shared conditions are held fixed; denominators never become output values.
 * No arbitrary prose, negative coefficients, products, changed bases or guessed
 * conversions. A successful parse alone is not a claim of an overall win-rate effect.
 */
export function comparePatchExpressions(
  before: string,
  after: string,
  sign: number,
  uniform: boolean
) {
  const numeric = /\d+(?:\.\d+)?|\.\d+/g
  const stripSharedNotes = (left: string, right: string) => {
    // These are explanatory level/source annotations, not formula operands.
    const notes =
      /\s*\((?:Levels?\s+\d+\s*[-–—]\s*\d+|Champion Level|based on critical strike chance|Halved for Magic Damage|reduced to 75% value for Magic Damage in Arena)\)/gi
    return left.replace(notes, (note) =>
      right.toLowerCase().includes(note.toLowerCase()) ? '' : note
    )
  }
  const rawBefore = before,
    rawAfter = after
  before = stripSharedNotes(rawBefore, rawAfter)
  after = stripSharedNotes(rawAfter, rawBefore)
  // A fixed condition or multiplier is not an independently changed output.
  for (const suffix of [
    ', twice',
    ', doubled below 40% Maximum Health',
    ", increased by up to 100% based on Sylas' missing health"
  ]) {
    if (before.endsWith(suffix) && after.endsWith(suffix)) {
      before = before.slice(0, -suffix.length)
      after = after.slice(0, -suffix.length)
    }
  }
  if (before.endsWith(' for 2 s') && after.endsWith(' for 2 s')) {
    before = before.slice(0, -8)
    after = after.slice(0, -8)
    if (/^\d+$/.test(before) && /^\[\d+ Melee \|\| \d+ Ranged\]$/.test(after))
      before = `[${before} Melee || ${before} Ranged]`
  }
  const safe = (value: string) => {
    if (/^\s*-|\b(?:undefined|NaN|Infinity)\b/.test(value)) return false
    // Level bounds are input domains. Only identical annotations were removed
    // above; a changed/unpaired level horizon must never count as extra output.
    if (/\bLevels?\s+\d/i.test(value)) return false
    // Minus is only a range delimiter, never unary negation/subtraction.
    const withoutRanges = value
      .replace(/post-mitigation/gi, '')
      .replace(/(\d+(?:\.\d+)?|\.\d+)\s*[-–—]\s*(\d+(?:\.\d+)?|\.\d+)/g, '$1 $2')
    if (/[-–—]/.test(withoutRanges)) return false
    // Slash is a rank-list separator or the /Level growth unit, not division
    // of an output by a changed operand (e.g. "20% AP / 2").
    const withoutRanks = value
      .replace(/(?:\d+(?:\.\d+)?|\.\d+)(?:\s*\/\s*(?:\d+(?:\.\d+)?|\.\d+))+/g, 'RANK')
      .replace(/\/Level\b/gi, '')
    if (withoutRanks.includes('/')) return false
    // Ordered phrases, not free-form words: every remaining number is a
    // non-negative output coefficient or a fixed "per N" input denominator.
    const rest = value.replace(
      /\b(?:Kicked Champion's Health|Sylas' Bonus Health|Target Maximum Health|Target Missing Health|Maximum Health|Missing Health|current health|bonus AD|total AD|base AD|bonus Health|bonus mana|total armor|base armor|bonus armor|total magic resistance|base magic resistance|bonus magic resistance|magic resistance|AD|AP|AS|armor|health|mana|lethality|Melee|Ranged|Level|per prior stack|per (?:\d+(?:\.\d+)?%?\s+)?(?:bonus AD|bonus health|AP|AS|Chimes|Crit Chance|Bonus Crit Damage)|per Feast|increased damage|Dmg per attack|post-mitigation|capped to|increased to(?: up to)?|to|minimum damage|maximum damage|minimum|maximum|of his Total AS|of Base AD|of target's missing health|true damage|Minion|Monster|s|g|gold|Vulnerable|AH For Immobilizing Abilities|Base AD)\b/gi,
      ''
    )
    return /^[\d\s.%+()\[\]|/,–—-]+$/.test(rest)
  }
  if (!safe(before) || !safe(after) || !sign) return 'unknown' as const
  const denominators = (value: string) =>
    [...value.matchAll(/\bper\s+(\d+(?:\.\d+)?)/gi)].map((m) => m[1])
  if (JSON.stringify(denominators(before)) !== JSON.stringify(denominators(after)))
    return 'unknown' as const
  const descending = (value: string) =>
    [...value.matchAll(/(\d+(?:\.\d+)?|\.\d+)\s*[-–—]\s*(\d+(?:\.\d+)?|\.\d+)/g)].some(
      (m) => Number(m[1]) > Number(m[2])
    )
  if (descending(before) || descending(after)) return 'unknown' as const
  const group = /\d+(?:\.\d+)?|\.\d+/
  const groups = new RegExp(`(?:${group.source})(?:\\s*[/–—-]\\s*(?:${group.source}))*`, 'g')
  const skeleton = (value: string) => value.replace(groups, '#').replace(/\s+/g, '').toLowerCase()
  // An added positive additive term is a dominance change, not a changed basis.
  if (skeleton(before) !== skeleton(after)) {
    const added = (value: string) => {
      // Only fully specified additive scaling terms, not arbitrary expressions.
      const term =
        /^(?:\s*\(\+\s*(\d+(?:\.\d+)?|\.\d+)%\s+(?:(?:bonus|total|base)\s+)?(?:AD|AP|Health|mana)\s*\))+$/i
      return term.test(value) && (value.match(numeric) ?? []).some((v) => Number(v) > 0)
    }
    if (after.startsWith(before + ' (+') && added(after.slice(before.length)))
      return sign > 0 ? ('buff' as const) : ('nerf' as const)
    if (before.startsWith(after + ' (+') && added(before.slice(after.length)))
      return sign > 0 ? ('nerf' as const) : ('buff' as const)
    return 'unknown' as const
  }
  const left = [...before.matchAll(groups)].map((m) => m[0]),
    right = [...after.matchAll(groups)].map((m) => m[0])
  if (!left.length || left.length !== right.length) return 'unknown' as const
  const changes: number[] = []
  for (let i = 0; i < left.length; i++) {
    const a = (left[i].match(numeric) ?? []).map(Number),
      b = (right[i].match(numeric) ?? []).map(Number)
    const count = Math.max(a.length, b.length)
    const kind = (value: string) =>
      value.includes('/') ? 'rank' : /[-–—]/.test(value) ? 'range' : 'scalar'
    if (a.length > 1 && b.length > 1 && (a.length !== b.length || kind(left[i]) !== kind(right[i])))
      return 'unknown' as const
    if (a.length !== b.length && !(left.length > 1 || uniform)) return 'unknown' as const
    for (let j = 0; j < count; j++)
      changes.push((b[b.length === 1 ? 0 : j] - a[a.length === 1 ? 0 : j]) * sign)
  }
  return changes.some((v) => v > 0) && changes.every((v) => v >= 0)
    ? ('buff' as const)
    : changes.some((v) => v < 0) && changes.every((v) => v <= 0)
      ? ('nerf' as const)
      : changes.every((v) => v === 0)
        ? ('unchanged' as const)
        : ('adjusted' as const)
}
