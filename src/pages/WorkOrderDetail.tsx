import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth, useRole } from '../state/auth'
import { useData, useLookups, woCost } from '../state/data'
import { supabase, must } from '../lib/supabase'
import { fmtDate, fmtMiles, fmtMoney, fmtNum, toNum } from '../lib/format'
import type { Part, Resolution, WoStatus, WorkOrder, WorkOrderPart } from '../lib/types'
import { similarHistory } from '../lib/reliability'
import { WorkOrderPhotos } from '../components/Photos'
import { ConfirmButton, EmptyState, Field, Search, Segmented, Sheet, Spinner, Stepper, StatusPill, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

export function WorkOrderDetail() {
  const { id } = useParams()
  const d = useData()
  const { isStaff } = useRole()
  const wo = d.work_orders.find((w) => w.id === id)
  if (!wo) {
    return d.loading ? (
      <Spinner />
    ) : (
      <EmptyState icon="wrench" title="Work order not found" action={<Link to="/work-orders" className="btn">Back to work orders</Link>}>
        It may have been deleted, or you don't have access to it.
      </EmptyState>
    )
  }
  return isStaff ? <StaffView key={wo.id} wo={wo} /> : <DriverView wo={wo} />
}

/* ---------------- Driver: read-only, no costs ---------------- */
function DriverView({ wo }: { wo: WorkOrder }) {
  const { assetById } = useLookups()
  const { profile } = useAuth()
  const a = assetById.get(wo.asset_id)
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            {a?.label} · #{wo.number}
          </h1>
          <p className="sub muted">Reported {fmtDate(wo.opened_on)}</p>
        </div>
        <StatusPill status={wo.status} />
      </div>
      <section className="card">
        <dl className="kv">
          <dt>Problem</dt>
          <dd>{wo.problem}</dd>
          {wo.mileage != null && (
            <>
              <dt>Mileage</dt>
              <dd>{fmtMiles(wo.mileage)}</dd>
            </>
          )}
          <dt>Fix</dt>
          <dd>{wo.fix || <span className="muted">Not fixed yet</span>}</dd>
          {wo.closed_at && (
            <>
              <dt>Closed</dt>
              <dd>{fmtDate(wo.closed_at)}</dd>
            </>
          )}
        </dl>
      </section>
      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Photos</h2>
        <WorkOrderPhotos workOrderId={wo.id} canDelete={(p) => p.uploaded_by === profile?.id} />
      </section>
    </div>
  )
}

/* ---------------- Admin + mechanic ---------------- */
function StaffView({ wo }: { wo: WorkOrder }) {
  const d = useData()
  const { profile } = useAuth()
  const { isAdmin } = useRole()
  const { assetById, profileById, partById, costByWo, partsByWo } = useLookups()
  const toast = useToast()
  const nav = useNavigate()
  const asset = assetById.get(wo.asset_id)
  const cost = costByWo.get(wo.id)
  const lines = partsByWo.get(wo.id) ?? []
  const totals = woCost(wo, cost, lines)

  // Editable copy of the work order + cost fields
  const initial = useMemo(
    () => ({
      problem: wo.problem,
      fix: wo.fix ?? '',
      labor_hours: wo.labor_hours,
      downtime_hours: wo.downtime_hours,
      mileage: wo.mileage == null ? '' : String(wo.mileage),
      opened_on: wo.opened_on,
      assign: wo.assigned_to ? `p:${wo.assigned_to}` : wo.vendor_id ? `v:${wo.vendor_id}` : '',
      pm_schedule_id: wo.pm_schedule_id ?? '',
      repair_type: wo.repair_type,
      notes: wo.notes ?? '',
      labor_rate: String(cost?.labor_rate ?? 0),
      vendor_cost: String(cost?.vendor_cost ?? 0),
      other_parts_cost: String(cost?.other_parts_cost ?? 0),
    }),
    [wo, cost],
  )
  const [f, setF] = useState(initial)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [addPart, setAddPart] = useState(false)
  const [closing, setClosing] = useState(false)

  // Pick up remote changes when I have no unsaved edits.
  useEffect(() => {
    if (!dirty) setF(initial)
  }, [initial, dirty])

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => {
    setF((x) => ({ ...x, [k]: v }))
    setDirty(true)
  }

  const mechanics = d.profiles.filter((p) => p.active && (p.role === 'mechanic' || p.role === 'admin'))
  const vendors = d.vendors.filter((v) => !v.retired_at || v.id === wo.vendor_id)
  const pms = d.pm_schedules.filter((s) => s.asset_id === wo.asset_id)

  const save = async (extra: Partial<WorkOrder> = {}) => {
    const miles = toNum(f.mileage)
    if (asset?.kind === 'truck' && f.mileage && miles == null) return toast('Mileage must be a number.', true)
    if (!f.problem.trim()) return toast('Problem can’t be empty.', true)
    const rate = toNum(f.labor_rate) ?? 0
    const vendorCost = toNum(f.vendor_cost) ?? 0
    const other = toNum(f.other_parts_cost) ?? 0
    setSaving(true)
    try {
      const upd = must(
        await supabase
          .from('work_orders')
          .update({
            problem: f.problem.trim(),
            fix: f.fix.trim() || null,
            labor_hours: f.labor_hours,
            downtime_hours: f.downtime_hours,
            mileage: asset?.kind === 'truck' ? miles : null,
            opened_on: f.opened_on,
            assigned_to: f.assign.startsWith('p:') ? f.assign.slice(2) : null,
            vendor_id: f.assign.startsWith('v:') ? f.assign.slice(2) : null,
            pm_schedule_id: f.pm_schedule_id || null,
            repair_type: f.repair_type,
            notes: f.notes.trim() || null,
            ...extra,
          })
          .eq('id', wo.id)
          .select()
          .single(),
      )
      d.upsertLocal('work_orders', upd as WorkOrder)
      const c = must(
        await supabase
          .from('work_order_costs')
          .upsert({ work_order_id: wo.id, labor_rate: rate, vendor_cost: vendorCost, other_parts_cost: other })
          .select()
          .single(),
      )
      d.upsertLocal('work_order_costs', c as any)
      setDirty(false)
      toast('Saved')
      return true
    } catch (e) {
      toast((e as Error).message, true)
      return false
    } finally {
      setSaving(false)
    }
  }

  const setStatus = async (s: WoStatus) => {
    if (s === 'done') return setClosing(true)
    await save({ status: s })
  }

  const removeLine = async (line: WorkOrderPart) => {
    try {
      must(await supabase.from('work_order_parts').delete().eq('id', line.id))
      d.removeLocal('work_order_parts', line.id)
      toast('Part removed and returned to stock')
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  const changeQty = async (line: WorkOrderPart, qty: number) => {
    if (qty <= 0) return removeLine(line)
    try {
      const row = must(await supabase.from('work_order_parts').update({ quantity: qty }).eq('id', line.id).select().single())
      d.upsertLocal('work_order_parts', row as WorkOrderPart)
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  const who = profileById.get(wo.reported_by ?? '')?.full_name ?? wo.reported_by_name

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>
            <Link to={`/assets/${wo.asset_id}`} style={{ color: 'inherit' }}>
              {asset?.label ?? 'Unknown asset'}
            </Link>{' '}
            · #{wo.number}
          </h1>
          <p className="sub muted">
            Opened {fmtDate(wo.opened_on)}
            {who && ` by ${who}`}
            {wo.source === 'driver' && ' (driver report)'}
            {wo.source === 'import' && ' (imported)'}
            {wo.closed_at && ` · closed ${fmtDate(wo.closed_at)}`}
          </p>
        </div>
        <div className="actions">
          <StatusPill status={wo.repair_type} />
          {wo.resolution && <StatusPill status={wo.resolution} />}
          <StatusPill status={wo.status} />
        </div>
      </div>

      {asset?.status === 'down' && wo.status !== 'done' && (
        <div className="banner error">{asset.label} is marked down.</div>
      )}

      <section className="card">
        <div className="field">
          <span className="label">Status</span>
          <Segmented
            label="Status"
            value={wo.status}
            onChange={setStatus}
            options={[
              { value: 'open', label: 'Open' },
              { value: 'waiting_parts', label: 'Waiting on parts' },
              { value: 'done', label: 'Done' },
            ]}
          />
        </div>
      </section>

      <section className="card form">
        <h2>Details</h2>
        <Field label="Problem" htmlFor="problem">
          <textarea id="problem" value={f.problem} onChange={(e) => set('problem', e.target.value)} />
        </Field>
        <div className="field">
          <span className="label">Type</span>
          <Segmented
            label="Repair type"
            value={f.pm_schedule_id ? 'maintenance' : f.repair_type}
            onChange={(v) => set('repair_type', v)}
            options={[
              { value: 'emergency', label: 'Emergency / breakdown' },
              { value: 'maintenance', label: 'Maintenance' },
            ]}
          />
          {f.pm_schedule_id && <span className="hint">Linked to scheduled maintenance, so it counts as maintenance.</span>}
        </div>
        <Field label="Fix / work done" htmlFor="fix">
          <textarea id="fix" value={f.fix} onChange={(e) => set('fix', e.target.value)} placeholder="What was done" />
        </Field>
        <Field label="Notes for next time" htmlFor="notes" hint="Shown whenever this problem comes up again on this machine.">
          <textarea id="notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="e.g. Check the keypad wiring first" />
        </Field>
        <div className="form-grid">
          <Field label="Labor hours" htmlFor="hours">
            <Stepper id="hours" label="Labor hours" step={0.5} value={f.labor_hours} onChange={(v) => set('labor_hours', v)} />
          </Field>
          <Field label="Downtime hours" htmlFor="down" hint="How long the asset was out of use.">
            <Stepper id="down" label="Downtime hours" step={1} value={f.downtime_hours} onChange={(v) => set('downtime_hours', v)} />
          </Field>
        </div>
        <div className="form-grid">
          {asset?.kind === 'truck' && (
            <Field label="Mileage at repair" htmlFor="mileage">
              <input id="mileage" inputMode="numeric" value={f.mileage} onChange={(e) => set('mileage', e.target.value)} />
            </Field>
          )}
          <Field label="Date opened" htmlFor="opened">
            <input id="opened" type="date" value={f.opened_on} onChange={(e) => set('opened_on', e.target.value)} />
          </Field>
          <Field label="Assigned to" htmlFor="assign">
            <select id="assign" value={f.assign} onChange={(e) => set('assign', e.target.value)}>
              <option value="">Unassigned</option>
              <optgroup label="Mechanics">
                {mechanics.map((m) => (
                  <option key={m.id} value={`p:${m.id}`}>{m.full_name}</option>
                ))}
              </optgroup>
              {vendors.length > 0 && (
                <optgroup label="Outside vendors">
                  {vendors.map((v) => (
                    <option key={v.id} value={`v:${v.id}`}>{v.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {wo.assigned_name && !wo.assigned_to && !wo.vendor_id && <span className="hint">Imported as: {wo.assigned_name}</span>}
          </Field>
          {pms.length > 0 && (
            <Field label="Scheduled maintenance" htmlFor="pm">
              <select id="pm" value={f.pm_schedule_id} onChange={(e) => set('pm_schedule_id', e.target.value)}>
                <option value="">Not scheduled maintenance</option>
                {pms.map((s) => (
                  <option key={s.id} value={s.id}>{s.task}</option>
                ))}
              </select>
            </Field>
          )}
        </div>
      </section>

      <SimilarHistory wo={wo} />

      <section className="card">
        <div className="card-head">
          <h2>Parts used</h2>
          <button className="btn primary" onClick={() => setAddPart(true)}>
            <Icon name="plus" /> Add part
          </button>
        </div>
        {lines.length === 0 ? (
          <p className="muted">
            No parts from inventory yet. Adding a part takes it out of stock automatically.
          </p>
        ) : (
          <div className="list">
            {lines.map((l) => {
              const p = partById.get(l.part_id)
              return (
                <div key={l.id} className="row" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                  <div className="grow" style={{ minWidth: 160 }}>
                    <div className="title">{p ? `${p.part_number} · ${p.description}` : 'Part'}</div>
                    <div className="meta">
                      {fmtMoney(l.unit_cost)} each · {fmtMoney(l.quantity * (l.unit_cost ?? 0))}
                    </div>
                  </div>
                  <div style={{ width: 170 }}>
                    <Stepper label="Quantity" value={l.quantity} onChange={(v) => changeQty(l, v)} />
                  </div>
                  <ConfirmButton className="icon-btn" confirmText="✓?" onConfirm={() => removeLine(l)}>
                    <Icon name="trash" title="Remove part" />
                  </ConfirmButton>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="card form">
        <h2>Costs</h2>
        <div className="form-grid">
          <Field label="Labor rate ($/hour)" htmlFor="rate">
            <input id="rate" inputMode="decimal" value={f.labor_rate} onChange={(e) => set('labor_rate', e.target.value)} />
          </Field>
          <Field label="Outside vendor cost" htmlFor="vcost">
            <input id="vcost" inputMode="decimal" value={f.vendor_cost} onChange={(e) => set('vendor_cost', e.target.value)} />
          </Field>
          <Field label="Other parts (not from stock)" htmlFor="other" hint="e.g. bought at the parts store">
            <input id="other" inputMode="decimal" value={f.other_parts_cost} onChange={(e) => set('other_parts_cost', e.target.value)} />
          </Field>
        </div>
        <div className="table-wrap">
          <table>
            <tbody>
              <tr>
                <td>Labor ({fmtNum(wo.labor_hours)} h × {fmtMoney(cost?.labor_rate)})</td>
                <td className="num">{fmtMoney(totals.labor)}</td>
              </tr>
              <tr>
                <td>Parts</td>
                <td className="num">{fmtMoney(totals.parts)}</td>
              </tr>
              <tr>
                <td>Outside vendor</td>
                <td className="num">{fmtMoney(totals.vendor)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td>Total{dirty && ' (save to update)'}</td>
                <td className="num">{fmtMoney(totals.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Photos</h2>
        <WorkOrderPhotos workOrderId={wo.id} canDelete={() => true} />
      </section>

      <div className="savebar">
        <button className="btn primary big" disabled={!dirty || saving} onClick={() => save()}>
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'All changes saved'}
        </button>
        {wo.status !== 'done' && (
          <button className="btn big" onClick={() => setClosing(true)}>
            <Icon name="check" /> Close out
          </button>
        )}
      </div>

      {isAdmin && (
        <div style={{ marginTop: 24 }}>
          <ConfirmButton
            confirmText="Tap again to delete — parts go back to stock"
            onConfirm={async () => {
              try {
                must(await supabase.from('work_orders').delete().eq('id', wo.id))
                d.removeLocal('work_orders', wo.id)
                toast(`Work order #${wo.number} deleted`)
                nav('/work-orders', { replace: true })
              } catch (e) {
                toast((e as Error).message, true)
              }
            }}
          >
            <Icon name="trash" /> Delete work order
          </ConfirmButton>
        </div>
      )}

      {addPart && (
        <AddPartSheet
          assetId={wo.asset_id}
          onClose={() => setAddPart(false)}
          onAdd={async (part, qty) => {
            try {
              const row = must(
                await supabase.from('work_order_parts').insert({ work_order_id: wo.id, part_id: part.id, quantity: qty }).select().single(),
              )
              d.upsertLocal('work_order_parts', row as WorkOrderPart)
              d.upsertLocal('parts', { ...part, qty_on_hand: part.qty_on_hand - qty })
              toast(`${qty} × ${part.part_number} added`)
              setAddPart(false)
            } catch (e) {
              toast((e as Error).message, true)
            }
          }}
        />
      )}

      {closing && (
        <CloseSheet
          wo={wo}
          f={f}
          assetDown={asset?.status === 'down'}
          onClose={() => setClosing(false)}
          onDone={async (fix, hours, downtime, resolution, backInService) => {
            setF((x) => ({ ...x, fix, labor_hours: hours, downtime_hours: downtime }))
            const ok = await saveClose(fix, hours, downtime, resolution)
            if (ok && backInService && asset) {
              const { error } = await supabase.from('assets').update({ status: 'in_service' }).eq('id', asset.id)
              if (error) toast(error.message, true)
            }
            if (ok) setClosing(false)
          }}
        />
      )}
    </div>
  )

  async function saveClose(fix: string, hours: number, downtime: number, resolution: Resolution) {
    try {
      const upd = must(
        await supabase
          .from('work_orders')
          .update({ status: 'done', fix: fix.trim() || null, labor_hours: hours, downtime_hours: downtime, resolution })
          .eq('id', wo.id)
          .select()
          .single(),
      )
      d.upsertLocal('work_orders', upd as WorkOrder)
      toast(`Work order #${wo.number} closed`)
      if (profile?.role === 'mechanic') nav('/work-orders')
      return true
    } catch (e) {
      toast((e as Error).message, true)
      return false
    }
  }
}

/* ---------------- Close-out sheet ---------------- */
function CloseSheet({
  f,
  assetDown,
  onClose,
  onDone,
}: {
  wo: WorkOrder
  f: { fix: string; labor_hours: number; downtime_hours: number }
  assetDown: boolean
  onClose: () => void
  onDone: (fix: string, hours: number, downtime: number, resolution: Resolution, backInService: boolean) => Promise<void>
}) {
  const [resolution, setResolution] = useState<Resolution | null>(null)
  const [fix, setFix] = useState(f.fix)
  const [hours, setHours] = useState(f.labor_hours)
  const [down, setDown] = useState(f.downtime_hours)
  const [back, setBack] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <Sheet
      title="Close out work order"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={busy || !resolution}
            onClick={async () => {
              if (!resolution) return
              setBusy(true)
              await onDone(fix, hours, down, resolution, assetDown && back && resolution !== 'not_fixed')
              setBusy(false)
            }}
          >
            {busy ? 'Saving…' : 'Mark done'}
          </button>
        </>
      }
    >
      <div className="form">
        <div className="field">
          <span className="label">Is it really fixed?</span>
          <Segmented
            label="Outcome"
            value={resolution ?? ('' as Resolution)}
            onChange={setResolution}
            options={[
              { value: 'fixed', label: 'Fixed' },
              { value: 'temporary', label: 'Temporary fix' },
              { value: 'not_fixed', label: 'Not fixed' },
            ]}
          />
          <span className="hint">
            {resolution === 'temporary' && 'It works for now. It stays on the dashboard until a later repair fixes it for good.'}
            {resolution === 'not_fixed' && 'Closing without a fix (e.g. waiting on an outside tech). It stays flagged.'}
            {!resolution && 'Pick one. This is how repeat problems get caught.'}
          </span>
        </div>
        <Field label="What was done?" htmlFor="cfix">
          <textarea id="cfix" value={fix} onChange={(e) => setFix(e.target.value)} />
        </Field>
        <Field label="Labor hours" htmlFor="chours">
          <Stepper id="chours" label="Labor hours" step={0.5} value={hours} onChange={setHours} />
        </Field>
        <Field label="Downtime hours" htmlFor="cdown">
          <Stepper id="cdown" label="Downtime hours" value={down} onChange={setDown} />
        </Field>
        {assetDown && (
          <label className="check">
            <input type="checkbox" checked={back} onChange={(e) => setBack(e.target.checked)} />
            Put the asset back in service
          </label>
        )}
      </div>
    </Sheet>
  )
}

/* ---------------- Add part sheet ---------------- */
function AddPartSheet({
  assetId,
  onClose,
  onAdd,
}: {
  assetId: string
  onClose: () => void
  onAdd: (p: Part, qty: number) => Promise<void>
}) {
  const d = useData()
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Part | null>(null)
  const [qty, setQty] = useState(1)
  const [busy, setBusy] = useState(false)
  const fits = useMemo(() => new Set(d.part_fits.filter((x) => x.asset_id === assetId).map((x) => x.part_id)), [d.part_fits, assetId])
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return d.parts
      .filter((p) => !p.retired_at)
      .filter((p) => !t || p.part_number.toLowerCase().includes(t) || p.description.toLowerCase().includes(t))
      .sort((a, b) => Number(fits.has(b.id)) - Number(fits.has(a.id)) || a.part_number.localeCompare(b.part_number))
  }, [d.parts, q, fits])

  if (d.parts.length === 0) {
    return (
      <Sheet title="Add part" onClose={onClose}>
        <EmptyState icon="box" title="No parts in inventory yet">
          An admin adds parts under Parts. For a part bought outside, enter its cost in “Other parts” below instead.
        </EmptyState>
      </Sheet>
    )
  }

  return (
    <Sheet
      title={picked ? `${picked.part_number}` : 'Add part'}
      onClose={onClose}
      footer={
        picked ? (
          <>
            <button className="btn" onClick={() => setPicked(null)}>
              Back
            </button>
            <button
              className="btn primary"
              disabled={busy || qty <= 0}
              onClick={async () => {
                setBusy(true)
                await onAdd(picked, qty)
                setBusy(false)
              }}
            >
              Use {qty}
            </button>
          </>
        ) : undefined
      }
    >
      {picked ? (
        <div className="form">
          <p>
            <strong>{picked.description}</strong>
          </p>
          <p className="muted">
            {fmtNum(picked.qty_on_hand)} on hand · {fmtMoney(picked.unit_cost)} each
          </p>
          <Field label="Quantity used" htmlFor="qty">
            <Stepper id="qty" label="Quantity" value={qty} min={0} onChange={setQty} />
          </Field>
          {qty > picked.qty_on_hand && (
            <div className="banner warn">
              That's more than the {fmtNum(picked.qty_on_hand)} on hand. It will still be logged and stock will go negative —
              tell an admin to correct the count.
            </div>
          )}
        </div>
      ) : (
        <div className="stack">
          <Search value={q} onChange={setQ} placeholder="Search part # or description" />
          <div className="list">
            {list.map((p) => (
              <button
                key={p.id}
                className="row"
                onClick={() => {
                  setPicked(p)
                  setQty(1)
                }}
              >
                <div className="grow">
                  <div className="title">
                    {p.part_number} · {p.description}
                  </div>
                  <div className="meta">
                    {fmtNum(p.qty_on_hand)} on hand
                    {fits.has(p.id) && ' · fits this asset'}
                  </div>
                </div>
                {p.qty_on_hand <= 0 && <span className="pill danger">Out</span>}
                <span className="chev">
                  <Icon name="chevron" />
                </span>
              </button>
            ))}
            {list.length === 0 && <p className="muted">No matching parts.</p>}
          </div>
        </div>
      )}
    </Sheet>
  )
}

/* ---------------- Same problem before ---------------- */
function SimilarHistory({ wo }: { wo: WorkOrder }) {
  const d = useData()
  const { profileById } = useLookups()
  const past = useMemo(
    () => similarHistory(d.work_orders, wo.asset_id, wo.problem, wo.id).filter((w) => w.opened_on <= wo.opened_on || w.number < wo.number),
    [d.work_orders, wo],
  )
  if (!past.length) return null
  return (
    <section className="card">
      <div className="card-head">
        <h2>This problem before ({past.length})</h2>
      </div>
      <div className="list">
        {past.slice(0, 5).map((w) => (
          <Link key={w.id} to={`/work-orders/${w.id}`} className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 200 }}>
              <div className="title">
                {fmtDate(w.opened_on)} · {w.fix || w.problem}
              </div>
              <div className="meta">
                {[profileById.get(w.assigned_to ?? '')?.full_name ?? w.assigned_name, w.downtime_hours ? `${fmtNum(w.downtime_hours)} h down` : null].filter(Boolean).join(' · ')}
              </div>
              {w.notes && <div className="small" style={{ marginTop: 4 }}>📝 {w.notes}</div>}
            </div>
            {w.resolution ? <StatusPill status={w.resolution} /> : <StatusPill status={w.status} />}
          </Link>
        ))}
      </div>
    </section>
  )
}
