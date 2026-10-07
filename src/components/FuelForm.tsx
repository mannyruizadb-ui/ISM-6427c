import { useMemo, useState, type FormEvent } from 'react'
import { useAuth } from '../state/auth'
import { useData, useLookups } from '../state/data'
import { supabase, must } from '../lib/supabase'
import { receiptPath, uploadReceipt } from '../lib/photos'
import { fmtDate, fmtMoney, fmtNum, todayISO, toNum } from '../lib/format'
import { lastOdometer, MAX_INTERVAL_MILES } from '../lib/fuel'
import type { FuelLog } from '../lib/types'
import { AssetPicker } from './AssetPicker'
import { PendingPhotos } from './Photos'
import { ConfirmButton, Field, useToast } from './ui'

const OTHER = '__other__'

/** Log or edit a fill-up. One odometer reading; miles and MPG are worked out from the previous fill-up. */
export function FuelForm({ log, onDone }: { log?: FuelLog; onDone: (saved: FuelLog | null) => void }) {
  const d = useData()
  const { profile } = useAuth()
  const { assetById } = useLookups()
  const toast = useToast()

  const myLast = useMemo(
    () =>
      d.fuel_logs
        .filter((l) => l.entered_by === profile?.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0],
    [d.fuel_logs, profile?.id],
  )
  const trucks = d.assets.filter((a) => a.kind === 'truck' && !a.retired_at)
  const initialVehicle = log
    ? log.asset_id ?? OTHER
    : myLast?.asset_id && assetById.get(myLast.asset_id) && !assetById.get(myLast.asset_id)!.retired_at
      ? myLast.asset_id
      : trucks.length === 1
        ? trucks[0].id
        : null

  const [vehicle, setVehicle] = useState<string | null>(initialVehicle)
  const [otherName, setOtherName] = useState(log?.vehicle_label ?? '')
  const [filledOn, setFilledOn] = useState(log?.filled_on ?? todayISO())
  const [odometer, setOdometer] = useState(log?.odometer != null ? String(log.odometer) : '')
  const [gallons, setGallons] = useState(log ? String(log.gallons) : '')
  const [cost, setCost] = useState(log ? String(log.total_cost) : '')
  const [full, setFull] = useState(log?.full_tank ?? true)
  const [location, setLocation] = useState(log?.location ?? '')
  const [notes, setNotes] = useState(log?.notes ?? '')
  const [receipt, setReceipt] = useState<File[]>([])
  const [busy, setBusy] = useState(false)

  const asset = vehicle && vehicle !== OTHER ? assetById.get(vehicle) : undefined
  const others = useMemo(() => d.fuel_logs.filter((l) => l.id !== log?.id), [d.fuel_logs, log?.id])
  const last = asset ? lastOdometer(asset.id, others.filter((l) => l.filled_on <= filledOn), asset) : null
  const lastFill = asset
    ? others.filter((l) => l.asset_id === asset.id && l.odometer != null).sort((a, b) => b.filled_on.localeCompare(a.filled_on))[0]
    : undefined

  const odo = toNum(odometer)
  const gal = toNum(gallons)
  const total = toNum(cost)
  const ppg = gal && total != null && gal > 0 ? total / gal : null
  const sinceLast = odo != null && last != null ? odo - last : null

  const locations = useMemo(() => {
    const c = new Map<string, number>()
    for (const l of d.fuel_logs) if (l.location?.trim()) c.set(l.location.trim(), (c.get(l.location.trim()) ?? 0) + 1)
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }, [d.fuel_logs])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!vehicle) return toast('Pick the truck.', true)
    if (vehicle === OTHER && !otherName.trim()) return toast('Name the vehicle (e.g. "U-Haul rental").', true)
    if (odometer && (odo == null || odo < 0)) return toast('Odometer must be a number.', true)
    if (asset && odo == null && !confirm('No odometer reading? Without it this fill-up can’t count toward MPG.')) return
    if (!gal || gal <= 0) return toast('Enter the gallons.', true)
    if (total == null || total < 0) return toast('Enter the total price.', true)
    if (sinceLast != null && sinceLast < 0 && !confirm(`That's lower than the last reading (${fmtNum(last)}). Save anyway?`)) return
    if (sinceLast != null && sinceLast > MAX_INTERVAL_MILES && !confirm(`That's ${fmtNum(sinceLast)} miles since the last reading. Save anyway?`)) return

    setBusy(true)
    try {
      const id = log?.id ?? crypto.randomUUID()
      const path = receipt.length ? receiptPath(id) : log?.receipt_path ?? null
      const row = {
        asset_id: asset?.id ?? null,
        vehicle_label: vehicle === OTHER ? otherName.trim() : null,
        filled_on: filledOn,
        odometer: odo == null ? null : Math.round(odo),
        gallons: gal,
        total_cost: total,
        full_tank: full,
        location: location.trim() || null,
        notes: notes.trim() || null,
        receipt_path: path,
      }
      const saved = must(
        log
          ? await supabase.from('fuel_logs').update(row).eq('id', log.id).select().single()
          : await supabase.from('fuel_logs').insert({ id, ...row }).select().single(),
      ) as FuelLog
      d.upsertLocal('fuel_logs', saved)
      if (receipt.length && path) {
        try {
          await uploadReceipt(path, receipt[0])
        } catch (err) {
          toast(`Saved, but the receipt photo didn't upload: ${(err as Error).message}`, true)
        }
      }
      toast(log ? 'Fill-up updated' : `Fill-up saved${ppg ? ` · ${fmtMoney(ppg)}/gal` : ''}`)
      onDone(saved)
    } catch (err) {
      const msg = (err as Error).message
      toast(/no\) rows|0 rows|coerce/i.test(msg) ? 'This fill-up can no longer be changed here. Ask an admin or mechanic to correct it.' : msg, true)
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!log) return
    try {
      const gone = must(await supabase.from('fuel_logs').delete().eq('id', log.id).select()) as FuelLog[]
      if (!gone.length) throw new Error('Only an admin can delete this one (your own entries can be deleted for 24 hours).')
      d.removeLocal('fuel_logs', log.id)
      toast('Fill-up deleted')
      onDone(null)
    } catch (err) {
      toast((err as Error).message, true)
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Which vehicle?</h2>
        {trucks.length > 0 && (
          <AssetPicker assets={d.assets} kind="truck" value={vehicle === OTHER ? null : vehicle} onChange={setVehicle} />
        )}
        <div className="chips" style={{ marginTop: 10 }}>
          <button type="button" className="chip" aria-pressed={vehicle === OTHER} onClick={() => setVehicle(OTHER)}>
            Rental / other vehicle
          </button>
        </div>
        {vehicle === OTHER && (
          <Field label="Vehicle" htmlFor="other" hint="Not tracked for MPG; cost still counts.">
            <input id="other" value={otherName} onChange={(e) => setOtherName(e.target.value)} placeholder="e.g. U-Haul rental" />
          </Field>
        )}
      </section>

      <section className="card form">
        <div className="form-grid">
          <Field
            label={asset ? 'Odometer' : 'Odometer (optional)'}
            htmlFor="odo"
            hint={
              sinceLast != null && odo != null
                ? sinceLast < 0
                  ? `⚠ Lower than the last reading (${fmtNum(last)})`
                  : sinceLast > MAX_INTERVAL_MILES
                    ? `⚠ ${fmtNum(sinceLast)} mi since last — double-check`
                    : `${fmtNum(sinceLast)} mi since last fill-up`
                : lastFill
                  ? `Last: ${fmtNum(lastFill.odometer)} on ${fmtDate(lastFill.filled_on)}`
                  : last != null
                    ? `Truck is at ${fmtNum(last)} mi`
                    : undefined
            }
          >
            <input id="odo" inputMode="numeric" value={odometer} onChange={(e) => setOdometer(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Date" htmlFor="fdate">
            <input id="fdate" type="date" value={filledOn} max={todayISO()} onChange={(e) => setFilledOn(e.target.value)} required />
          </Field>
        </div>
        <div className="form-grid">
          <Field label="Gallons" htmlFor="gal">
            <input id="gal" inputMode="decimal" value={gallons} onChange={(e) => setGallons(e.target.value)} autoComplete="off" />
          </Field>
          <Field label="Total price" htmlFor="cost" hint={ppg ? `${fmtMoney(ppg)} per gallon` : undefined}>
            <input id="cost" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} autoComplete="off" />
          </Field>
        </div>
        <label className="check">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} />
          Filled the tank all the way
        </label>
        {!full && <p className="small muted">Partial fills are still counted; MPG is worked out at the next full fill-up.</p>}
        <Field label="Station / location" htmlFor="loc">
          {locations.length > 0 && (
            <div className="chips" style={{ marginBottom: 0 }}>
              {locations.slice(0, 3).map((l) => (
                <button key={l} type="button" className="chip" aria-pressed={location === l} onClick={() => setLocation(l)}>
                  {l}
                </button>
              ))}
            </div>
          )}
          <input id="loc" list="fuel-locations" value={location} onChange={(e) => setLocation(e.target.value)} />
          <datalist id="fuel-locations">
            {locations.map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        </Field>
        <Field label="Notes" htmlFor="fnotes">
          <input id="fnotes" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </section>

      <section className="card">
        <h2 style={{ marginBottom: 12 }}>Receipt {log?.receipt_path && !receipt.length && <span className="pill ok">On file</span>}</h2>
        <PendingPhotos files={receipt} onChange={(f) => setReceipt(f.slice(-1))} />
      </section>

      <button className="btn primary big block" disabled={busy}>
        {busy ? 'Saving…' : log ? 'Save changes' : 'Save fill-up'}
      </button>
      {log && (
        <ConfirmButton onConfirm={remove} confirmText="Tap again to delete">
          Delete fill-up
        </ConfirmButton>
      )}
    </form>
  )
}
