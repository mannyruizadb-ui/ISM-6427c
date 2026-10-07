import { Link, useSearchParams } from 'react-router-dom'
import { useMemo, useState } from 'react'
import { useData, useLookups, woCost } from '../state/data'
import { useRole } from '../state/auth'
import { fmtDate, fmtMoney } from '../lib/format'
import { EmptyState, Fab, PageHead, Search, StatusPill } from '../components/ui'
import { Icon } from '../components/Icon'

const FILTERS = [
  { value: 'active', label: 'Open + waiting' },
  { value: 'open', label: 'Open' },
  { value: 'waiting_parts', label: 'Waiting on parts' },
  { value: 'done', label: 'Done' },
  { value: 'all', label: 'All' },
] as const

export function WorkOrders() {
  const d = useData()
  const { isStaff, isAdmin, isDriver } = useRole()
  const { assetById, profileById, vendorById, costByWo, partsByWo } = useLookups()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'active'
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(100)

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return d.work_orders
      .filter((w) => (status === 'all' ? true : status === 'active' ? w.status !== 'done' : w.status === status))
      .filter((w) => {
        if (!t) return true
        const a = assetById.get(w.asset_id)
        return [a?.label, w.problem, w.fix, String(w.number), profileById.get(w.assigned_to ?? '')?.full_name, w.assigned_name]
          .some((v) => v?.toLowerCase().includes(t))
      })
      .sort((a, b) => b.opened_on.localeCompare(a.opened_on) || b.number - a.number)
  }, [d.work_orders, status, q, assetById, profileById])

  if (d.work_orders.length === 0) {
    return (
      <>
        <PageHead title={isDriver ? 'My reports' : 'Work orders'} />
        <EmptyState
          icon="wrench"
          title={isDriver ? 'No reports yet' : 'No work orders yet'}
          action={
            isStaff ? (
              d.assets.length ? (
                <Link to="/work-orders/new" className="btn primary">
                  <Icon name="plus" /> Log the first repair
                </Link>
              ) : (
                <Link to="/assets?add=1" className="btn primary">
                  Add a truck or machine first
                </Link>
              )
            ) : (
              <Link to="/report" className="btn primary">Report a problem</Link>
            )
          }
        >
          {isStaff
            ? 'Every repair on a truck or machine goes here: the problem, the fix, hours, parts used and downtime.'
            : 'Problems you report on a truck appear here with their status.'}
          {isAdmin && ' You can also import your old Excel log from Import CSV.'}
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHead
        title={isDriver ? 'My reports' : 'Work orders'}
        sub={`${list.length} shown`}
        actions={
          isStaff ? (
            <Link to="/work-orders/new" className="btn primary">
              <Icon name="plus" /> New work order
            </Link>
          ) : undefined
        }
      />
      <div className="chips" role="group" aria-label="Filter by status">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            className="chip"
            aria-pressed={status === f.value}
            onClick={() => setParams(f.value === 'active' ? {} : { status: f.value }, { replace: true })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div style={{ marginBottom: 12 }}>
        <Search value={q} onChange={setQ} placeholder="Search asset, problem, #, mechanic…" />
      </div>
      {list.length === 0 ? (
        <EmptyState icon="search" title="Nothing matches">
          Try a different status or search.
        </EmptyState>
      ) : (
        <div className="list">
          {list.slice(0, limit).map((w) => {
            const a = assetById.get(w.asset_id)
            const who = profileById.get(w.assigned_to ?? '')?.full_name ?? vendorById.get(w.vendor_id ?? '')?.name ?? w.assigned_name
            return (
              <Link key={w.id} to={`/work-orders/${w.id}`} className="row">
                <div className="grow">
                  <div className="title">
                    {a?.label ?? '—'} · {w.problem}
                  </div>
                  <div className="meta">
                    #{w.number} · {fmtDate(w.opened_on)}
                    {who && ` · ${who}`}
                    {isStaff && w.status === 'done' && ` · ${fmtMoney(woCost(w, costByWo.get(w.id), partsByWo.get(w.id)).total)}`}
                  </div>
                </div>
                <StatusPill status={w.status} />
              </Link>
            )
          })}
          {list.length > limit && (
            <button className="btn" onClick={() => setLimit((l) => l + 200)}>
              Show more ({list.length - limit} left)
            </button>
          )}
        </div>
      )}
      {isStaff && <Fab to="/work-orders/new" label="New work order" />}
    </>
  )
}
