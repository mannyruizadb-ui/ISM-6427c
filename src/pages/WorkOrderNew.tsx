import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../state/auth'
import { useData, useLookups } from '../state/data'
import { supabase } from '../lib/supabase'
import { uploadPhoto } from '../lib/photos'
import { todayISO, toNum } from '../lib/format'
import type { WoStatus, WorkOrder } from '../lib/types'
import { AssetPicker } from '../components/AssetPicker'
import { PendingPhotos } from '../components/Photos'
import { EmptyState, Field, PageHead, Segmented, useToast } from '../components/ui'

export const QUICK_PROBLEMS = {
  truck: ['Oil change', 'Brakes', 'Tires', "Won't start", 'Check engine light', 'Leak', 'Electrical', 'Lights', 'A/C / heat', 'Noise'],
  equipment: ['Not heating', 'Leak', 'Not spinning', 'Belt', 'Bearing', 'Door / latch', 'Error code', 'Noise', 'Electrical', 'Scheduled service'],
}

export function WorkOrderNew() {
  const d = useData()
  const { profile } = useAuth()
  const { assetById } = useLookups()
  const nav = useNavigate()
  const toast = useToast()
  const [params] = useSearchParams()

  const [assetId, setAssetId] = useState<string | null>(params.get('asset'))
  const [problem, setProblem] = useState('')
  const [mileage, setMileage] = useState('')
  const [assign, setAssign] = useState<string>(profile?.role === 'mechanic' ? `p:${profile.id}` : '')
  const [pmId, setPmId] = useState<string>(params.get('pm') ?? '')
  const [status, setStatus] = useState<WoStatus>('open')
  const [outOfService, setOutOfService] = useState(false)
  const [openedOn, setOpenedOn] = useState(todayISO())
  const [photos, setPhotos] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  const asset = assetId ? assetById.get(assetId) : undefined
  const pms = useMemo(() => d.pm_schedules.filter((s) => s.asset_id === assetId && s.active), [d.pm_schedules, assetId])
  const mechanics = d.profiles.filter((p) => p.active && (p.role === 'mechanic' || p.role === 'admin'))
  const vendors = d.vendors.filter((v) => !v.retired_at)

  if (d.assets.filter((a) => !a.retired_at).length === 0) {
    return (
      <>
        <PageHead title="New work order" />
        <EmptyState icon="truck" title="Add a truck or machine first" action={<Link to="/assets?add=1" className="btn primary">Add an asset</Link>}>
          Work orders are logged against an asset.
        </EmptyState>
      </>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!assetId) return toast('Pick a truck or machine first.', true)
    if (!problem.trim()) return toast('Describe the problem.', true)
    const miles = toNum(mileage)
    if (asset?.kind === 'truck' && mileage && miles == null) return toast('Mileage must be a number.', true)
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('work_orders')
        .insert({
          asset_id: assetId,
          problem: problem.trim(),
          opened_on: openedOn,
          mileage: asset?.kind === 'truck' ? miles : null,
          assigned_to: assign.startsWith('p:') ? assign.slice(2) : null,
          vendor_id: assign.startsWith('v:') ? assign.slice(2) : null,
          pm_schedule_id: pmId || null,
          status,
          out_of_service: outOfService,
          source: 'app',
        })
        .select()
        .single()
      if (error) throw error
      const wo = data as WorkOrder
      d.upsertLocal('work_orders', wo)
      for (const f of photos) {
        try {
          await uploadPhoto(wo.id, f)
        } catch (err) {
          toast(`A photo failed to upload: ${(err as Error).message}`, true)
        }
      }
      toast(`Work order #${wo.number} created`)
      nav(`/work-orders/${wo.id}`, { replace: true })
    } catch (err) {
      toast((err as Error).message, true)
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead title="New work order" sub="Pick the asset, say what's wrong. Parts, hours and the fix can be added next." />
      <form className="form" onSubmit={submit}>
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>1. Which truck or machine?</h2>
          <AssetPicker
            assets={d.assets}
            value={assetId}
            onChange={(id) => {
              setAssetId(id)
              setPmId('')
              const a = assetById.get(id)
              setMileage(a?.kind === 'truck' && a.current_mileage != null ? String(a.current_mileage) : '')
            }}
          />
        </section>

        {asset && (
          <>
            <section className="card form">
              <h2>2. What's wrong?</h2>
              <div className="chips" style={{ flexWrap: 'wrap' }}>
                {QUICK_PROBLEMS[asset.kind].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="chip"
                    aria-pressed={problem.includes(p)}
                    onClick={() => setProblem((cur) => (!cur.trim() ? p : cur.includes(p) ? cur : `${cur}; ${p}`))}
                  >
                    {p}
                  </button>
                ))}
              </div>
              <Field label="Problem" htmlFor="problem">
                <textarea id="problem" value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Tap a chip above or type a few words" required />
              </Field>
              {pms.length > 0 && (
                <Field label="Is this scheduled maintenance?" htmlFor="pm" hint="Closing this work order resets the schedule.">
                  <select id="pm" value={pmId} onChange={(e) => {
                    setPmId(e.target.value)
                    const s = pms.find((x) => x.id === e.target.value)
                    if (s && !problem) setProblem(s.task)
                  }}>
                    <option value="">No</option>
                    {pms.map((s) => (
                      <option key={s.id} value={s.id}>{s.task}</option>
                    ))}
                  </select>
                </Field>
              )}
              <div className="form-grid">
                {asset.kind === 'truck' && (
                  <Field label="Mileage now" htmlFor="mileage">
                    <input id="mileage" inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} />
                  </Field>
                )}
                <Field label="Date" htmlFor="opened">
                  <input id="opened" type="date" value={openedOn} max={todayISO()} onChange={(e) => setOpenedOn(e.target.value)} required />
                </Field>
              </div>
              <label className="check">
                <input type="checkbox" checked={outOfService} onChange={(e) => setOutOfService(e.target.checked)} />
                {asset.kind === 'truck' ? 'Truck is out of service' : 'Machine is down'}
              </label>
            </section>

            <section className="card form">
              <h2>3. Who's on it?</h2>
              <Field label="Assigned to" htmlFor="assign">
                <select id="assign" value={assign} onChange={(e) => setAssign(e.target.value)}>
                  <option value="">Unassigned</option>
                  {mechanics.length > 0 && (
                    <optgroup label="Mechanics">
                      {mechanics.map((m) => (
                        <option key={m.id} value={`p:${m.id}`}>{m.full_name}</option>
                      ))}
                    </optgroup>
                  )}
                  {vendors.length > 0 && (
                    <optgroup label="Outside vendors">
                      {vendors.map((v) => (
                        <option key={v.id} value={`v:${v.id}`}>{v.name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </Field>
              <div className="field">
                <span className="label">Status</span>
                <Segmented
                  label="Status"
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: 'open', label: 'Open' },
                    { value: 'waiting_parts', label: 'Waiting on parts' },
                    { value: 'done', label: 'Done' },
                  ]}
                />
              </div>
            </section>

            <section className="card">
              <h2 style={{ marginBottom: 12 }}>Photos</h2>
              <PendingPhotos files={photos} onChange={setPhotos} />
            </section>

            <button className="btn primary big block" disabled={busy}>
              {busy ? 'Saving…' : 'Create work order'}
            </button>
          </>
        )}
      </form>
    </>
  )
}
