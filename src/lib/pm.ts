import type { Asset, PmSchedule } from './types'
import { addDays, daysBetween, todayISO } from './format'

export type PmState = 'overdue' | 'due_soon' | 'ok' | 'never'

export interface PmStatus {
  schedule: PmSchedule
  asset: Asset
  state: PmState
  /** Miles until due (negative = overdue). */
  milesLeft: number | null
  /** Days until due (negative = overdue). */
  daysLeft: number | null
  dueMiles: number | null
  dueDate: string | null
}

const SOON_MILES = 500
const SOON_DAYS = 14

/**
 * A schedule is overdue when either its mileage or its date interval has passed.
 * Never-done schedules with no baseline are reported as "never" so they still
 * show up as needing attention.
 */
export function pmStatus(schedule: PmSchedule, asset: Asset, today = todayISO()): PmStatus {
  let milesLeft: number | null = null
  let daysLeft: number | null = null
  let dueMiles: number | null = null
  let dueDate: string | null = null

  if (schedule.interval_miles && asset.kind === 'truck') {
    if (schedule.last_done_miles != null) {
      dueMiles = schedule.last_done_miles + schedule.interval_miles
      if (asset.current_mileage != null) milesLeft = dueMiles - asset.current_mileage
    }
  }
  if (schedule.interval_days) {
    if (schedule.last_done_on) {
      dueDate = addDays(schedule.last_done_on, schedule.interval_days)
      daysLeft = daysBetween(today, dueDate)
    }
  }

  const hasBaseline =
    (schedule.interval_miles ? schedule.last_done_miles != null : false) ||
    (schedule.interval_days ? schedule.last_done_on != null : false)

  let state: PmState = 'ok'
  if (!hasBaseline) state = 'never'
  else if ((milesLeft != null && milesLeft <= 0) || (daysLeft != null && daysLeft <= 0)) state = 'overdue'
  else if ((milesLeft != null && milesLeft <= SOON_MILES) || (daysLeft != null && daysLeft <= SOON_DAYS)) state = 'due_soon'

  return { schedule, asset, state, milesLeft, daysLeft, dueMiles, dueDate }
}

export function allPmStatuses(schedules: PmSchedule[], assets: Asset[]): PmStatus[] {
  const byId = new Map(assets.map((a) => [a.id, a]))
  const order: Record<PmState, number> = { overdue: 0, never: 1, due_soon: 2, ok: 3 }
  return schedules
    .filter((s) => s.active)
    .map((s) => {
      const a = byId.get(s.asset_id)
      return a && !a.retired_at ? pmStatus(s, a) : null
    })
    .filter((x): x is PmStatus => x !== null)
    .sort((a, b) => order[a.state] - order[b.state] || (a.milesLeft ?? a.daysLeft ?? 0) - (b.milesLeft ?? b.daysLeft ?? 0))
}

export const PM_LABEL: Record<PmState, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  ok: 'OK',
  never: 'No baseline',
}
