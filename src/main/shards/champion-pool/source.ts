import type {
  LolalyticsBaseline,
  LolalyticsPairReport,
  LolalyticsScope
} from '@shared/shards/member-analysis/champion-pool/lolalytics'
import type {
  DraftRole,
  InteractionMode
} from '@shared/shards/member-analysis/champion-pool/scoring'
import type { AxiosInstance } from 'axios'
import { setTimeout as delay } from 'node:timers/promises'

export const POOL_SOURCE_FILTER = { tier: 'emerald_plus', region: 'all' } as const

const REQUEST_INTERVAL_MS = 500

const lanes = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MID: 'middle',
  ADC: 'bottom',
  SUP: 'support'
} as const
const roles = Object.keys(lanes) as DraftRole[]
// Public Qwik documents are decoded only in main. Never persist HTML/snapshots.
type RecordData = Record<string, any>
export function decodeSnapshot(html: string, kind: 'roster' | 'build') {
  if (html.length > 12 * 1024 * 1024) throw new Error('source-changed')
  const match = html.match(/<script[^>]+type="qwik\/json"[^>]*>([\s\S]*?)<\/script>/)
  if (!match) throw new Error('source-changed')
  const objs = JSON.parse(match[1]).objs
  if (!Array.isArray(objs) || objs.length > 300000) throw new Error('source-changed')
  const unref = (v: unknown): any =>
    typeof v === 'string' && /^[0-9a-z]+$/.test(v) ? objs[parseInt(v, 36)] : v
  const expand = (v: any, depth: number): any => {
    if (depth < 0) throw new Error('source-changed')
    return Array.isArray(v)
      ? v.map((x) => expand(unref(x), depth - 1))
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expand(unref(x), depth - 1)]))
        : v
  }
  const nav = objs.find(
    (o) => o && typeof o === 'object' && o.champion && o.patch && o.page && o.api
  )
  const data = objs.find(
    (o) =>
      o &&
      typeof o === 'object' &&
      (kind === 'roster'
        ? o.fields && o.cid && o.queue && o.avgWr
        : o.header && o.enemy && o.enemy_h)
  )
  const slugs = objs.find(
    (o) => o && typeof o === 'object' && o['412'] && unref(o['412']) === 'thresh'
  )
  if (!nav || !data) throw new Error('source-changed')
  return {
    nav: expand(nav, 8) as RecordData,
    data: expand(data, 14) as RecordData,
    slugs: slugs ? (expand(slugs, 2) as Record<string, string>) : {}
  }
}

function checkNav(nav: RecordData, scope: LolalyticsScope, lane: string) {
  if (
    nav.patch !== scope.patch ||
    nav.tier !== scope.tier ||
    nav.region !== scope.region ||
    nav.mode !== 'ranked' ||
    nav.lane !== lane ||
    nav.status !== 200
  )
    throw new Error('source-changed')
}
export function parsePairTable(header: string[], rows: unknown): LolalyticsPairReport['pairs'] {
  if (!Array.isArray(header) || !Array.isArray(rows) || rows.length > 300)
    throw new Error('source-changed')
  const id = header.indexOf('id'),
    wr = header.indexOf('wr'),
    n = header.indexOf('n')
  if (Math.min(id, wr, n) < 0) throw new Error('source-changed')
  const seen = new Set<number>()
  return rows.map((row) => {
    if (
      !Array.isArray(row) ||
      !Number.isSafeInteger(row[id]) ||
      row[id] <= 0 ||
      seen.has(row[id]) ||
      !Number.isSafeInteger(row[n]) ||
      row[n] < 0 ||
      !Number.isFinite(row[wr]) ||
      row[wr] < 0 ||
      row[wr] > 100
    )
      throw new Error('source-changed')
    seen.add(row[id])
    return { championId: row[id], games: row[n], reportedWinRate: row[wr] / 100 }
  })
}
export interface SourceCatalog {
  scope: LolalyticsScope
  baselines: LolalyticsBaseline[]
  slugs: Record<string, string>
}
export interface PoolSource {
  catalog(role: DraftRole, signal: AbortSignal): Promise<SourceCatalog>
  reports(
    catalog: SourceCatalog,
    role: DraftRole,
    championId: number,
    signal: AbortSignal
  ): Promise<LolalyticsPairReport[]>
}

export class LolalyticsPoolSource implements PoolSource {
  private _nextRequestAt = 0

  constructor(private readonly _http: AxiosInstance) {}
  private async _get(url: string, signal: AbortSignal): Promise<string> {
    // Space request starts across all in-flight heroes, not just within each hero.
    while (true) {
      signal.throwIfAborted()
      const now = performance.now()
      const remaining = this._nextRequestAt - now
      if (remaining <= 0) {
        this._nextRequestAt = now + REQUEST_INTERVAL_MS
        break
      }
      await delay(Math.ceil(remaining), undefined, { signal })
    }
    // Fixed source URLs only; no renderer URL, credentials, redirects or persistent HTTP cache.
    const response = await this._http.get<string>(url, {
      signal,
      responseType: 'text',
      timeout: 25000,
      fetchOptions: { redirect: 'error' },
      headers: { 'Cache-Control': 'no-cache' }
    })
    signal.throwIfAborted()
    if (typeof response.data !== 'string' || response.data.length > 12 * 1024 * 1024)
      throw new Error('source-changed')
    return response.data
  }
  async catalog(role: DraftRole, signal: AbortSignal): Promise<SourceCatalog> {
    const url = 'https://lolalytics.com/lol/tierlist/'
    const { tier, region } = POOL_SOURCE_FILTER
    const discovery = decodeSnapshot(
      await this._get(`${url}?lane=${lanes[role]}&tier=${tier}&region=${region}`, signal),
      'roster'
    )
    const patch = discovery.nav.patch
    if (typeof patch !== 'string' || !/^\d+\.\d+$/.test(patch)) throw new Error('source-changed')
    const scope: LolalyticsScope = {
      source: 'lolalytics',
      patch,
      tier,
      region,
      queueId: 420
    }
    checkNav(discovery.nav, scope, lanes[role])
    const baselines: LolalyticsBaseline[] = [],
      slugs: Record<string, string> = {}
    for (const ownRole of roles) {
      const lane = lanes[ownRole]
      const snapshot =
        ownRole === role
          ? discovery
          : decodeSnapshot(
              await this._get(
                `${url}?lane=${lane}&tier=${tier}&patch=${patch}&region=${region}`,
                signal
              ),
              'roster'
            )
      checkNav(snapshot.nav, scope, lane)
      if (
        snapshot.data.queue !== 420 ||
        !snapshot.data.cid ||
        typeof snapshot.data.cid !== 'object'
      )
        throw new Error('source-changed')
      const rows = Object.entries(snapshot.data.cid).map(([id, row]) => ({
        id: Number(id),
        ...(row as RecordData)
      })) as RecordData[]
      if (
        !rows.length ||
        rows.length > 300 ||
        rows.some(
          (r) =>
            !Number.isSafeInteger(r.id) ||
            r.id <= 0 ||
            r.lane !== lane ||
            !Number.isSafeInteger(r.games) ||
            r.games < 0 ||
            !Number.isFinite(r.wr) ||
            r.wr < 0 ||
            r.wr > 100
        )
      )
        throw new Error('source-changed')
      const total = rows.reduce((s, r) => s + r.games, 0)
      if (total <= 0) throw new Error('source-changed')
      Object.assign(slugs, snapshot.slugs)
      baselines.push(
        ...rows.map((r) => ({
          scope,
          championId: r.id,
          role: ownRole,
          games: r.games,
          reportedWinRate: r.wr / 100,
          pickRate: r.games / total,
          pickRateDenominator: 'same-role-games' as const
        }))
      )
    }
    return { scope, baselines, slugs }
  }
  async reports(catalog: SourceCatalog, role: DraftRole, championId: number, signal: AbortSignal) {
    const slug = catalog.slugs[String(championId)],
      { patch, tier, region } = catalog.scope,
      lane = lanes[role]
    if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) throw new Error('source-changed')
    const build = decodeSnapshot(
      await this._get(
        `https://lolalytics.com/lol/${slug}/build/?lane=${lane}&tier=${tier}&patch=${patch}&region=${region}`,
        signal
      ),
      'build'
    )
    checkNav(build.nav, catalog.scope, lane)
    const h = build.data.header
    if (
      build.nav.champion !== slug ||
      !h ||
      h.cid !== championId ||
      h.patch !== patch ||
      h.lane !== lane ||
      h.queue !== 420
    )
      throw new Error('source-changed')
    const host = build.nav.api?.build
    if (typeof host !== 'string' || !/^a\d+$/.test(host)) throw new Error('source-changed')
    const team = JSON.parse(
      await this._get(
        `https://${host}.lolalytics.com/mega/?ep=build-team&v=1&patch=${patch}&c=${slug}&lane=${lane}&tier=${tier}&queue=ranked&region=${region}`,
        signal
      )
    )
    if (team.response?.valid !== true) throw new Error('source-changed')
    const reports: LolalyticsPairReport[] = []
    for (const mode of ['matchup', 'synergy'] as InteractionMode[])
      for (const otherRole of roles) {
        if (mode === 'synergy' && otherRole === role) continue
        reports.push({
          scope: catalog.scope,
          championId,
          ownRole: role,
          mode,
          otherRole,
          pairs: parsePairTable(
            mode === 'matchup' ? build.data.enemy_h : team.team_h,
            mode === 'matchup'
              ? build.data.enemy?.[lanes[otherRole]]
              : team.team?.[lanes[otherRole]]
          )
        })
      }
    signal.throwIfAborted()
    return reports
  }
}
