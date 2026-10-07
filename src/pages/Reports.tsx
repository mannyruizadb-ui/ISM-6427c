import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { repeatAlerts, similarProblem, shortProblem } from '../lib/reliability'
import { Link } from 'react-router-dom'
import { useData, useLookups, woCost } from '../state/data'
import { daysBetween, fmtDate, fmtHours, fmtMoney, fmtMoney0, fmtNum, todayISO } from '../lib/format'
import { exportPdf, type PdfSection } from '../lib/pdf'
import { analyseFuel, summarise, type FuelRow } from '../lib/fuel'
import type { Asset } from '../lib/types'
import { EmptyState, PageHead, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
type Tab = 'cost' | 'monthly' | 'downtime' | 'replace' | 'fuel' | 'reliability'

interface AssetRow {
  asset: Asset
  parts: number
  labor: number
  vendor: number
  total: number
  months: number[]
  repairs: number
  downtime: number
  lifetime: number
  last12: number
  lifetimeDowntime: number
}

export function Reports() {
  const d = useData()
  const { costByWo, partsByWo } = useLookups()
  const toast = useToast()
  const thisYear = new Date().getFullYear()
  const years = useMemo(() => {
    const ys = new Set<number>([thisYear])
    for (const w of d.work_orders) ys.add(Number(w.opened_on.slice(0, 4)))
    for (const f of d.fuel_logs) ys.add(Number(f.filled_on.slice(0, 4)))
    return [...ys].sort((a, b) => b - a)
  }, [d.work_orders, d.fuel_logs, thisYear])
  const [year, setYear] = useState(thisYear)
  const [kind, setKind] = useState<'all' | 'truck' | 'equipment'>('all')
  const [params] = useSearchParams()
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'cost')
  const [busy, setBusy] = useState(false)

  const rows = useMemo<AssetRow[]>(() => {
    const today = todayISO()
    const map = new Map<string, AssetRow>()
    for (const a of d.assets) {
      if (kind !== 'all' && a.kind !== kind) continue
      map.set(a.id, { asset: a, parts: 0, labor: 0, vendor: 0, total: 0, months: Array(12).fill(0), repairs: 0, downtime: 0, lifetime: 0, last12: 0, lifetimeDowntime: 0 })
    }
    for (const w of d.work_orders) {
      const r = map.get(w.asset_id)
      if (!r) continue
      const c = woCost(w, costByWo.get(w.id), partsByWo.get(w.id))
      r.lifetime += c.total
      r.lifetimeDowntime += w.downtime_hours
      if (daysBetween(w.opened_on, today) <= 365) r.last12 += c.total
      if (Number(w.opened_on.slice(0, 4)) === year) {
        r.parts += c.parts
        r.labor += c.labor
        r.vendor += c.vendor
        r.total += c.total
        r.months[Number(w.opened_on.slice(5, 7)) - 1] += c.total
        r.repairs += 1
        r.downtime += w.downtime_hours
      }
    }
    return [...map.values()].sort((a, b) => b.total - a.total || a.asset.label.localeCompare(b.asset.label, undefined, { numeric: true }))
  }, [d.assets, d.work_orders, costByWo, partsByWo, year, kind])

  const sum = (f: (r: AssetRow) => number) => rows.reduce((s, r) => s + f(r), 0)
  const finById = useMemo(() => new Map(d.asset_financials.map((f) => [f.asset_id, f])), [d.asset_financials])
  const periodLabel = year === thisYear ? `${year} year to date` : `${year} full year`

  const replaceRows = useMemo(
    () =>
      rows
        .filter((r) => !r.asset.retired_at)
        .map((r) => {
          const fin = finById.get(r.asset.id)
          const ratio = fin?.replacement_cost ? r.lifetime / fin.replacement_cost : null
          const ageYears = fin?.purchase_date ? daysBetween(fin.purchase_date, todayISO()) / 365.25 : null
          return { ...r, fin, ratio, ageYears }
        })
        .sort((a, b) => (b.ratio ?? -1) - (a.ratio ?? -1) || b.lifetime - a.lifetime),
    [rows, finById],
  )

  // Fuel for the selected year, per vehicle, with repairs alongside for cost per mile.
  const fuel = useMemo(() => {
    const all = [...analyseFuel(d.fuel_logs).values()].filter((r) => Number(r.log.filled_on.slice(0, 4)) === year)
    const yearRows = all.filter((r) => kind !== 'equipment' && (kind === 'all' || r.log.asset_id == null || d.assets.find((a) => a.id === r.log.asset_id)?.kind === 'truck'))
    const groups = new Map<string, FuelRow[]>()
    for (const r of yearRows) {
      const k = r.log.asset_id ?? 'other'
      groups.set(k, [...(groups.get(k) ?? []), r])
    }
    const repairsBy = new Map(rows.map((r) => [r.asset.id, r.total]))
    const perVehicle = [...groups.entries()]
      .map(([k, rs]) => {
        const s = summarise(rs)
        const repairs = k === 'other' ? 0 : repairsBy.get(k) ?? 0
        return { key: k, label: k === 'other' ? 'Rentals / other' : d.assets.find((a) => a.id === k)?.label ?? '—', s, repairs, perMile: s.miles > 0 && s.costPerMile != null ? s.costPerMile + repairs / s.miles : null }
      })
      .sort((a, b) => b.s.cost - a.s.cost)
    const months = Array(12).fill(0) as number[]
    for (const r of yearRows) months[Number(r.log.filled_on.slice(5, 7)) - 1] += r.log.total_cost
    return { total: summarise(yearRows), perVehicle, months }
  }, [d.fuel_logs, d.assets, rows, year, kind])

  // Reliability: emergency vs maintenance, outcomes, and the problems that keep coming back.
  const reliability = useMemo(() => {
    const inYear = d.work_orders.filter((w) => Number(w.opened_on.slice(0, 4)) === year && rows.some((r) => r.asset.id === w.asset_id))
    const alerts = repeatAlerts(d.work_orders, rows.map((r) => r.asset), { sameProblemDays: 365 })
    const perAsset = rows
      .map((r) => {
        const ws = inYear.filter((w) => w.asset_id === r.asset.id)
        const emergency = ws.filter((w) => w.repair_type === 'emergency').length
        return {
          asset: r.asset,
          repairs: ws.length,
          emergency,
          maintenance: ws.length - emergency,
          temporary: ws.filter((w) => w.resolution === 'temporary' || w.resolution === 'not_fixed').length,
          repeats: alerts.filter((a) => a.asset.id === r.asset.id && a.kind === 'same_problem').length,
          downtime: r.downtime,
        }
      })
      .filter((x) => x.repairs > 0)
      .sort((a, b) => b.emergency - a.emergency || b.downtime - a.downtime)
    // Fleet-wide most common problems (grouped by similar wording).
    const groups: { label: string; count: number; assets: Set<string>; downtime: number }[] = []
    for (const w of inYear) {
      if (w.repair_type === 'maintenance' || /^\s*(nothing|none)\s*$/i.test(w.problem)) continue
      const g = groups.find((x) => similarProblem(x.label, w.problem))
      const label = rows.find((r) => r.asset.id === w.asset_id)?.asset.label ?? ''
      if (g) {
        g.count++
        g.assets.add(label)
        g.downtime += w.downtime_hours
      } else groups.push({ label: shortProblem(w.problem, 50), count: 1, assets: new Set([label]), downtime: w.downtime_hours })
    }
    const total = inYear.length
    const emergencyAll = inYear.filter((w) => w.repair_type === 'emergency').length
    return {
      perAsset,
      top: groups.filter((g) => g.count >= 2).sort((a, b) => b.count - a.count).slice(0, 10),
      total,
      emergencyShare: total ? emergencyAll / total : null,
      temporary: inYear.filter((w) => w.resolution === 'temporary' || w.resolution === 'not_fixed').length,
    }
  }, [d.work_orders, rows, year])

  if (d.assets.length === 0) {
    return (
      <>
        <PageHead title="Reports" />
        <EmptyState icon="chart" title="Nothing to report yet" action={<Link to="/assets?add=1" className="btn primary">Add your first asset</Link>}>
          Once trucks and machines have work orders, this shows repair cost per asset by month and year, downtime, and a
          repair-vs-replace view.
        </EmptyState>
      </>
    )
  }

  const sections = (): PdfSection[] => [
    {
      title: `Repair cost per asset — ${periodLabel}`,
      head: ['Asset', 'Type', 'Repairs', 'Parts', 'Labor', 'Vendor', 'Total'],
      body: rows.map((r) => [r.asset.label, r.asset.kind === 'truck' ? 'Truck' : r.asset.equipment_type ?? '', r.repairs, fmtMoney(r.parts), fmtMoney(r.labor), fmtMoney(r.vendor), fmtMoney(r.total)]),
      foot: ['Total', '', sum((r) => r.repairs), fmtMoney(sum((r) => r.parts)), fmtMoney(sum((r) => r.labor)), fmtMoney(sum((r) => r.vendor)), fmtMoney(sum((r) => r.total))],
      numeric: [2, 3, 4, 5, 6],
    },
    {
      title: `Repair cost by month — ${year}`,
      head: ['Asset', ...MONTHS, 'Total'],
      body: rows.map((r) => [r.asset.label, ...r.months.map((m) => (m ? fmtMoney0(m) : '')), fmtMoney0(r.total)]),
      foot: ['Total', ...MONTHS.map((_, i) => fmtMoney0(sum((r) => r.months[i]))), fmtMoney0(sum((r) => r.total))],
      numeric: Array.from({ length: 13 }, (_, i) => i + 1),
    },
    {
      title: `Downtime per asset — ${periodLabel}`,
      head: ['Asset', 'Repairs', 'Downtime (h)', 'Avg per repair (h)', 'Lifetime downtime (h)'],
      body: [...rows].sort((a, b) => b.downtime - a.downtime).map((r) => [r.asset.label, r.repairs, fmtNum(r.downtime), r.repairs ? fmtNum(r.downtime / r.repairs) : '—', fmtNum(r.lifetimeDowntime)]),
      foot: ['Total', sum((r) => r.repairs), fmtNum(sum((r) => r.downtime)), '', fmtNum(sum((r) => r.lifetimeDowntime))],
      numeric: [1, 2, 3, 4],
    },
    {
      title: 'Repair vs. replace — running repair cost',
      head: ['Asset', 'Age (yrs)', 'Last 12 mo', 'Lifetime repairs', 'Replacement cost', '% of replacement'],
      body: replaceRows.map((r) => [
        r.asset.label,
        r.ageYears != null ? fmtNum(Math.round(r.ageYears * 10) / 10) : '—',
        fmtMoney(r.last12),
        fmtMoney(r.lifetime),
        r.fin?.replacement_cost ? fmtMoney(r.fin.replacement_cost) : '—',
        r.ratio != null ? `${Math.round(r.ratio * 100)}%` : '—',
      ]),
      numeric: [1, 2, 3, 4, 5],
    },
    ...(reliability.perAsset.length
      ? [
          {
            title: `Reliability — ${periodLabel}`,
            head: ['Asset', 'Repairs', 'Emergency', 'Maintenance', 'Emergency %', 'Temporary / not fixed', 'Repeat problems', 'Downtime (h)'],
            body: reliability.perAsset.map((x) => [x.asset.label, x.repairs, x.emergency, x.maintenance, `${Math.round((x.emergency / x.repairs) * 100)}%`, x.temporary, x.repeats, fmtNum(x.downtime)]),
            numeric: [1, 2, 3, 4, 5, 6, 7],
          },
          {
            title: `Most common problems — ${periodLabel}`,
            head: ['Problem', 'Times', 'Machines', 'Downtime (h)'],
            body: reliability.top.map((g) => [g.label, g.count, [...g.assets].join(', '), fmtNum(g.downtime)]),
            numeric: [1, 3],
          },
        ]
      : []),
    ...(fuel.perVehicle.length
      ? [
          {
            title: `Fuel per vehicle — ${periodLabel}`,
            head: ['Vehicle', 'Fill-ups', 'Gallons', 'Fuel $', 'MPG', 'Fuel $/mi', 'Repairs $', 'Fuel + repairs $/mi'],
            body: fuel.perVehicle.map((v) => [v.label, v.s.fills, fmtNum(Math.round(v.s.gallons)), fmtMoney(v.s.cost), v.s.mpg ? v.s.mpg.toFixed(1) : '—', v.s.costPerMile ? fmtMoney(v.s.costPerMile) : '—', fmtMoney(v.repairs), v.perMile ? fmtMoney(v.perMile) : '—']),
            foot: ['Total', fuel.total.fills, fmtNum(Math.round(fuel.total.gallons)), fmtMoney(fuel.total.cost), fuel.total.mpg ? fuel.total.mpg.toFixed(1) : '—', fuel.total.costPerMile ? fmtMoney(fuel.total.costPerMile) : '—', '', ''],
            numeric: [1, 2, 3, 4, 5, 6, 7],
          },
          {
            title: `Fuel spend by month — ${year}`,
            head: [...MONTHS, 'Total'],
            body: [[...fuel.months.map((m) => (m ? fmtMoney0(m) : '')), fmtMoney0(fuel.total.cost)]],
            numeric: Array.from({ length: 13 }, (_, i) => i),
          },
        ]
      : []),
  ]

  const pdf = async () => {
    setBusy(true)
    try {
      const company = d.settings?.company_name ? `${d.settings.company_name} · ` : ''
      await exportPdf('Fleet repair report', `${company}${periodLabel}${kind !== 'all' ? ` · ${kind === 'truck' ? 'Trucks' : 'Equipment'} only` : ''}`, sections(), `repair-report-${year}.pdf`)
    } catch (e) {
      toast(`PDF failed: ${(e as Error).message}`, true)
    } finally {
      setBusy(false)
    }
  }

  const maxTotal = Math.max(1, ...rows.map((r) => r.total))
  const maxDown = Math.max(1, ...rows.map((r) => r.downtime))

  return (
    <>
      <PageHead
        title="Reports"
        sub={`${periodLabel} · parts + labor + vendor`}
        actions={
          <button className="btn primary" onClick={pdf} disabled={busy}>
            <Icon name="download" /> {busy ? 'Building…' : 'Export PDF'}
          </button>
        }
      />
      <div className="form-grid" style={{ marginBottom: 12 }}>
        <div className="field">
          <label htmlFor="year">Year</label>
          <select id="year" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="kind">Assets</label>
          <select id="kind" value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
            <option value="all">Trucks and equipment</option>
            <option value="truck">Trucks only</option>
            <option value="equipment">Equipment only</option>
          </select>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="label">Total repair cost</div><div className="value" style={{ fontSize: '1.4rem' }}>{fmtMoney0(sum((r) => r.total))}</div></div>
        <div className="stat"><div className="label">Parts</div><div className="value" style={{ fontSize: '1.4rem' }}>{fmtMoney0(sum((r) => r.parts))}</div></div>
        <div className="stat"><div className="label">Labor</div><div className="value" style={{ fontSize: '1.4rem' }}>{fmtMoney0(sum((r) => r.labor))}</div></div>
        <div className="stat"><div className="label">Outside vendors</div><div className="value" style={{ fontSize: '1.4rem' }}>{fmtMoney0(sum((r) => r.vendor))}</div></div>
        <div className="stat"><div className="label">Downtime</div><div className="value" style={{ fontSize: '1.4rem' }}>{fmtHours(sum((r) => r.downtime))}</div></div>
        {kind !== 'equipment' && <div className="stat"><div className="label">Fuel</div><div className="value" style={{ fontSize: '1.4rem' }}>{fmtMoney0(fuel.total.cost)}</div></div>}
      </div>

      <div className="tabs" role="tablist">
        {([
          ['cost', 'Cost per asset'],
          ['monthly', 'By month'],
          ['downtime', 'Downtime'],
          ['replace', 'Repair vs. replace'],
          ['fuel', 'Fuel & cost per mile'],
          ['reliability', 'Reliability'],
        ] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {d.work_orders.length === 0 && (
        <div className="banner info" style={{ marginBottom: 12 }}>
          No work orders yet — numbers fill in as repairs are logged or imported.
        </div>
      )}

      {tab === 'cost' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="num">Repairs</th>
                <th className="num">Parts</th>
                <th className="num">Labor</th>
                <th className="num">Vendor</th>
                <th className="num">Total</th>
                <th style={{ width: '18%' }} aria-label="Share" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.asset.id}>
                  <td><Link to={`/assets/${r.asset.id}`}>{r.asset.label}</Link></td>
                  <td className="num">{r.repairs}</td>
                  <td className="num">{fmtMoney(r.parts)}</td>
                  <td className="num">{fmtMoney(r.labor)}</td>
                  <td className="num">{fmtMoney(r.vendor)}</td>
                  <td className="num"><strong>{fmtMoney(r.total)}</strong></td>
                  <td><div className="bar"><div style={{ width: `${(r.total / maxTotal) * 100}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td className="num">{sum((r) => r.repairs)}</td>
                <td className="num">{fmtMoney(sum((r) => r.parts))}</td>
                <td className="num">{fmtMoney(sum((r) => r.labor))}</td>
                <td className="num">{fmtMoney(sum((r) => r.vendor))}</td>
                <td className="num">{fmtMoney(sum((r) => r.total))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {tab === 'monthly' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                {MONTHS.map((m) => <th key={m} className="num">{m}</th>)}
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.asset.id}>
                  <td className="nowrap"><Link to={`/assets/${r.asset.id}`}>{r.asset.label}</Link></td>
                  {r.months.map((m, i) => <td key={i} className="num">{m ? fmtMoney0(m) : <span className="muted">–</span>}</td>)}
                  <td className="num"><strong>{fmtMoney0(r.total)}</strong></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                {MONTHS.map((_, i) => <td key={i} className="num">{fmtMoney0(sum((r) => r.months[i]))}</td>)}
                <td className="num">{fmtMoney0(sum((r) => r.total))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {tab === 'downtime' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Asset</th>
                <th className="num">Repairs</th>
                <th className="num">Downtime</th>
                <th className="num">Avg / repair</th>
                <th className="num">Lifetime</th>
                <th style={{ width: '22%' }} aria-label="Share" />
              </tr>
            </thead>
            <tbody>
              {[...rows].sort((a, b) => b.downtime - a.downtime).map((r) => (
                <tr key={r.asset.id}>
                  <td><Link to={`/assets/${r.asset.id}`}>{r.asset.label}</Link></td>
                  <td className="num">{r.repairs}</td>
                  <td className="num"><strong>{fmtHours(r.downtime)}</strong></td>
                  <td className="num">{r.repairs ? fmtHours(r.downtime / r.repairs) : '—'}</td>
                  <td className="num">{fmtHours(r.lifetimeDowntime)}</td>
                  <td><div className="bar warn"><div style={{ width: `${(r.downtime / maxDown) * 100}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'reliability' && (
        reliability.total === 0 ? (
          <EmptyState icon="wrench" title={`No repairs in ${year}`}>
            Emergency vs. maintenance, temporary fixes and the problems that keep coming back show up here.
          </EmptyState>
        ) : (
          <div className="stack">
            <div className="stats">
              <div className={`stat${reliability.emergencyShare != null && reliability.emergencyShare > 0.6 ? ' warn' : ''}`}>
                <div className="label">Emergency repairs</div>
                <div className="value">{reliability.emergencyShare != null ? `${Math.round(reliability.emergencyShare * 100)}%` : '—'}</div>
                <div className="small muted">of {reliability.total} work orders</div>
              </div>
              <div className={`stat${reliability.temporary ? ' warn' : ''}`}>
                <div className="label">Temporary / not fixed</div>
                <div className="value">{reliability.temporary}</div>
              </div>
            </div>
            {reliability.emergencyShare != null && reliability.emergencyShare > 0.6 && (
              <p className="small muted">
                Most work is breakdowns rather than planned maintenance. The machines at the top of this list are where a
                maintenance schedule is most likely to pay off.
              </p>
            )}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="num">Repairs</th>
                    <th className="num">Emergency</th>
                    <th className="num">Maintenance</th>
                    <th className="num">Temp / not fixed</th>
                    <th className="num">Repeat problems</th>
                    <th className="num">Downtime</th>
                  </tr>
                </thead>
                <tbody>
                  {reliability.perAsset.map((x) => (
                    <tr key={x.asset.id}>
                      <td><Link to={`/assets/${x.asset.id}`}>{x.asset.label}</Link></td>
                      <td className="num">{x.repairs}</td>
                      <td className="num"><strong>{x.emergency}</strong></td>
                      <td className="num">{x.maintenance}</td>
                      <td className="num">{x.temporary || ''}</td>
                      <td className="num">{x.repeats ? <span className="pill danger">{x.repeats}</span> : ''}</td>
                      <td className="num">{fmtHours(x.downtime)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {reliability.top.length > 0 && (
              <>
                <h2>Most common problems</h2>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Problem</th>
                        <th className="num">Times</th>
                        <th>Machines</th>
                        <th className="num">Downtime</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reliability.top.map((g) => (
                        <tr key={g.label}>
                          <td>{g.label}</td>
                          <td className="num"><strong>{g.count}</strong></td>
                          <td>{[...g.assets].join(', ')}</td>
                          <td className="num">{fmtHours(g.downtime)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )
      )}

      {tab === 'fuel' && (
        fuel.perVehicle.length === 0 ? (
          <EmptyState icon="fuel" title={`No fill-ups in ${year}`} action={<Link to="/fuel/new" className="btn primary">Log fuel</Link>}>
            Fuel spend, MPG and cost per mile (fuel + repairs) per truck show up here.
          </EmptyState>
        ) : (
          <div className="stack">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th className="num">Fill-ups</th>
                    <th className="num">Gallons</th>
                    <th className="num">Fuel</th>
                    <th className="num">MPG</th>
                    <th className="num">Fuel $/mi</th>
                    <th className="num">Repairs</th>
                    <th className="num">Fuel + repairs $/mi</th>
                  </tr>
                </thead>
                <tbody>
                  {fuel.perVehicle.map((v) => (
                    <tr key={v.key}>
                      <td>{v.key === 'other' ? v.label : <Link to={`/assets/${v.key}`}>{v.label}</Link>}</td>
                      <td className="num">{v.s.fills}</td>
                      <td className="num">{fmtNum(Math.round(v.s.gallons))}</td>
                      <td className="num"><strong>{fmtMoney(v.s.cost)}</strong></td>
                      <td className="num">{v.s.mpg ? v.s.mpg.toFixed(1) : '—'}</td>
                      <td className="num">{v.s.costPerMile ? fmtMoney(v.s.costPerMile) : '—'}</td>
                      <td className="num">{fmtMoney(v.repairs)}</td>
                      <td className="num"><strong>{v.perMile ? fmtMoney(v.perMile) : '—'}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total</td>
                    <td className="num">{fuel.total.fills}</td>
                    <td className="num">{fmtNum(Math.round(fuel.total.gallons))}</td>
                    <td className="num">{fmtMoney(fuel.total.cost)}</td>
                    <td className="num">{fuel.total.mpg ? fuel.total.mpg.toFixed(1) : '—'}</td>
                    <td className="num">{fuel.total.costPerMile ? fmtMoney(fuel.total.costPerMile) : '—'}</td>
                    <td />
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>{MONTHS.map((m) => <th key={m} className="num">{m}</th>)}<th className="num">Total</th></tr>
                </thead>
                <tbody>
                  <tr>{fuel.months.map((m, i) => <td key={i} className="num">{m ? fmtMoney0(m) : <span className="muted">–</span>}</td>)}<td className="num"><strong>{fmtMoney0(fuel.total.cost)}</strong></td></tr>
                </tbody>
              </table>
            </div>
            <p className="small muted">MPG and per-mile figures only use stretches between two full-tank fill-ups with odometer readings, and skip entries flagged as unusual. Rentals have no odometer tracking, so they count toward spend only.</p>
          </div>
        )
      )}

      {tab === 'replace' && (
        <>
          <p className="muted small" style={{ marginBottom: 12 }}>
            Running repair cost against each asset's replacement cost. A common rule of thumb is to look hard at replacing
            once lifetime repairs pass about half the replacement cost — but weigh age, reliability and downtime too. Set
            replacement costs on each asset under Edit.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th className="num">Age</th>
                  <th className="num">Last 12 mo</th>
                  <th className="num">Lifetime repairs</th>
                  <th className="num">Replacement</th>
                  <th style={{ width: '22%' }}>% of replacement</th>
                </tr>
              </thead>
              <tbody>
                {replaceRows.map((r) => (
                  <tr key={r.asset.id}>
                    <td><Link to={`/assets/${r.asset.id}`}>{r.asset.label}</Link></td>
                    <td className="num">{r.ageYears != null ? `${fmtNum(Math.round(r.ageYears * 10) / 10)} yr` : '—'}</td>
                    <td className="num">{fmtMoney(r.last12)}</td>
                    <td className="num"><strong>{fmtMoney(r.lifetime)}</strong></td>
                    <td className="num">{r.fin?.replacement_cost ? fmtMoney(r.fin.replacement_cost) : <span className="muted">not set</span>}</td>
                    <td>
                      {r.ratio != null ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div className={`bar${r.ratio >= 0.5 ? ' danger' : r.ratio >= 0.3 ? ' warn' : ''}`} style={{ flex: 1 }}>
                            <div style={{ width: `${Math.min(100, r.ratio * 100)}%` }} />
                          </div>
                          <span className="num small">{Math.round(r.ratio * 100)}%</span>
                        </div>
                      ) : (
                        <span className="muted small">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {replaceRows.some((r) => r.fin?.purchase_date) && (
            <p className="small muted" style={{ marginTop: 8 }}>Ages are from the purchase date set on each asset (as of {fmtDate(todayISO())}).</p>
          )}
        </>
      )}
    </>
  )
}
