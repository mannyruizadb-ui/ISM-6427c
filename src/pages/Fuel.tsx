import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth, useRole } from '../state/auth'
import { useData, useLookups } from '../state/data'
import { addDays, fmtDate, fmtMoney, fmtNum, todayISO } from '../lib/format'
import { analyseFuel, FLAG_LABEL, SERIOUS, summarise, vehicleName, type FuelRow } from '../lib/fuel'
import { receiptUrl } from '../lib/photos'
import { FuelForm } from '../components/FuelForm'
import { EmptyState, Fab, PageHead, Spinner } from '../components/ui'
import { Icon } from '../components/Icon'

type Period = 'month' | '30' | 'year' | 'all'
const PERIODS: { value: Period; label: string }[] = [
  { value: 'month', label: 'This month' },
  { value: '30', label: 'Last 30 days' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
]

export function periodStart(p: Period): string | null {
  const t = todayISO()
  if (p === 'month') return `${t.slice(0, 7)}-01`
  if (p === '30') return addDays(t, -30)
  if (p === 'year') return `${t.slice(0, 4)}-01-01`
  return null
}

export function FuelRowItem({ r, showWho }: { r: FuelRow; showWho?: boolean }) {
  const { assetById, profileById } = useLookups()
  const l = r.log
  const serious = r.flags.filter((f) => SERIOUS.includes(f) || f === 'no_odometer')
  return (
    <Link to={`/fuel/${l.id}`} className="row" style={{ flexWrap: 'wrap' }}>
      <div className="grow" style={{ minWidth: 180 }}>
        <div className="title">
          {vehicleName(l, assetById)} · {fmtNum(l.gallons)} gal · {fmtMoney(l.total_cost)}
        </div>
        <div className="meta">
          {[
            fmtDate(l.filled_on),
            l.odometer != null && `${fmtNum(l.odometer)} mi`,
            r.mpg != null && `${r.mpg.toFixed(1)} MPG`,
            `${fmtMoney(r.pricePerGallon)}/gal`,
            !l.full_tank && 'partial',
            l.location,
            showWho && profileById.get(l.entered_by ?? '')?.full_name,
            l.receipt_path && '🧾',
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      </div>
      {serious.map((f) => (
        <span key={f} className={`pill ${f === 'no_odometer' ? 'neutral' : 'warn'}`}>{FLAG_LABEL[f]}</span>
      ))}
    </Link>
  )
}

export function Fuel() {
  const d = useData()
  const { isStaff, isDriver } = useRole()
  const { assetById } = useLookups()
  const [params, setParams] = useSearchParams()
  const period = (params.get('period') as Period) || 'month'
  const truck = params.get('truck') ?? ''
  const flaggedOnly = params.get('flagged') === '1'
  const [tab, setTab] = useState<'fills' | 'trucks'>('fills')
  const [limit, setLimit] = useState(100)

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v == null || v === '') p.delete(k)
    else p.set(k, v)
    setParams(p, { replace: true })
  }

  // MPG needs every fill-up (the previous one may be outside the period), so analyse all, then filter.
  const analysed = useMemo(() => analyseFuel(d.fuel_logs), [d.fuel_logs])
  const start = periodStart(period)
  const rows = useMemo(
    () =>
      [...analysed.values()]
        .filter((r) => !start || r.log.filled_on >= start)
        .filter((r) => !truck || (truck === 'other' ? !r.log.asset_id : r.log.asset_id === truck))
        .sort((a, b) => b.log.filled_on.localeCompare(a.log.filled_on) || b.log.created_at.localeCompare(a.log.created_at)),
    [analysed, start, truck],
  )
  const shown = flaggedOnly ? rows.filter((r) => r.flags.some((f) => SERIOUS.includes(f))) : rows
  const total = summarise(rows)

  const byTruck = useMemo(() => {
    const m = new Map<string, FuelRow[]>()
    for (const r of rows) {
      const k = r.log.asset_id ?? 'other'
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return [...m.entries()]
      .map(([k, rs]) => ({ key: k, label: k === 'other' ? 'Rentals / other' : assetById.get(k)?.label ?? '—', s: summarise(rs), last: rs.find((r) => r.log.odometer != null)?.log }))
      .sort((a, b) => b.s.cost - a.s.cost)
  }, [rows, assetById])

  const fleetTrucks = d.assets.filter((a) => a.kind === 'truck')

  if (d.fuel_logs.length === 0) {
    return (
      <>
        <PageHead title={isDriver ? 'My fill-ups' : 'Fuel'} />
        <EmptyState
          icon="fuel"
          title="No fill-ups yet"
          action={
            fleetTrucks.length || isDriver ? (
              <div className="actions" style={{ justifyContent: 'center' }}>
                <Link to="/fuel/new" className="btn primary"><Icon name="plus" /> Log the first fill-up</Link>
                {isStaff && <Link to="/admin/import?kind=fuel" className="btn">Import gas log CSV</Link>}
              </div>
            ) : (
              <Link to="/assets?tab=truck&add=1" className="btn primary">Add a truck first</Link>
            )
          }
        >
          Each fill-up takes the odometer, gallons and price — snap the receipt if you like. Miles, MPG and cost per mile
          are worked out automatically, and the odometer keeps mileage-based maintenance up to date.
        </EmptyState>
      </>
    )
  }

  return (
    <>
      <PageHead
        title={isDriver ? 'My fill-ups' : 'Fuel'}
        actions={
          <Link to="/fuel/new" className="btn primary">
            <Icon name="plus" /> Log fuel
          </Link>
        }
      />
      <div className="chips" role="group" aria-label="Period">
        {PERIODS.map((p) => (
          <button key={p.value} className="chip" aria-pressed={period === p.value} onClick={() => setParam('period', p.value === 'month' ? null : p.value)}>
            {p.label}
          </button>
        ))}
      </div>

      {isStaff && (
        <div className="stats" style={{ marginBottom: 16 }}>
          <div className="stat"><div className="label">Fuel spend</div><div className="value" style={{ fontSize: '1.4rem' }}>{fmtMoney(total.cost)}</div></div>
          <div className="stat"><div className="label">Gallons</div><div className="value" style={{ fontSize: '1.4rem' }}>{fmtNum(Math.round(total.gallons))}</div></div>
          <div className="stat"><div className="label">Avg price</div><div className="value" style={{ fontSize: '1.4rem' }}>{total.pricePerGallon ? `${fmtMoney(total.pricePerGallon)}/gal` : '—'}</div></div>
          <div className="stat"><div className="label">Fleet MPG</div><div className="value" style={{ fontSize: '1.4rem' }}>{total.mpg ? total.mpg.toFixed(1) : '—'}</div></div>
          <div className="stat"><div className="label">Fuel per mile</div><div className="value" style={{ fontSize: '1.4rem' }}>{total.costPerMile ? fmtMoney(total.costPerMile) : '—'}</div></div>
          <button className={`stat${total.flagged ? ' warn' : ''}`} style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }} onClick={() => { setTab('fills'); setParam('flagged', flaggedOnly ? null : '1') }}>
            <div className="label">Need checking</div><div className="value">{total.flagged}</div>
          </button>
        </div>
      )}

      {isStaff && (
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'fills'} onClick={() => setTab('fills')}>Fill-ups ({rows.length})</button>
          <button role="tab" aria-selected={tab === 'trucks'} onClick={() => setTab('trucks')}>By truck</button>
        </div>
      )}

      {tab === 'fills' && (
        <>
          {(fleetTrucks.length > 1 || isStaff) && (
            <div className="chips" role="group" aria-label="Filter">
              <select aria-label="Truck" value={truck} onChange={(e) => setParam('truck', e.target.value)} style={{ width: 'auto', minHeight: 40 }}>
                <option value="">All vehicles</option>
                {fleetTrucks.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                <option value="other">Rentals / other</option>
              </select>
              {isStaff && (
                <button className="chip" aria-pressed={flaggedOnly} onClick={() => setParam('flagged', flaggedOnly ? null : '1')}>
                  Needs checking only
                </button>
              )}
            </div>
          )}
          {shown.length === 0 ? (
            <EmptyState icon="search" title="Nothing here">No fill-ups match this period and filter.</EmptyState>
          ) : (
            <div className="list">
              {shown.slice(0, limit).map((r) => <FuelRowItem key={r.log.id} r={r} showWho={isStaff} />)}
              {shown.length > limit && <button className="btn" onClick={() => setLimit((l) => l + 200)}>Show more ({shown.length - limit} left)</button>}
            </div>
          )}
        </>
      )}

      {tab === 'trucks' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vehicle</th>
                <th className="num">Fills</th>
                <th className="num">Gallons</th>
                <th className="num">Spend</th>
                <th className="num">MPG</th>
                <th className="num">$/mile</th>
                <th className="num">Last odometer</th>
                <th className="num">Check</th>
              </tr>
            </thead>
            <tbody>
              {byTruck.map((t) => (
                <tr key={t.key}>
                  <td>{t.key === 'other' ? t.label : <Link to={`/assets/${t.key}`}>{t.label}</Link>}</td>
                  <td className="num">{t.s.fills}</td>
                  <td className="num">{fmtNum(Math.round(t.s.gallons))}</td>
                  <td className="num">{fmtMoney(t.s.cost)}</td>
                  <td className="num">{t.s.mpg ? t.s.mpg.toFixed(1) : '—'}</td>
                  <td className="num">{t.s.costPerMile ? fmtMoney(t.s.costPerMile) : '—'}</td>
                  <td className="num">{t.last ? `${fmtNum(t.last.odometer)} (${fmtDate(t.last.filled_on)})` : '—'}</td>
                  <td className="num">{t.s.flagged ? <span className="pill warn">{t.s.flagged}</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Fab to="/fuel/new" label="Log fuel" />
    </>
  )
}

export function FuelNew() {
  const nav = useNavigate()
  const d = useData()
  const trucks = d.assets.filter((a) => a.kind === 'truck' && !a.retired_at)
  return (
    <>
      <PageHead title="Log fuel" sub="One odometer reading per fill-up — miles and MPG are worked out for you." />
      {trucks.length === 0 && <div className="banner info" style={{ marginBottom: 12 }}>No trucks set up yet — you can still log a rental or other vehicle.</div>}
      <FuelForm onDone={() => nav('/fuel', { replace: true })} />
    </>
  )
}

export function FuelDetail() {
  const { id } = useParams()
  const d = useData()
  const nav = useNavigate()
  const { profile } = useAuth()
  const { isStaff } = useRole()
  const { assetById, profileById } = useLookups()
  const log = d.fuel_logs.find((l) => l.id === id)
  const row = useMemo(() => (log ? analyseFuel(d.fuel_logs).get(log.id) : undefined), [d.fuel_logs, log])
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    if (log?.receipt_path) receiptUrl(log.receipt_path).then((u) => alive && setUrl(u))
    return () => {
      alive = false
    }
  }, [log?.receipt_path])

  if (!log || !row) {
    return d.loading ? <Spinner /> : (
      <EmptyState icon="fuel" title="Fill-up not found" action={<Link to="/fuel" className="btn">Back to fuel</Link>}>
        It may have been deleted.
      </EmptyState>
    )
  }
  const mine = log.entered_by === profile?.id
  const editable = isStaff || (mine && Date.now() - new Date(log.created_at).getTime() < 24 * 3600 * 1000)

  return (
    <div className="stack">
      <PageHead
        title={`${vehicleName(log, assetById)} · ${fmtDate(log.filled_on)}`}
        sub={[
          row.mpg != null && `${row.mpg.toFixed(1)} MPG over ${fmtNum(row.miles)} mi`,
          `${fmtMoney(row.pricePerGallon)}/gal`,
          `entered by ${profileById.get(log.entered_by ?? '')?.full_name ?? (log.source === 'import' ? 'import' : '—')}`,
        ].filter(Boolean).join(' · ')}
      />
      {row.flags.filter((f) => f !== 'same_day').length > 0 && (
        <div className="banner warn">Check this entry: {row.flags.map((f) => FLAG_LABEL[f]).join(', ')}.</div>
      )}
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="card" style={{ display: 'block', maxWidth: 360 }}>
          <img src={url} alt="Fuel receipt" style={{ borderRadius: 8, display: 'block' }} />
        </a>
      )}
      {editable ? (
        <FuelForm log={log} onDone={() => nav('/fuel', { replace: true })} />
      ) : (
        <section className="card">
          <dl className="kv">
            <dt>Odometer</dt><dd>{log.odometer != null ? `${fmtNum(log.odometer)} mi` : '—'}</dd>
            <dt>Gallons</dt><dd>{fmtNum(log.gallons)}{log.full_tank ? '' : ' (partial)'}</dd>
            <dt>Total</dt><dd>{fmtMoney(log.total_cost)}</dd>
            <dt>Location</dt><dd>{log.location || '—'}</dd>
            {log.notes && (<><dt>Notes</dt><dd>{log.notes}</dd></>)}
          </dl>
          <p className="small muted" style={{ marginTop: 12 }}>Entries can be changed for 24 hours. Ask a mechanic or admin to fix anything older.</p>
        </section>
      )}
    </div>
  )
}
