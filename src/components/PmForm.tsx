import { useState, type FormEvent } from 'react'
import { supabase, must } from '../lib/supabase'
import { useData } from '../state/data'
import { toNum } from '../lib/format'
import type { PmSchedule } from '../lib/types'
import { AssetPicker } from './AssetPicker'
import { ConfirmButton, Field, Sheet, useToast } from './ui'

const PRESETS = {
  truck: [
    { task: 'Oil & filter change', miles: 5000, days: 180 },
    { task: 'Tire rotation', miles: 7500, days: null },
    { task: 'Brake inspection', miles: 15000, days: 365 },
    { task: 'DOT annual inspection', miles: null, days: 365 },
  ],
  equipment: [
    { task: 'Monthly service', miles: null, days: 30 },
    { task: 'Quarterly service', miles: null, days: 90 },
    { task: 'Belt & bearing check', miles: null, days: 90 },
    { task: 'Annual inspection', miles: null, days: 365 },
  ],
}

export function PmForm({ schedule, assetId, onClose }: { schedule?: PmSchedule; assetId?: string; onClose: () => void }) {
  const d = useData()
  const toast = useToast()
  const [aid, setAid] = useState<string | null>(schedule?.asset_id ?? assetId ?? null)
  const asset = d.assets.find((a) => a.id === aid)
  const [f, setF] = useState({
    task: schedule?.task ?? '',
    interval_miles: schedule?.interval_miles != null ? String(schedule.interval_miles) : '',
    interval_days: schedule?.interval_days != null ? String(schedule.interval_days) : '',
    last_done_miles: schedule?.last_done_miles != null ? String(schedule.last_done_miles) : '',
    last_done_on: schedule?.last_done_on ?? '',
    notes: schedule?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const isTruck = asset?.kind === 'truck'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!aid) return toast('Pick an asset.', true)
    const miles = isTruck ? toNum(f.interval_miles) : null
    const days = toNum(f.interval_days)
    if (!f.task.trim()) return toast('Give the task a name.', true)
    if (!miles && !days) return toast(isTruck ? 'Set a mileage or day interval.' : 'Set a day interval.', true)
    setBusy(true)
    try {
      const row = {
        asset_id: aid,
        task: f.task.trim(),
        interval_miles: miles,
        interval_days: days,
        last_done_miles: isTruck ? toNum(f.last_done_miles) : null,
        last_done_on: f.last_done_on || null,
        notes: f.notes.trim() || null,
      }
      const saved = must(
        schedule
          ? await supabase.from('pm_schedules').update(row).eq('id', schedule.id).select().single()
          : await supabase.from('pm_schedules').insert(row).select().single(),
      ) as PmSchedule
      d.upsertLocal('pm_schedules', saved)
      toast('Schedule saved')
      onClose()
    } catch (err) {
      toast((err as Error).message, true)
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={schedule ? 'Edit maintenance schedule' : 'Add maintenance schedule'}
      onClose={onClose}
      footer={
        <>
          {schedule && (
            <ConfirmButton
              onConfirm={async () => {
                try {
                  must(await supabase.from('pm_schedules').delete().eq('id', schedule.id))
                  d.removeLocal('pm_schedules', schedule.id)
                  toast('Schedule deleted')
                  onClose()
                } catch (err) {
                  toast((err as Error).message, true)
                }
              }}
            >
              Delete
            </ConfirmButton>
          )}
          <button type="submit" form="pm-form" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="pm-form" className="form" onSubmit={submit}>
        {!schedule && !assetId && (
          <div className="field">
            <span className="label">Asset</span>
            <AssetPicker assets={d.assets} value={aid} onChange={setAid} />
          </div>
        )}
        {asset && (
          <>
            {!schedule && (
              <div className="field">
                <span className="label">Quick pick</span>
                <div className="chips" style={{ flexWrap: 'wrap' }}>
                  {PRESETS[asset.kind].map((p) => (
                    <button
                      key={p.task}
                      type="button"
                      className="chip"
                      aria-pressed={f.task === p.task}
                      onClick={() =>
                        setF((x) => ({
                          ...x,
                          task: p.task,
                          interval_miles: p.miles ? String(p.miles) : '',
                          interval_days: p.days ? String(p.days) : '',
                        }))
                      }
                    >
                      {p.task}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <Field label="Task" htmlFor="task">
              <input id="task" value={f.task} onChange={(e) => set('task', e.target.value)} required />
            </Field>
            <div className="form-grid">
              {isTruck && (
                <Field label="Every (miles)" htmlFor="imiles">
                  <input id="imiles" inputMode="numeric" value={f.interval_miles} onChange={(e) => set('interval_miles', e.target.value)} />
                </Field>
              )}
              <Field label={isTruck ? 'Or every (days)' : 'Every (days)'} htmlFor="idays" hint={isTruck ? 'Whichever comes first.' : undefined}>
                <input id="idays" inputMode="numeric" value={f.interval_days} onChange={(e) => set('interval_days', e.target.value)} />
              </Field>
            </div>
            <div className="form-grid">
              {isTruck && (
                <Field label="Last done at (miles)" htmlFor="lmiles" hint={asset.current_mileage != null ? `Truck is at ${asset.current_mileage.toLocaleString()} mi now.` : undefined}>
                  <input id="lmiles" inputMode="numeric" value={f.last_done_miles} onChange={(e) => set('last_done_miles', e.target.value)} />
                </Field>
              )}
              <Field label="Last done on" htmlFor="ldate">
                <input id="ldate" type="date" value={f.last_done_on} onChange={(e) => set('last_done_on', e.target.value)} />
              </Field>
            </div>
            <p className="small muted">
              These reset automatically when a work order linked to this schedule is closed.
            </p>
            <Field label="Notes" htmlFor="pnotes">
              <textarea id="pnotes" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </>
        )}
      </form>
    </Sheet>
  )
}
