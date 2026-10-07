import { useState, type FormEvent } from 'react'
import { supabase, must } from '../lib/supabase'
import { useData } from '../state/data'
import { cap, toNum } from '../lib/format'
import { EQUIPMENT_TYPES, type Asset, type AssetFinancials, type AssetKind, type EquipmentType } from '../lib/types'
import { Field, Segmented, Sheet, useToast } from './ui'

export function AssetForm({
  asset,
  kind: initialKind = 'truck',
  onClose,
  onSaved,
}: {
  asset?: Asset
  kind?: AssetKind
  onClose: () => void
  onSaved?: (a: Asset) => void
}) {
  const d = useData()
  const toast = useToast()
  const fin = asset ? d.asset_financials.find((x) => x.asset_id === asset.id) : undefined
  const [kind, setKind] = useState<AssetKind>(asset?.kind ?? initialKind)
  const [f, setF] = useState({
    unit_number: asset?.unit_number ?? '',
    name: asset?.name ?? '',
    equipment_type: (asset?.equipment_type ?? 'washer') as EquipmentType,
    year: asset?.year != null ? String(asset.year) : '',
    make: asset?.make ?? '',
    model: asset?.model ?? '',
    vin: asset?.vin ?? '',
    serial_number: asset?.serial_number ?? '',
    current_mileage: asset?.current_mileage != null ? String(asset.current_mileage) : '',
    status: asset?.status ?? 'in_service',
    notes: asset?.notes ?? '',
    purchase_date: fin?.purchase_date ?? '',
    purchase_price: fin?.purchase_price != null ? String(fin.purchase_price) : '',
    replacement_cost: fin?.replacement_cost != null ? String(fin.replacement_cost) : '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  const submit = async (e: FormEvent, addAnother = false) => {
    e.preventDefault()
    const year = toNum(f.year)
    const miles = toNum(f.current_mileage)
    if (kind === 'truck' && !f.unit_number.trim()) return toast('Unit number is required.', true)
    if (kind === 'equipment' && !f.name.trim()) return toast('Name is required.', true)
    if (f.year && (year == null || year < 1950 || year > 2100)) return toast('Year looks wrong.', true)
    if (f.current_mileage && miles == null) return toast('Mileage must be a number.', true)
    const row = {
      kind,
      unit_number: kind === 'truck' ? f.unit_number.trim() : null,
      name: kind === 'equipment' ? f.name.trim() : null,
      equipment_type: kind === 'equipment' ? f.equipment_type : null,
      year,
      make: f.make.trim() || null,
      model: f.model.trim() || null,
      vin: kind === 'truck' ? f.vin.trim().toUpperCase() || null : null,
      serial_number: f.serial_number.trim() || null,
      current_mileage: kind === 'truck' ? miles : null,
      status: f.status,
      notes: f.notes.trim() || null,
    }
    setBusy(true)
    try {
      const saved = must(
        asset
          ? await supabase.from('assets').update(row).eq('id', asset.id).select().single()
          : await supabase.from('assets').insert(row).select().single(),
      ) as Asset
      d.upsertLocal('assets', saved)
      const finRow = {
        asset_id: saved.id,
        purchase_date: f.purchase_date || null,
        purchase_price: toNum(f.purchase_price),
        replacement_cost: toNum(f.replacement_cost),
      }
      if (fin || finRow.purchase_date || finRow.purchase_price != null || finRow.replacement_cost != null) {
        const savedFin = must(await supabase.from('asset_financials').upsert(finRow).select().single()) as AssetFinancials
        d.upsertLocal('asset_financials', savedFin)
      }
      toast(`${saved.label} saved`)
      onSaved?.(saved)
      if (addAnother) {
        setF((x) => ({ ...x, unit_number: '', name: '', vin: '', serial_number: '', current_mileage: '', notes: '', purchase_price: '', replacement_cost: '', purchase_date: '' }))
        setBusy(false)
      } else onClose()
    } catch (err) {
      const msg = (err as Error).message
      toast(msg.includes('assets_truck_unit_uq') ? 'A truck with that unit number already exists.' : msg, true)
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={asset ? `Edit ${asset.label}` : kind === 'truck' ? 'Add truck' : 'Add equipment'}
      onClose={onClose}
      footer={
        <>
          {!asset && (
            <button type="button" className="btn" disabled={busy} onClick={(e) => submit(e, true)}>
              Save &amp; add another
            </button>
          )}
          <button type="submit" form="asset-form" className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="asset-form" className="form" onSubmit={submit}>
        {!asset && (
          <Segmented
            label="Asset type"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'truck', label: 'Truck' },
              { value: 'equipment', label: 'Plant equipment' },
            ]}
          />
        )}
        {kind === 'truck' ? (
          <div className="form-grid">
            <Field label="Unit number *" htmlFor="unit">
              <input id="unit" value={f.unit_number} onChange={(e) => set('unit_number', e.target.value)} required />
            </Field>
            <Field label="Current mileage" htmlFor="miles">
              <input id="miles" inputMode="numeric" value={f.current_mileage} onChange={(e) => set('current_mileage', e.target.value)} />
            </Field>
          </div>
        ) : (
          <div className="form-grid">
            <Field label="Name *" htmlFor="name" hint="e.g. Washer 3, Ironer A">
              <input id="name" value={f.name} onChange={(e) => set('name', e.target.value)} required />
            </Field>
            <Field label="Type *" htmlFor="etype">
              <select id="etype" value={f.equipment_type} onChange={(e) => set('equipment_type', e.target.value)}>
                {EQUIPMENT_TYPES.map((t) => (
                  <option key={t} value={t}>{cap(t)}</option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <div className="form-grid">
          {kind === 'truck' && (
            <Field label="Year" htmlFor="year">
              <input id="year" inputMode="numeric" value={f.year} onChange={(e) => set('year', e.target.value)} />
            </Field>
          )}
          <Field label="Make" htmlFor="make">
            <input id="make" value={f.make} onChange={(e) => set('make', e.target.value)} />
          </Field>
          <Field label="Model" htmlFor="model">
            <input id="model" value={f.model} onChange={(e) => set('model', e.target.value)} />
          </Field>
          {kind === 'truck' ? (
            <Field label="VIN" htmlFor="vin">
              <input id="vin" value={f.vin} onChange={(e) => set('vin', e.target.value)} autoCapitalize="characters" />
            </Field>
          ) : (
            <Field label="Serial number" htmlFor="serial">
              <input id="serial" value={f.serial_number} onChange={(e) => set('serial_number', e.target.value)} />
            </Field>
          )}
        </div>
        <div className="field">
          <span className="label">Status</span>
          <Segmented
            label="Status"
            value={f.status}
            onChange={(v) => set('status', v)}
            options={[
              { value: 'in_service', label: 'In service' },
              { value: 'down', label: 'Down' },
            ]}
          />
        </div>
        <Field label="Notes" htmlFor="notes">
          <textarea id="notes" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 650, minHeight: 44, display: 'flex', alignItems: 'center' }}>
            Purchase &amp; replacement cost (admin only, for repair-vs-replace)
          </summary>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <Field label="Purchase date" htmlFor="pdate">
              <input id="pdate" type="date" value={f.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />
            </Field>
            <Field label="Purchase price" htmlFor="pprice">
              <input id="pprice" inputMode="decimal" value={f.purchase_price} onChange={(e) => set('purchase_price', e.target.value)} />
            </Field>
            <Field label="Replacement cost today" htmlFor="rcost">
              <input id="rcost" inputMode="decimal" value={f.replacement_cost} onChange={(e) => set('replacement_cost', e.target.value)} />
            </Field>
          </div>
        </details>
      </form>
    </Sheet>
  )
}
