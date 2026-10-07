import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useData, useLookups, woCost } from '../state/data'
import { useRole } from '../state/auth'
import { supabase, must } from '../lib/supabase'
import { cap, fmtDate, fmtHours, fmtMiles, fmtMoney, fmtNum, toNum } from '../lib/format'
import { pmStatus, PM_LABEL } from '../lib/pm'
import type { Asset, PmSchedule } from '../lib/types'
import { AssetForm } from '../components/AssetForm'
import { PmForm } from '../components/PmForm'
import { ConfirmButton, EmptyState, Field, Segmented, Sheet, StatusPill, useToast } from '../components/ui'
import { Icon } from '../components/Icon'
import { analyseFuel, summarise, type FuelRow } from '../lib/fuel'
import { FuelRowItem } from './Fuel'
import { repeatAlerts } from '../lib/reliability'
import { RepeatAlerts } from '../components/RepeatAlerts'

export function AssetDetail() {
  const { id } = useParams()
  const d = useData()
  const { isAdmin } = useRole()
  const { costByWo, partsByWo, profileById } = useLookups()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [pmEdit, setPmEdit] = useState<PmSchedule | 'new' | null>(null)
  const [mileageOpen, setMileageOpen] = useState(false)
  const asset = d.assets.find((a) => a.id === id)

  const wos = useMemo(
    () => d.work_orders.filter((w) => w.asset_id === id).sort((a, b) => b.opened_on.localeCompare(a.opened_on)),
    [d.work_orders, id],
  )
  const pms = d.pm_schedules.filter((s) => s.asset_id === id)
  const fits = d.part_fits.filter((x) => x.asset_id === id).map((x) => d.parts.find((p) => p.id === x.part_id)).filter(Boolean)
  const fin = d.asset_financials.find((x) => x.asset_id === id)
  const repeats = useMemo(() => (asset ? repeatAlerts(d.work_orders, [asset]) : []), [d.work_orders, asset])
  const fuelRows = useMemo(
    () =>
      [...analyseFuel(d.fuel_logs).values()]
        .filter((r) => r.log.asset_id === id)
        .sort((a, b) => b.log.filled_on.localeCompare(a.log.filled_on) || b.log.created_at.localeCompare(a.log.created_at)),
    [d.fuel_logs, id],
  )

  if (!asset) {
    return (
      <EmptyState icon="truck" title="Asset not found" action={<Link to="/assets" className="btn">Back to assets</Link>}>
        It may have been deleted.
      </EmptyState>
    )
  }

  const year = String(new Date().getFullYear())
  let lifetime = 0
  let ytd = 0
  let downtime = 0
  for (const w of wos) {
    const c = woCost(w, costByWo.get(w.id), partsByWo.get(w.id)).total
    lifetime += c
    if (w.opened_on.startsWith(year)) ytd += c
    downtime += w.downtime_hours
  }
  const ratio = fin?.replacement_cost ? lifetime / fin.replacement_cost : null

  const setStatus = async (status: Asset['status']) => {
    try {
      const a = must(await supabase.from('assets').update({ status }).eq('id', asset.id).select().single())
      d.upsertLocal('assets', a as Asset)
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  const retire = async (retired: boolean) => {
    try {
      const a = must(
        await supabase.from('assets').update({ retired_at: retired ? new Date().toISOString() : null }).eq('id', asset.id).select().single(),
      )
      d.upsertLocal('assets', a as Asset)
      toast(retired ? `${asset.label} retired` : `${asset.label} restored`)
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{asset.label}</h1>
          <p className="sub muted">
            {asset.kind === 'truck'
              ? [asset.year, asset.make, asset.model].filter(Boolean).join(' ') || 'Truck'
              : [cap(asset.equipment_type ?? ''), asset.make, asset.model].filter(Boolean).join(' · ')}
            {asset.retired_at && ` · retired ${fmtDate(asset.retired_at)}`}
          </p>
        </div>
        <div className="actions">
          <Link to={`/work-orders/new?asset=${asset.id}`} className="btn primary">
            <Icon name="plus" /> Work order
          </Link>
          {isAdmin && (
            <button className="btn" onClick={() => setEditing(true)}>
              <Icon name="edit" /> Edit
            </button>
          )}
        </div>
      </div>

      {repeats.length > 0 && (
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Repeat problems</h2>
          <RepeatAlerts alerts={repeats} />
        </section>
      )}

      <section className="card">
        <div className="field">
          <span className="label">Status</span>
          <Segmented
            label="Status"
            value={asset.status}
            onChange={setStatus}
            options={[
              { value: 'in_service', label: 'In service' },
              { value: 'down', label: 'Down' },
            ]}
          />
        </div>
      </section>

      <div className="grid grid-2">
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Details</h2>
          <dl className="kv">
            {asset.kind === 'truck' ? (
              <>
                <dt>Unit</dt>
                <dd>{asset.unit_number}</dd>
                <dt>VIN</dt>
                <dd>{asset.vin || '—'}</dd>
                <dt>Mileage</dt>
                <dd>
                  {fmtMiles(asset.current_mileage)}{' '}
                  <button className="btn ghost" style={{ minHeight: 36, padding: '0 8px' }} onClick={() => setMileageOpen(true)}>
                    Update
                  </button>
                </dd>
              </>
            ) : (
              <>
                <dt>Type</dt>
                <dd>{cap(asset.equipment_type ?? '')}</dd>
                <dt>Serial #</dt>
                <dd>{asset.serial_number || '—'}</dd>
              </>
            )}
            <dt>Make / model</dt>
            <dd>{[asset.make, asset.model].filter(Boolean).join(' ') || '—'}</dd>
            {asset.notes && (
              <>
                <dt>Notes</dt>
                <dd>{asset.notes}</dd>
              </>
            )}
          </dl>
        </section>

        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Repair history</h2>
          <div className="stats">
            <div className="stat">
              <div className="label">Repairs</div>
              <div className="value">{wos.length}</div>
            </div>
            <div className="stat">
              <div className="label">Downtime</div>
              <div className="value">{fmtHours(downtime)}</div>
            </div>
            <div className="stat">
              <div className="label">Cost {year} YTD</div>
              <div className="value" style={{ fontSize: '1.3rem' }}>{fmtMoney(ytd)}</div>
            </div>
            <div className="stat">
              <div className="label">Lifetime cost</div>
              <div className="value" style={{ fontSize: '1.3rem' }}>{fmtMoney(lifetime)}</div>
            </div>
          </div>
          {isAdmin && ratio != null && (
            <p className={`banner ${ratio >= 0.5 ? 'error' : ratio >= 0.3 ? 'warn' : 'ok'}`} style={{ marginTop: 12 }}>
              Repairs so far are {Math.round(ratio * 100)}% of the {fmtMoney(fin!.replacement_cost)} replacement cost.
            </p>
          )}
        </section>
      </div>

      {asset.kind === 'truck' && <TruckFuel rows={fuelRows} year={year} repairsYtd={ytd} assetId={asset.id} />}

      <section className="card">
        <div className="card-head">
          <h2>Preventive maintenance</h2>
          {isAdmin && (
            <button className="btn" onClick={() => setPmEdit('new')}>
              <Icon name="plus" /> Add schedule
            </button>
          )}
        </div>
        {pms.length === 0 ? (
          <p className="muted">
            No schedules.{' '}
            {asset.kind === 'truck' ? 'Trucks are scheduled by mileage (and optionally days).' : 'Equipment is scheduled by date.'}
          </p>
        ) : (
          <div className="list">
            {pms.map((s) => {
              const st = pmStatus(s, asset)
              return (
                <div key={s.id} className="row" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                  <div className="grow">
                    <div className="title">{s.task}</div>
                    <div className="meta">
                      Every {[s.interval_miles && `${fmtNum(s.interval_miles)} mi`, s.interval_days && `${s.interval_days} days`].filter(Boolean).join(' or ')}
                      {st.dueMiles != null && ` · due at ${fmtNum(st.dueMiles)} mi`}
                      {st.dueDate && ` · due ${fmtDate(st.dueDate)}`}
                    </div>
                  </div>
                  <span className={`pill ${st.state}`}>{PM_LABEL[st.state]}</span>
                  <Link to={`/work-orders/new?asset=${asset.id}&pm=${s.id}`} className="btn">Log it</Link>
                  {isAdmin && (
                    <button className="icon-btn" onClick={() => setPmEdit(s)} aria-label={`Edit ${s.task}`}>
                      <Icon name="edit" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Work orders</h2>
        {wos.length === 0 ? (
          <p className="muted">No repairs logged on this {asset.kind === 'truck' ? 'truck' : 'machine'} yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Date</th>
                  <th>Problem</th>
                  <th>By</th>
                  <th>Status</th>
                  {asset.kind === 'truck' && <th className="num">Miles</th>}
                  <th className="num">Down</th>
                  <th className="num">Cost</th>
                </tr>
              </thead>
              <tbody>
                {wos.map((w) => (
                  <tr key={w.id}>
                    <td><Link to={`/work-orders/${w.id}`}>{w.number}</Link></td>
                    <td className="nowrap">{fmtDate(w.opened_on)}</td>
                    <td>{w.problem}</td>
                    <td>{profileById.get(w.assigned_to ?? '')?.full_name ?? d.vendors.find((v) => v.id === w.vendor_id)?.name ?? w.assigned_name ?? '—'}</td>
                    <td><StatusPill status={w.status} /></td>
                    {asset.kind === 'truck' && <td className="num">{fmtNum(w.mileage)}</td>}
                    <td className="num">{fmtHours(w.downtime_hours)}</td>
                    <td className="num">{fmtMoney(woCost(w, costByWo.get(w.id), partsByWo.get(w.id)).total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {fits.length > 0 && (
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Parts that fit</h2>
          <div className="list">
            {fits.map((p) => (
              <Link key={p!.id} to={`/parts?q=${encodeURIComponent(p!.part_number)}`} className="row">
                <div className="grow">
                  <div className="title">{p!.part_number} · {p!.description}</div>
                  <div className="meta">{fmtNum(p!.qty_on_hand)} on hand</div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {isAdmin && (
        <div style={{ marginTop: 12 }}>
          {asset.retired_at ? (
            <button className="btn" onClick={() => retire(false)}>Restore to active</button>
          ) : (
            <ConfirmButton confirmText="Tap again to retire" onConfirm={() => retire(true)}>
              Retire this asset
            </ConfirmButton>
          )}
          <p className="small muted" style={{ marginTop: 6 }}>Retired assets keep their history but drop off pickers and lists.</p>
        </div>
      )}

      {editing && <AssetForm asset={asset} onClose={() => setEditing(false)} />}
      {pmEdit && <PmForm schedule={pmEdit === 'new' ? undefined : pmEdit} assetId={asset.id} onClose={() => setPmEdit(null)} />}
      {mileageOpen && <MileageSheet asset={asset} onClose={() => setMileageOpen(false)} />}
    </div>
  )
}

function MileageSheet({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const d = useData()
  const toast = useToast()
  const [v, setV] = useState(asset.current_mileage != null ? String(asset.current_mileage) : '')
  const save = async () => {
    const n = toNum(v)
    if (n == null || n < 0) return toast('Enter a valid mileage.', true)
    if (asset.current_mileage != null && n < asset.current_mileage && !confirm('That is lower than the current reading. Save anyway?')) return
    try {
      const a = must(await supabase.from('assets').update({ current_mileage: Math.round(n) }).eq('id', asset.id).select().single())
      d.upsertLocal('assets', a as Asset)
      toast('Mileage updated')
      onClose()
    } catch (e) {
      toast((e as Error).message, true)
    }
  }
  return (
    <Sheet
      title={`Mileage — ${asset.label}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </>
      }
    >
      <Field label="Odometer reading" htmlFor="odo">
        <input id="odo" inputMode="numeric" value={v} onChange={(e) => setV(e.target.value)} autoFocus />
      </Field>
    </Sheet>
  )
}

function TruckFuel({ rows, year, repairsYtd, assetId }: { rows: FuelRow[]; year: string; repairsYtd: number; assetId: string }) {
  const ytdRows = rows.filter((r) => r.log.filled_on.startsWith(year))
  const s = summarise(ytdRows)
  const all = summarise(rows)
  const repairPerMile = s.miles > 0 ? repairsYtd / s.miles : null
  return (
    <section className="card">
      <div className="card-head">
        <h2>Fuel</h2>
        <Link to="/fuel/new" className="btn">
          <Icon name="plus" /> Log fuel
        </Link>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No fill-ups logged for this truck yet.</p>
      ) : (
        <>
          <div className="stats" style={{ marginBottom: 12 }}>
            <div className="stat"><div className="label">Fuel {year} YTD</div><div className="value" style={{ fontSize: '1.3rem' }}>{fmtMoney(s.cost)}</div></div>
            <div className="stat"><div className="label">MPG {year}</div><div className="value" style={{ fontSize: '1.3rem' }}>{s.mpg ? s.mpg.toFixed(1) : '—'}</div><div className="small muted">lifetime {all.mpg ? all.mpg.toFixed(1) : '—'}</div></div>
            <div className="stat"><div className="label">Fuel per mile</div><div className="value" style={{ fontSize: '1.3rem' }}>{s.costPerMile ? fmtMoney(s.costPerMile) : '—'}</div></div>
            <div className="stat"><div className="label">Fuel + repairs per mile</div><div className="value" style={{ fontSize: '1.3rem' }}>{s.costPerMile != null && repairPerMile != null ? fmtMoney(s.costPerMile + repairPerMile) : '—'}</div></div>
          </div>
          <div className="list">
            {rows.slice(0, 5).map((r) => <FuelRowItem key={r.log.id} r={r} showWho />)}
          </div>
          {rows.length > 5 && (
            <Link to={`/fuel?truck=${assetId}&period=all`} className="btn ghost" style={{ marginTop: 8 }}>
              All {rows.length} fill-ups
            </Link>
          )}
        </>
      )}
    </section>
  )
}
