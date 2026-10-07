import type { Asset, WorkOrder } from './types'
import { daysBetween, todayISO } from './format'

/**
 * Repeat-failure detection. In the old equipment log, "For now" / "I think so"
 * answers and the same fault showing up again and again (Dryer 3, ignition
 * faults) were the clearest signal of where money and downtime were going.
 */

const STOP = new Set(['the', 'and', 'on', 'in', 'of', 'a', 'an', 'to', 'is', 'was', 'not', 'with', 'for', 'at', 'it', 'by', 'from'])

/** Lower-case word set for a problem description ("Buerner High Limit!" → {buerner, high, limit}). */
export function problemWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP.has(w)),
  )
}

/** Two problem descriptions are "the same problem" when most of their words overlap. */
export function similarProblem(a: string, b: string): boolean {
  const A = problemWords(a)
  const B = problemWords(b)
  if (!A.size || !B.size) return false
  let shared = 0
  for (const w of A) if (B.has(w)) shared++
  return shared / Math.min(A.size, B.size) >= 0.6 && shared / Math.max(A.size, B.size) >= 0.4
}

/** One-line, length-capped problem text for alert titles. */
export function shortProblem(text: string, max = 60): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

const isRealProblem = (w: WorkOrder) => w.repair_type !== 'maintenance' && !/^\s*(nothing|none|n\/a|-)\s*$/i.test(w.problem)

export type AlertKind = 'same_problem' | 'frequent' | 'temporary'

export interface RepeatAlert {
  kind: AlertKind
  asset: Asset
  title: string
  detail: string
  workOrders: WorkOrder[]
  /** Most recent date involved, for sorting. */
  latest: string
}

export interface ReliabilityOptions {
  /** Window for "same problem again". */
  sameProblemDays?: number
  /** Window and threshold for "too many breakdowns". */
  frequentDays?: number
  frequentCount?: number
}

export function repeatAlerts(workOrders: WorkOrder[], assets: Asset[], opts: ReliabilityOptions = {}): RepeatAlert[] {
  const { sameProblemDays = 180, frequentDays = 90, frequentCount = 3 } = opts
  const today = todayISO()
  const byAsset = new Map<string, WorkOrder[]>()
  for (const w of workOrders) {
    const list = byAsset.get(w.asset_id) ?? []
    list.push(w)
    byAsset.set(w.asset_id, list)
  }
  const out: RepeatAlert[] = []

  for (const asset of assets) {
    if (asset.retired_at) continue
    const all = (byAsset.get(asset.id) ?? []).slice().sort((a, b) => a.opened_on.localeCompare(b.opened_on) || a.number - b.number)
    if (!all.length) continue
    const problems = all.filter(isRealProblem)

    // 1. Same problem more than once within the window → cluster by similarity.
    const recent = problems.filter((w) => daysBetween(w.opened_on, today) <= sameProblemDays)
    const used = new Set<string>()
    for (const w of recent) {
      if (used.has(w.id)) continue
      const cluster = recent.filter((x) => !used.has(x.id) && similarProblem(w.problem, x.problem))
      if (cluster.length >= 2) {
        cluster.forEach((x) => used.add(x.id))
        const last = cluster[cluster.length - 1]
        const notFixed = last.status === 'done' && (last.resolution === 'temporary' || last.resolution === 'not_fixed')
        out.push({
          kind: 'same_problem',
          asset,
          title: `${asset.label}: “${shortProblem(w.problem)}” ×${cluster.length}`,
          detail: `${cluster.length} times in the last ${Math.round(sameProblemDays / 30)} months${notFixed ? ', and the latest fix was only temporary' : ''} — the fix isn't holding.`,
          workOrders: cluster,
          latest: last.opened_on,
        })
      }
    }

    // 2. A temporary or failed fix with nothing after it that fixed the same problem
    //    (skipped when it's already part of a repeat-problem alert above).
    for (const w of problems) {
      if (used.has(w.id) || problems.some((x) => used.has(x.id) && similarProblem(w.problem, x.problem))) continue
      if (w.status !== 'done' || (w.resolution !== 'temporary' && w.resolution !== 'not_fixed')) continue
      const later = problems.filter((x) => x.opened_on >= w.opened_on && x.id !== w.id && x.number > w.number && similarProblem(w.problem, x.problem))
      if (later.some((x) => x.resolution === 'fixed')) continue
      if (later.length) continue // the newer one carries the story
      out.push({
        kind: 'temporary',
        asset,
        title: `${asset.label}: ${w.resolution === 'not_fixed' ? 'not fixed' : 'temporary fix'} on “${shortProblem(w.problem)}”`,
        detail: `Closed ${w.opened_on}${w.fix ? ` — ${shortProblem(w.fix, 80)}` : ''}. Needs a permanent repair.`,
        workOrders: [w],
        latest: w.opened_on,
      })
    }

    // 3. Too many breakdowns overall.
    const window = problems.filter((w) => daysBetween(w.opened_on, today) <= frequentDays)
    if (window.length >= frequentCount) {
      out.push({
        kind: 'frequent',
        asset,
        title: `${asset.label}: ${window.length} breakdowns in ${frequentDays} days`,
        detail: 'Worth a root-cause look or a repair-vs-replace check.',
        workOrders: window,
        latest: window[window.length - 1].opened_on,
      })
    }
  }

  const rank: Record<AlertKind, number> = { same_problem: 0, temporary: 1, frequent: 2 }
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.latest.localeCompare(a.latest))
}

/** Earlier work orders on the same asset that look like the same problem (newest first). */
export function similarHistory(workOrders: WorkOrder[], assetId: string, problem: string, excludeId?: string): WorkOrder[] {
  if (problemWords(problem).size === 0) return []
  return workOrders
    .filter((w) => w.asset_id === assetId && w.id !== excludeId && similarProblem(problem, w.problem))
    .sort((a, b) => b.opened_on.localeCompare(a.opened_on) || b.number - a.number)
}
