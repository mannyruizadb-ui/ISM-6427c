import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import { useAuth, useRole } from '../state/auth'
import { useData, useLookups } from '../state/data'
import { allPmStatuses, PM_LABEL } from '../lib/pm'
import { fmtDate, fmtMiles, fmtMoney0, fmtNum, firstName, greeting } from '../lib/format'
import { EmptyState, Fab, StatusPill, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { supabase } from '../lib/supabase'
import { analyseFuel, SERIOUS, summarise } from '../lib/fuel'
import { FuelRowItem, periodStart } from './Fuel'

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

export function Dashboard() {
  const { isDriver } = useRole()
  return isDriver ? <DriverHome /> : <StaffHome />
}

function Greeting({ summary }: { summary: string }) {
  const { profile } = useAuth()
  return (
    <div className="page-head">
      <div>
        <h1>
          {greeting()}, {firstName(profile?.full_name)}
        </h1>
        <p className="sub muted">{summary}</p>
      </div>
    </div>
  )
}

/* ---------------- Admin + mechanic ---------------- */
function StaffHome() {
  const d = useData()
  const { isAdmin } = useRole()
  const { assetById } = useLookups()

  const open = d.work_orders.filter((w) => w.status !== 'done')
  const waiting = open.filter((w) => w.status === 'waiting_parts')
  const pm = useMemo(() => allPmStatuses(d.pm_schedules, d.assets), [d.pm_schedules, d.assets])
  const overdue = pm.filter((s) => s.state === 'overdue')
  const attention = pm.filter((s) => s.state !== 'ok').slice(0, 6)
  const low = d.parts.filter((p) => !p.retired_at && p.qty_on_hand <= p.reorder_point)
  const down = d.assets.filter((a) => !a.retired_at && a.status === 'down')
  const fuel = useMemo(() => {
    const rows = [...analyseFuel(d.fuel_logs).values()]
    const month = rows.filter((r) => r.log.filled_on >= periodStart('month')!)
    return { month: summarise(month), toCheck: rows.filter((r) => r.flags.some((f) => SERIOUS.includes(f))).length }
  }, [d.fuel_logs])

  const summary =
    `You have ${plural(open.length, 'open work order')}, ` +
    `${plural(overdue.length, 'overdue maintenance item')} and ${plural(low.length, 'low-stock part')}.`

  return (
    <>
      <Greeting summary={summary} />
      {isAdmin && <SetupChecklist />}

      <div className="stats" style={{ margin: '16px 0' }}>
        <Link to="/work-orders" className="stat">
          <div className="label">Open work orders</div>
          <div className="value">{open.length}</div>
        </Link>
        <Link to="/work-orders?status=waiting_parts" className={`stat${waiting.length ? ' warn' : ''}`}>
          <div className="label">Waiting on parts</div>
          <div className="value">{waiting.length}</div>
        </Link>
        <Link to="/assets?status=down" className={`stat${down.length ? ' alert' : ''}`}>
          <div className="label">Assets down</div>
          <div className="value">{down.length}</div>
        </Link>
        <Link to="/maintenance" className={`stat${overdue.length ? ' alert' : ''}`}>
          <div className="label">Overdue maintenance</div>
          <div className="value">{overdue.length}</div>
        </Link>
        <Link to="/parts/reorder" className={`stat${low.length ? ' warn' : ''}`}>
          <div className="label">Low-stock parts</div>
          <div className="value">{low.length}</div>
        </Link>
        <Link to="/fuel" className="stat">
          <div className="label">Fuel this month</div>
          <div className="value" style={{ fontSize: '1.4rem' }}>{fmtMoney0(fuel.month.cost)}</div>
          <div className="small muted">{fuel.month.mpg ? `${fuel.month.mpg.toFixed(1)} MPG` : `${fuel.month.fills} fill-ups`}</div>
        </Link>
        {fuel.toCheck > 0 && (
          <Link to="/fuel?period=all&flagged=1" className="stat warn">
            <div className="label">Fuel entries to check</div>
            <div className="value">{fuel.toCheck}</div>
          </Link>
        )}
      </div>

      <div className="grid grid-2">
        <section className="card">
          <div className="card-head">
            <h2>Open work orders</h2>
            <Link to="/work-orders/new" className="btn primary">
              <Icon name="plus" /> New
            </Link>
          </div>
          {open.length === 0 ? (
            <EmptyState icon="wrench" title="No open work orders">
              Repairs that are open or waiting on parts show up here.
            </EmptyState>
          ) : (
            <div className="list">
              {open
                .slice()
                .sort((a, b) => b.opened_on.localeCompare(a.opened_on))
                .slice(0, 6)
                .map((w) => (
                  <Link key={w.id} to={`/work-orders/${w.id}`} className="row">
                    <div className="grow">
                      <div className="title">
                        {assetById.get(w.asset_id)?.label ?? 'Unknown asset'} · {w.problem}
                      </div>
                      <div className="meta">
                        #{w.number} · {fmtDate(w.opened_on)}
                      </div>
                    </div>
                    <StatusPill status={w.status} />
                  </Link>
                ))}
              {open.length > 6 && (
                <Link to="/work-orders" className="btn ghost">
                  See all {open.length}
                </Link>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Maintenance due</h2>
            <Link to="/maintenance" className="btn ghost">
              All
            </Link>
          </div>
          {d.pm_schedules.length === 0 ? (
            <EmptyState
              icon="calendar"
              title="No maintenance schedules yet"
              action={
                isAdmin && d.assets.length > 0 ? (
                  <Link to="/maintenance?add=1" className="btn primary">
                    Add a schedule
                  </Link>
                ) : undefined
              }
            >
              Set oil changes by mileage for trucks and service by date for equipment. Overdue items are flagged here.
            </EmptyState>
          ) : attention.length === 0 ? (
            <div className="banner ok">All maintenance is up to date.</div>
          ) : (
            <div className="list">
              {attention.map((s) => (
                <Link key={s.schedule.id} to={`/assets/${s.asset.id}`} className="row">
                  <div className="grow">
                    <div className="title">
                      {s.asset.label} · {s.schedule.task}
                    </div>
                    <div className="meta">
                      {s.milesLeft != null &&
                        (s.milesLeft <= 0 ? `${fmtNum(-s.milesLeft)} mi over` : `due in ${fmtNum(s.milesLeft)} mi`)}
                      {s.milesLeft != null && s.daysLeft != null && ' · '}
                      {s.daysLeft != null &&
                        (s.daysLeft <= 0 ? `${-s.daysLeft} days over` : `due in ${s.daysLeft} days`)}
                      {s.state === 'never' && 'Never recorded — log the last service'}
                    </div>
                  </div>
                  <span className={`pill ${s.state}`}>{PM_LABEL[s.state]}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Low stock</h2>
            <Link to="/parts/reorder" className="btn ghost">
              Reorder list
            </Link>
          </div>
          {d.parts.length === 0 ? (
            <EmptyState
              icon="box"
              title="No parts in inventory"
              action={isAdmin ? <Link to="/parts?add=1" className="btn primary">Add your first part</Link> : undefined}
            >
              Parts at or below their reorder point are listed here.
            </EmptyState>
          ) : low.length === 0 ? (
            <div className="banner ok">Every part is above its reorder point.</div>
          ) : (
            <div className="list">
              {low.slice(0, 6).map((p) => (
                <Link key={p.id} to={`/parts?q=${encodeURIComponent(p.part_number)}`} className="row">
                  <div className="grow">
                    <div className="title">
                      {p.part_number} · {p.description}
                    </div>
                    <div className="meta">
                      On hand {fmtNum(p.qty_on_hand)} · reorder at {fmtNum(p.reorder_point)}
                    </div>
                  </div>
                  <span className={`pill ${p.qty_on_hand <= 0 ? 'danger' : 'warn'}`}>{p.qty_on_hand <= 0 ? 'Out' : 'Low'}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Assets down</h2>
          </div>
          {down.length === 0 ? (
            <div className="banner ok">{d.assets.length ? 'Everything is in service.' : 'No assets added yet.'}</div>
          ) : (
            <div className="list">
              {down.map((a) => (
                <Link key={a.id} to={`/assets/${a.id}`} className="row">
                  <div className="grow">
                    <div className="title">{a.label}</div>
                    <div className="meta">{a.kind === 'truck' ? fmtMiles(a.current_mileage) : a.equipment_type}</div>
                  </div>
                  <StatusPill status="down" />
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <Fab to="/work-orders/new" label="New work order" />
    </>
  )
}

/* ---------------- Admin setup checklist ---------------- */
function SetupChecklist() {
  const d = useData()
  const toast = useToast()
  const trucks = d.assets.filter((a) => a.kind === 'truck').length
  const equipment = d.assets.filter((a) => a.kind === 'equipment').length
  const mechanics = d.profiles.filter((p) => p.role === 'mechanic' && p.active).length
  const items = [
    { done: trucks > 0, what: 'Add your trucks', count: trucks, to: '/assets?tab=truck&add=1' },
    { done: equipment > 0, what: 'Add plant equipment', count: equipment, to: '/assets?tab=equipment&add=1' },
    { done: mechanics > 0, what: 'Add mechanics', count: mechanics, to: '/admin/people' },
    { done: d.vendors.length > 0, what: 'Add vendors', count: d.vendors.length, to: '/admin/vendors?add=1' },
    { done: d.parts.length > 0, what: 'Add parts', count: d.parts.length, to: '/parts?add=1' },
    { done: d.settings?.default_labor_rate != null, what: 'Set your shop labor rate', count: null, to: '/settings' },
  ]
  const doneCount = items.filter((i) => i.done).length
  if (d.settings?.setup_dismissed || doneCount === items.length) return null

  const dismiss = async () => {
    const { error } = await supabase.from('app_settings').update({ setup_dismissed: true }).eq('id', 1)
    if (error) toast(error.message, true)
  }

  return (
    <section className="card" aria-labelledby="setup-h" style={{ marginTop: 8 }}>
      <div className="card-head">
        <div>
          <h2 id="setup-h">Get set up</h2>
          <p className="small muted">
            {doneCount} of {items.length} done. You can also load your old Excel log with{' '}
            <Link to="/admin/import">CSV import</Link>.
          </p>
        </div>
        <button className="btn ghost" onClick={dismiss}>
          Hide
        </button>
      </div>
      <div className="progress" aria-hidden>
        <div style={{ width: `${(doneCount / items.length) * 100}%` }} />
      </div>
      <div className="checklist">
        {items.map((i) => (
          <div key={i.what} className={`item${i.done ? ' done' : ''}`}>
            <span className="tick">{i.done && <Icon name="check" />}</span>
            <span className="what">
              {i.what}
              {i.count ? <span className="muted small"> · {i.count} added</span> : null}
            </span>
            <Link to={i.to} className={`btn${i.done ? '' : ' primary'}`}>
              {i.done ? 'Add more' : 'Start'}
            </Link>
          </div>
        ))}
      </div>
    </section>
  )
}

/* ---------------- Driver ---------------- */
function DriverHome() {
  const d = useData()
  const { assetById } = useLookups()
  const mine = d.work_orders.slice().sort((a, b) => b.created_at.localeCompare(a.created_at))
  const open = mine.filter((w) => w.status !== 'done')
  const fills = useMemo(
    () => [...analyseFuel(d.fuel_logs).values()].sort((a, b) => b.log.created_at.localeCompare(a.log.created_at)).slice(0, 3),
    [d.fuel_logs],
  )
  return (
    <>
      <Greeting
        summary={
          open.length
            ? `You have ${plural(open.length, 'open problem report')} being worked on.`
            : 'Nothing open right now. Report anything wrong with your truck below.'
        }
      />
      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Link to="/report" className="btn primary big block">
          <Icon name="camera" /> Report a problem
        </Link>
        <Link to="/fuel/new" className="btn primary big block">
          <Icon name="fuel" /> Log fuel
        </Link>
      </div>
      {fills.length > 0 && (
        <section style={{ marginBottom: 20 }}>
          <div className="card-head" style={{ marginBottom: 10 }}>
            <h2>My recent fill-ups</h2>
            <Link to="/fuel" className="btn ghost">All</Link>
          </div>
          <div className="list">{fills.map((r) => <FuelRowItem key={r.log.id} r={r} />)}</div>
        </section>
      )}
      <h2 style={{ marginBottom: 10 }}>My reports</h2>
      {mine.length === 0 ? (
        <EmptyState icon="clipboard" title="No reports yet">
          When you report a problem with a truck it shows up here, so you can see when it's been fixed.
        </EmptyState>
      ) : (
        <div className="list">
          {mine.map((w) => (
            <Link key={w.id} to={`/work-orders/${w.id}`} className="row">
              <div className="grow">
                <div className="title">
                  {assetById.get(w.asset_id)?.label} · {w.problem}
                </div>
                <div className="meta">
                  #{w.number} · {fmtDate(w.opened_on)}
                </div>
              </div>
              <StatusPill status={w.status} />
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
