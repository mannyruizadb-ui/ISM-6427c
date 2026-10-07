import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../state/data'
import { useRole } from '../state/auth'
import { allPmStatuses, PM_LABEL, type PmState } from '../lib/pm'
import { cap, fmtDate, fmtNum } from '../lib/format'
import type { PmSchedule } from '../lib/types'
import { PmForm, PRESETS } from '../components/PmForm'
import { supabase, must } from '../lib/supabase'
import { EmptyState, PageHead, Sheet, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

export function Maintenance() {
  const d = useData()
  const { isAdmin } = useRole()
  const [params, setParams] = useSearchParams()
  const [filter, setFilter] = useState<PmState | 'attention' | 'all'>('attention')
  const [starter, setStarter] = useState(false)
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
            <>
              <button className="btn" onClick={() => setStarter(true)}>
                Starter schedules
              </button>
              <button className="btn primary" onClick={() => setEdit('new')}>
                <Icon name="plus" /> Add schedule
              </button>
            </>
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
          action={
            isAdmin ? (
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={() => setStarter(true)}>Set up starter schedules</button>
                <button className="btn" onClick={() => setEdit('new')}><Icon name="plus" /> Add one by hand</button>
              </div>
            ) : undefined
          }
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
      {starter && <StarterSheet onClose={() => setStarter(false)} />}
      {edit && <PmForm schedule={edit === 'new' ? undefined : edit} onClose={close} />}
    </>
  )
}

/** One tap to give every machine of a type its standard schedules (e.g. lint, ignition probe and blow-down on every dryer). */
function StarterSheet({ onClose }: { onClose: () => void }) {
  const d = useData()
  const toast = useToast()
  const groups = useMemo(() => {
    const byType = new Map<string, typeof d.assets>()
    for (const a of d.assets) {
      if (a.retired_at) continue
      const key = a.kind === 'truck' ? 'truck' : a.equipment_type ?? 'other'
      byType.set(key, [...(byType.get(key) ?? []), a])
    }
    return [...byType.entries()]
      .map(([type, assets]) => ({
        type,
        assets,
        presets: (PRESETS[type] ?? PRESETS.other).map((p) => ({
          ...p,
          missing: assets.filter((a) => !d.pm_schedules.some((s) => s.asset_id === a.id && s.task.toLowerCase() === p.task.toLowerCase())),
        })),
      }))
      .sort((a, b) => (a.type === 'dryer' ? -1 : b.type === 'dryer' ? 1 : a.type.localeCompare(b.type)))
  }, [d.assets, d.pm_schedules])
  const [picked, setPicked] = useState<Set<string>>(() => new Set(groups.filter((g) => g.type === 'dryer').flatMap((g) => g.presets.map((p) => `${g.type}|${p.task}`))))
  const [busy, setBusy] = useState(false)
  const rows = groups.flatMap((g) =>
    g.presets
      .filter((p) => picked.has(`${g.type}|${p.task}`))
      .flatMap((p) => p.missing.map((a) => ({ asset_id: a.id, task: p.task, interval_miles: a.kind === 'truck' ? p.miles : null, interval_days: p.days, notes: p.notes ?? null }))),
  )

  const apply = async () => {
    setBusy(true)
    try {
      const saved = must(await supabase.from('pm_schedules').insert(rows).select()) as PmSchedule[]
      saved.forEach((s) => d.upsertLocal('pm_schedules', s))
      toast(`Added ${saved.length} schedules. Log the last service on each to start the clock.`)
      onClose()
    } catch (e) {
      toast((e as Error).message, true)
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Starter schedules"
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || rows.length === 0} onClick={apply}>
            {busy ? 'Adding…' : `Add ${rows.length} schedule${rows.length === 1 ? '' : 's'}`}
          </button>
        </>
      }
    >
      <p className="muted" style={{ marginBottom: 12 }}>
        Pick the tasks to add to every machine of that type. Intervals are starting points; adjust them to the manufacturer's
        manual afterwards. Machines that already have a task are skipped.
      </p>
      <div className="stack">
        {groups.map((g) => (
          <section key={g.type} className="card">
            <h3 style={{ marginBottom: 8 }}>
              {g.type === 'truck' ? 'Trucks' : `${cap(g.type)}s`} <span className="muted small">({g.assets.map((a) => a.label).join(', ')})</span>
            </h3>
            {g.presets.map((p) => {
              const key = `${g.type}|${p.task}`
              return (
                <label key={key} className="check" style={{ fontWeight: 500 }}>
                  <input
                    type="checkbox"
                    checked={picked.has(key)}
                    disabled={p.missing.length === 0}
                    onChange={(e) =>
                      setPicked((s) => {
                        const n = new Set(s)
                        if (e.target.checked) n.add(key)
                        else n.delete(key)
                        return n
                      })
                    }
                  />
                  <span>
                    <strong>{p.task}</strong>{' '}
                    <span className="muted small">
                      every {[p.miles && g.type === 'truck' && `${p.miles.toLocaleString()} mi`, p.days && `${p.days} days`].filter(Boolean).join(' or ')}
                      {p.missing.length === 0 ? ' · all set' : p.missing.length < g.assets.length ? ` · ${p.missing.length} missing` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </section>
        ))}
      </div>
    </Sheet>
  )
}
