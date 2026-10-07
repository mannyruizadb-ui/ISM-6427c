import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../state/data'
import { useRole } from '../state/auth'
import { allPmStatuses, PM_LABEL, type PmState } from '../lib/pm'
import { fmtDate, fmtNum } from '../lib/format'
import type { PmSchedule } from '../lib/types'
import { PmForm } from '../components/PmForm'
import { EmptyState, PageHead } from '../components/ui'
import { Icon } from '../components/Icon'

export function Maintenance() {
  const d = useData()
  const { isAdmin } = useRole()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<PmState | 'attention' | 'all'>('attention')
  const [edit, setEdit] = useState<PmSchedule | 'new' | null>(params.get('add') === '1' && isAdmin ? 'new' : null)
  const statuses = useMemo(() => allPmStatuses(d.pm_schedules, d.assets), [d.pm_schedules, d.assets])
  const shown = statuses.filter((s) => (filter === 'all' ? true : filter === 'attention' ? s.state !== 'ok' : s.state === filter))
  const count = (st: PmState) => statuses.filter((s) => s.state === st).length

  const close = () => {
    setEdit(null)
    if (params.get('add')) setParams({}, { replace: true })
  }

  return (
    <>
      <PageHead
        title="Preventive maintenance"
        sub="Trucks by mileage (and optionally days), equipment by date."
        actions={
          isAdmin && d.assets.length > 0 ? (
            <button className="btn primary" onClick={() => setEdit('new')}>
              <Icon name="plus" /> Add schedule
            </button>
          ) : undefined
        }
      />
      {d.assets.length === 0 ? (
        <EmptyState icon="calendar" title="Add assets first" action={isAdmin ? <Link to="/assets?add=1" className="btn primary">Add a truck or machine</Link> : undefined}>
          Maintenance schedules belong to a truck or piece of equipment.
        </EmptyState>
      ) : statuses.length === 0 ? (
        <EmptyState
          icon="calendar"
          title="No maintenance schedules yet"
          action={isAdmin ? <button className="btn primary" onClick={() => setEdit('new')}><Icon name="plus" /> Add the first schedule</button> : undefined}
        >
          For example: oil change every 5,000 miles on each truck, or quarterly service on each washer. Overdue items are
          flagged on the dashboard.
        </EmptyState>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Filter">
            {([
              ['attention', `Needs attention (${statuses.length - count('ok')})`],
              ['overdue', `Overdue (${count('overdue')})`],
              ['due_soon', `Due soon (${count('due_soon')})`],
              ['never', `No baseline (${count('never')})`],
              ['all', `All (${statuses.length})`],
            ] as const).map(([v, l]) => (
              <button key={v} className="chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>
                {l}
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <EmptyState icon="check" title="Nothing here">All caught up for this filter.</EmptyState>
          ) : (
            <div className="list">
              {shown.map((s) => (
                <div key={s.schedule.id} className="row" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 200 }}>
                    <div className="title">
                      <Link to={`/assets/${s.asset.id}`} style={{ color: 'inherit' }}>{s.asset.label}</Link> · {s.schedule.task}
                    </div>
                    <div className="meta">
                      {s.state === 'never'
                        ? 'Last service not recorded — edit the schedule to set it, or log a work order.'
                        : [
                            s.dueMiles != null && `due at ${fmtNum(s.dueMiles)} mi (${s.milesLeft != null && s.milesLeft <= 0 ? `${fmtNum(-s.milesLeft)} over` : `${fmtNum(s.milesLeft)} to go`})`,
                            s.dueDate && `due ${fmtDate(s.dueDate)} (${s.daysLeft != null && s.daysLeft <= 0 ? `${-s.daysLeft} days over` : `in ${s.daysLeft} days`})`,
                          ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <span className={`pill ${s.state}`}>{PM_LABEL[s.state]}</span>
                  <Link to={`/work-orders/new?asset=${s.asset.id}&pm=${s.schedule.id}`} className="btn">
                    Log it
                  </Link>
                  {isAdmin && (
                    <button className="icon-btn" onClick={() => setEdit(s.schedule)} aria-label={`Edit ${s.schedule.task}`}>
                      <Icon name="edit" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {edit && <PmForm schedule={edit === 'new' ? undefined : edit} onClose={close} />}
    </>
  )
}
