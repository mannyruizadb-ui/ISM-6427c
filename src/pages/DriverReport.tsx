import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useData } from '../state/data'
import { supabase } from '../lib/supabase'
import { uploadPhoto } from '../lib/photos'
import { toNum } from '../lib/format'
import type { WorkOrder } from '../lib/types'
import { AssetPicker } from '../components/AssetPicker'
import { PendingPhotos } from '../components/Photos'
import { EmptyState, Field, PageHead, useToast } from '../components/ui'
import { QUICK_PROBLEMS } from './WorkOrderNew'

export function DriverReport() {
  const d = useData()
  const nav = useNavigate()
  const toast = useToast()
  const trucks = d.assets.filter((a) => a.kind === 'truck' && !a.retired_at)
  const [truckId, setTruckId] = useState<string | null>(trucks.length === 1 ? trucks[0].id : null)
  const [problem, setProblem] = useState('')
  const [mileage, setMileage] = useState('')
  const [outOfService, setOutOfService] = useState(false)
  const [photos, setPhotos] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  if (trucks.length === 0) {
    return (
      <>
        <PageHead title="Report a problem" />
        <EmptyState icon="truck" title="No trucks set up yet">
          Your admin hasn't added any trucks. Let them know, then come back here to report problems.
        </EmptyState>
      </>
    )
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!truckId) return toast('Pick your truck.', true)
    if (!problem.trim()) return toast("Say what's wrong.", true)
    const miles = toNum(mileage)
    if (mileage && miles == null) return toast('Mileage must be a number.', true)
    setBusy(true)
    try {
      const { data, error } = await supabase
        .from('work_orders')
        .insert({ asset_id: truckId, problem: problem.trim(), mileage: miles, out_of_service: outOfService, source: 'driver' })
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
      toast('Thanks — the shop has your report.')
      nav('/', { replace: true })
    } catch (err) {
      toast((err as Error).message, true)
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead title="Report a problem" sub="The shop sees this right away." />
      <form className="form" onSubmit={submit}>
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Which truck?</h2>
          <AssetPicker assets={d.assets} kind="truck" value={truckId} onChange={setTruckId} />
        </section>
        <section className="card form">
          <h2>What's wrong?</h2>
          <div className="chips" style={{ flexWrap: 'wrap' }}>
            {QUICK_PROBLEMS.truck.filter((p) => p !== 'Oil change').map((p) => (
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
          <Field label="Details" htmlFor="problem">
            <textarea id="problem" value={problem} onChange={(e) => setProblem(e.target.value)} placeholder="Tap above or type a few words" required />
          </Field>
          <Field label="Mileage (optional)" htmlFor="miles">
            <input id="miles" inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} />
          </Field>
          <label className="check">
            <input type="checkbox" checked={outOfService} onChange={(e) => setOutOfService(e.target.checked)} />
            The truck is not safe to drive
          </label>
        </section>
        <section className="card">
          <h2 style={{ marginBottom: 12 }}>Photo</h2>
          <PendingPhotos files={photos} onChange={setPhotos} />
        </section>
        <button className="btn primary big block" disabled={busy}>
          {busy ? 'Sending…' : 'Send report'}
        </button>
      </form>
    </>
  )
}
