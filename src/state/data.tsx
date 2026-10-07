import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type {
  Asset, AssetFinancials, Part, PartFit, PmSchedule, Profile, Settings, Vendor,
  WorkOrder, WorkOrderCost, WorkOrderPart, FuelLog,
} from '../lib/types'
import { useAuth } from './auth'

/**
 * Central client cache of every table the signed-in user may read.
 * Initial load pulls each table (paged past PostgREST's 1000-row cap);
 * after that a single realtime channel patches rows in place, so a repair
 * logged on one phone appears on every other device within a second.
 * Everything is refetched when the app comes back to the foreground in
 * case the phone slept through some events.
 */

interface Tables {
  assets: Asset[]
  vendors: Vendor[]
  parts: Part[]
  part_fits: PartFit[]
  pm_schedules: PmSchedule[]
  work_orders: WorkOrder[]
  work_order_costs: WorkOrderCost[]
  work_order_parts: WorkOrderPart[]
  profiles: Profile[]
  app_settings: Settings[]
  asset_financials: AssetFinancials[]
  fuel_logs: FuelLog[]
}
type TableName = keyof Tables

const KEYS: Record<TableName, (r: any) => string> = {
  assets: (r) => r.id,
  vendors: (r) => r.id,
  parts: (r) => r.id,
  part_fits: (r) => `${r.part_id}:${r.asset_id}`,
  pm_schedules: (r) => r.id,
  work_orders: (r) => r.id,
  work_order_costs: (r) => r.work_order_id,
  work_order_parts: (r) => r.id,
  profiles: (r) => r.id,
  app_settings: (r) => String(r.id),
  asset_financials: (r) => r.asset_id,
  fuel_logs: (r) => r.id,
}

const EMPTY: Tables = {
  assets: [], vendors: [], parts: [], part_fits: [], pm_schedules: [], work_orders: [],
  work_order_costs: [], work_order_parts: [], profiles: [], app_settings: [], asset_financials: [], fuel_logs: [],
}

function tablesFor(role: string | null): TableName[] {
  if (role === 'admin') return Object.keys(EMPTY) as TableName[]
  if (role === 'mechanic')
    return ['assets', 'vendors', 'parts', 'part_fits', 'pm_schedules', 'work_orders', 'work_order_costs', 'work_order_parts', 'profiles', 'app_settings', 'fuel_logs']
  if (role === 'driver') return ['assets', 'work_orders', 'profiles', 'fuel_logs']
  return []
}

const NUMERIC: Partial<Record<TableName, string[]>> = {
  parts: ['unit_cost', 'qty_on_hand', 'reorder_point'],
  work_orders: ['labor_hours', 'downtime_hours'],
  work_order_costs: ['labor_rate', 'vendor_cost', 'other_parts_cost'],
  work_order_parts: ['quantity', 'unit_cost'],
  app_settings: ['default_labor_rate'],
  asset_financials: ['purchase_price', 'replacement_cost'],
  fuel_logs: ['gallons', 'total_cost'],
}

/** Postgres numeric arrives as a string — normalise to JS numbers. */
function normalise(table: TableName, row: any): any {
  const cols = NUMERIC[table]
  if (!cols) return row
  const out = { ...row }
  for (const c of cols) if (out[c] != null) out[c] = Number(out[c])
  return out
}

async function fetchAll(table: TableName): Promise<any[]> {
  const page = 1000
  const rows: any[] = []
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase.from(table).select('*').range(from, from + page - 1)
    if (error) throw new Error(`${table}: ${error.message}`)
    rows.push(...data)
    if (data.length < page) break
  }
  return rows.map((r) => normalise(table, r))
}

interface DataState extends Tables {
  loading: boolean
  error: string | null
  settings: Settings | null
  reload: () => Promise<void>
  /** Apply a row you just wrote so the UI updates before realtime echoes it. */
  upsertLocal: <T extends TableName>(table: T, row: Tables[T][number]) => void
  removeLocal: <T extends TableName>(table: T, key: string) => void
}

const DataContext = createContext<DataState | null>(null)

export function DataProvider({ children }: { children: ReactNode }) {
  const { role, session } = useAuth()
  const [tables, setTables] = useState<Tables>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const names = useMemo(() => tablesFor(role), [role])
  const loadSeq = useRef(0)

  const reload = useCallback(async () => {
    const seq = ++loadSeq.current
    if (!names.length) {
      setTables(EMPTY)
      setLoading(false)
      return
    }
    // One table failing (e.g. a migration not run yet) shouldn't blank the whole app.
    const results = await Promise.allSettled(names.map((n) => fetchAll(n)))
    if (seq !== loadSeq.current) return
    const next = { ...EMPTY }
    const failed: string[] = []
    names.forEach((n, i) => {
      const r = results[i]
      if (r.status === 'fulfilled') (next as any)[n] = r.value
      else failed.push((r.reason as Error).message)
    })
    setTables(next)
    setError(failed.length ? failed.join('; ') : null)
    setLoading(false)
  }, [names])

  const upsertLocal = useCallback(<T extends TableName>(table: T, row: Tables[T][number]) => {
    const key = KEYS[table]
    const r = normalise(table, row)
    setTables((t) => {
      const list = t[table] as any[]
      const k = key(r)
      const i = list.findIndex((x) => key(x) === k)
      const next = i === -1 ? [...list, r] : list.map((x, j) => (j === i ? { ...x, ...r } : x))
      return { ...t, [table]: next }
    })
  }, [])

  const removeLocal = useCallback(<T extends TableName>(table: T, k: string) => {
    const key = KEYS[table]
    setTables((t) => ({ ...t, [table]: (t[table] as any[]).filter((x) => key(x) !== k) }))
  }, [])

  useEffect(() => {
    setLoading(true)
    reload()
  }, [reload, session?.user.id])

  // Realtime
  useEffect(() => {
    if (!names.length || !session) return
    let ch = supabase.channel(`data-${session.user.id}`)
    for (const table of names) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const old = payload.old as any
          if (old && Object.keys(old).length) removeLocal(table, KEYS[table](old))
        } else {
          upsertLocal(table, payload.new as any)
        }
      })
    }
    ch.subscribe((status) => {
      // After a reconnect we may have missed events: resync.
      if (status === 'SUBSCRIBED') reload()
    })
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      supabase.removeChannel(ch)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [names, session, reload, upsertLocal, removeLocal])

  const value: DataState = {
    ...tables,
    settings: tables.app_settings[0] ?? null,
    loading,
    error,
    reload,
    upsertLocal,
    removeLocal,
  }
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataState {
  const ctx = useContext(DataContext)
  if (!ctx) throw new Error('useData outside DataProvider')
  return ctx
}

/** Handy lookups derived from the cache. */
export function useLookups() {
  const d = useData()
  return useMemo(() => {
    const assetById = new Map(d.assets.map((a) => [a.id, a]))
    const vendorById = new Map(d.vendors.map((v) => [v.id, v]))
    const partById = new Map(d.parts.map((p) => [p.id, p]))
    const profileById = new Map(d.profiles.map((p) => [p.id, p]))
    const costByWo = new Map(d.work_order_costs.map((c) => [c.work_order_id, c]))
    const partsByWo = new Map<string, WorkOrderPart[]>()
    for (const wp of d.work_order_parts) {
      const list = partsByWo.get(wp.work_order_id) ?? []
      list.push(wp)
      partsByWo.set(wp.work_order_id, list)
    }
    return { assetById, vendorById, partById, profileById, costByWo, partsByWo }
  }, [d.assets, d.vendors, d.parts, d.profiles, d.work_order_costs, d.work_order_parts])
}

export interface WoCostBreakdown {
  labor: number
  parts: number
  vendor: number
  total: number
}

export function woCost(
  wo: WorkOrder,
  cost: WorkOrderCost | undefined,
  parts: WorkOrderPart[] | undefined,
): WoCostBreakdown {
  const labor = Math.round(wo.labor_hours * (cost?.labor_rate ?? 0) * 100) / 100
  const inv = (parts ?? []).reduce((s, p) => s + p.quantity * (p.unit_cost ?? 0), 0)
  const partsTotal = inv + (cost?.other_parts_cost ?? 0)
  const vendor = cost?.vendor_cost ?? 0
  return { labor, parts: partsTotal, vendor, total: labor + partsTotal + vendor }
}
