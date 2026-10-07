import type { Asset, FuelLog } from './types'

/**
 * Fuel math. Each fill-up records ONE odometer reading. Miles for a fill-up
 * are the distance since the previous full-tank fill-up with an odometer,
 * and MPG = those miles ÷ every gallon bought over that stretch (including
 * any partial top-ups in between). This is the standard "full-tank" method.
 */

export type FuelFlag = 'no_odometer' | 'odometer_back' | 'odometer_jump' | 'mpg_outlier' | 'price_outlier' | 'same_day'

export const FLAG_LABEL: Record<FuelFlag, string> = {
  no_odometer: 'No odometer',
  odometer_back: 'Odometer went backwards',
  odometer_jump: 'Odometer jumped',
  mpg_outlier: 'Unusual MPG',
  price_outlier: 'Check price',
  same_day: 'Two fill-ups same day',
}
/** Flags worth an admin's attention (same-day fill-ups are often legit). */
export const SERIOUS: FuelFlag[] = ['odometer_back', 'odometer_jump', 'mpg_outlier', 'price_outlier']

export const MAX_INTERVAL_MILES = 3000

export interface FuelRow {
  log: FuelLog
  pricePerGallon: number
  miles: number | null
  /** Gallons used for the MPG calculation (this fill plus partials since the last full one). */
  mpgGallons: number | null
  mpg: number | null
  flags: FuelFlag[]
}

const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function chronological(a: FuelLog, b: FuelLog) {
  return (
    a.filled_on.localeCompare(b.filled_on) ||
    (a.odometer ?? Number.MAX_SAFE_INTEGER) - (b.odometer ?? Number.MAX_SAFE_INTEGER) ||
    a.created_at.localeCompare(b.created_at)
  )
}

/** Derive miles, MPG, price per gallon and data-quality flags for every fill-up. */
export function analyseFuel(logs: FuelLog[]): Map<string, FuelRow> {
  const out = new Map<string, FuelRow>()
  const byAsset = new Map<string, FuelLog[]>()
  for (const l of logs) {
    out.set(l.id, { log: l, pricePerGallon: l.gallons > 0 ? l.total_cost / l.gallons : 0, miles: null, mpgGallons: null, mpg: null, flags: [] })
    if (l.asset_id) {
      const list = byAsset.get(l.asset_id) ?? []
      list.push(l)
      byAsset.set(l.asset_id, list)
    }
  }

  for (const list of byAsset.values()) {
    list.sort(chronological)
    let lastOdo: number | null = null
    let lastFull: number | null = null
    let pending: number | null = null
    let gallonsSince = 0
    const dayCount = new Map<string, number>()
    for (const l of list) dayCount.set(l.filled_on, (dayCount.get(l.filled_on) ?? 0) + 1)

    list.forEach((l) => {
      const row = out.get(l.id)!
      gallonsSince += l.gallons
      if ((dayCount.get(l.filled_on) ?? 0) > 1) row.flags.push('same_day')
      if (l.odometer == null) {
        row.flags.push('no_odometer')
        return
      }
      const back = lastOdo != null && l.odometer < lastOdo
      const jump = lastOdo != null && l.odometer - lastOdo > MAX_INTERVAL_MILES
      if (back || jump) {
        // Two readings in a row that agree with each other mean the odometer really
        // changed (long gap in records, cluster swap): start a new baseline quietly.
        const agrees = pending != null && l.odometer > pending && l.odometer - pending <= MAX_INTERVAL_MILES
        if (!agrees) {
          // A bad reading is never used as a baseline; its gallons roll into the next good interval.
          row.flags.push(back ? 'odometer_back' : 'odometer_jump')
          pending = l.odometer
          return
        }
        lastFull = null
      }
      pending = null
      lastOdo = l.odometer
      if (!l.full_tank) return
      if (lastFull != null) {
        const miles = l.odometer - lastFull
        if (miles > 0 && gallonsSince > 0) {
          row.miles = miles
          row.mpgGallons = gallonsSince
          row.mpg = miles / gallonsSince
        }
      }
      lastFull = l.odometer
      gallonsSince = 0
    })

    // MPG outliers against this truck's own typical MPG.
    const mpgs = list.map((l) => out.get(l.id)!.mpg).filter((x): x is number => x != null)
    const med = mpgs.length >= 5 ? median(mpgs) : null
    if (med) {
      for (const l of list) {
        const r = out.get(l.id)!
        if (r.mpg != null && (r.mpg < med * 0.6 || r.mpg > med * 1.5)) r.flags.push('mpg_outlier')
      }
    }
  }

  // Price outliers against what the fleet paid within a month either side
  // (prices move a lot over a year, so an all-time average would flag normal fills).
  const priced = [...out.values()].filter((r) => r.pricePerGallon > 0).sort((a, b) => a.log.filled_on.localeCompare(b.log.filled_on))
  const day = (iso: string) => Date.parse(iso) / 86_400_000
  let lo = 0
  let hi = 0
  for (const r of priced) {
    const t = day(r.log.filled_on)
    while (day(priced[lo].log.filled_on) < t - 30) lo++
    while (hi < priced.length && day(priced[hi].log.filled_on) <= t + 30) hi++
    const near = priced.slice(lo, hi).filter((x) => x !== r).map((x) => x.pricePerGallon)
    const medP = near.length >= 5 ? median(near) : null
    if (medP && (r.pricePerGallon < medP * 0.8 || r.pricePerGallon > medP * 1.25)) r.flags.push('price_outlier')
  }
  return out
}

export interface FuelSummary {
  fills: number
  gallons: number
  cost: number
  /** Miles across fill-ups with a valid MPG interval. */
  miles: number
  mpg: number | null
  costPerMile: number | null
  pricePerGallon: number | null
  flagged: number
}

export function summarise(rows: FuelRow[]): FuelSummary {
  let gallons = 0
  let cost = 0
  let miles = 0
  let mpgGallons = 0
  let flagged = 0
  for (const r of rows) {
    gallons += r.log.gallons
    cost += r.log.total_cost
    if (r.miles != null && r.mpgGallons != null && !r.flags.includes('mpg_outlier')) {
      miles += r.miles
      mpgGallons += r.mpgGallons
    }
    if (r.flags.some((f) => SERIOUS.includes(f))) flagged++
  }
  return {
    fills: rows.length,
    gallons,
    cost,
    miles,
    mpg: mpgGallons > 0 ? miles / mpgGallons : null,
    costPerMile: miles > 0 && gallons > 0 ? (cost / gallons) / (miles / mpgGallons) : null,
    pricePerGallon: gallons > 0 ? cost / gallons : null,
    flagged,
  }
}

export function vehicleName(log: FuelLog, assetById: Map<string, Asset>): string {
  if (log.asset_id) return assetById.get(log.asset_id)?.label ?? 'Unknown truck'
  return log.vehicle_label ?? 'Other vehicle'
}

/** Most recent odometer on file for a truck (from fill-ups or the asset record). */
export function lastOdometer(assetId: string, logs: FuelLog[], asset?: Asset): number | null {
  let best: number | null = asset?.current_mileage ?? null
  for (const l of logs) if (l.asset_id === assetId && l.odometer != null && (best == null || l.odometer > best)) best = l.odometer
  return best
}
