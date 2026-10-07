import { useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useData } from '../state/data'
import { supabase, must } from '../lib/supabase'
import type { Vendor } from '../lib/types'
import { ConfirmButton, EmptyState, Field, PageHead, Sheet, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

export function Vendors() {
  const d = useData()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<Vendor | 'new' | null>(params.get('add') === '1' ? 'new' : null)
  const [showRetired, setShowRetired] = useState(false)
  const list = d.vendors.filter((v) => showRetired || !v.retired_at).sort((a, b) => a.name.localeCompare(b.name))
  const partCount = (id: string) => d.parts.filter((p) => p.vendor_id === id && !p.retired_at).length
  const close = () => {
    setEditing(null)
    if (params.get('add')) setParams({}, { replace: true })
  }

  return (
    <>
      <PageHead
        title="Vendors"
        sub="Parts suppliers and outside repair shops."
        actions={<button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" /> Add vendor</button>}
      />
      {d.vendors.length === 0 ? (
        <EmptyState icon="store" title="No vendors yet" action={<button className="btn primary" onClick={() => setEditing('new')}><Icon name="plus" /> Add your first vendor</button>}>
          Add the places you buy parts from and the outside shops you send repairs to. The reorder list groups low-stock
          parts by vendor.
        </EmptyState>
      ) : (
        <>
          <div className="chips">
            <button className="chip" aria-pressed={showRetired} onClick={() => setShowRetired((x) => !x)}>Show retired</button>
          </div>
          <div className="list">
            {list.map((v) => (
              <button key={v.id} className={`row${v.retired_at ? ' retired' : ''}`} onClick={() => setEditing(v)}>
                <div className="grow">
                  <div className="title">{v.name}</div>
                  <div className="meta">{[v.contact_name, v.phone, v.email, `${partCount(v.id)} parts`].filter(Boolean).join(' · ')}</div>
                </div>
                {v.retired_at && <span className="pill neutral">Retired</span>}
                <span className="chev"><Icon name="chevron" /></span>
              </button>
            ))}
          </div>
        </>
      )}
      {editing && <VendorForm vendor={editing === 'new' ? undefined : editing} onClose={close} />}
    </>
  )
}

function VendorForm({ vendor, onClose }: { vendor?: Vendor; onClose: () => void }) {
  const d = useData()
  const toast = useToast()
  const [f, setF] = useState({
    name: vendor?.name ?? '',
    contact_name: vendor?.contact_name ?? '',
    phone: vendor?.phone ?? '',
    email: vendor?.email ?? '',
    notes: vendor?.notes ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!f.name.trim()) return toast('Name is required.', true)
    setBusy(true)
    const row = {
      name: f.name.trim(),
      contact_name: f.contact_name.trim() || null,
      phone: f.phone.trim() || null,
      email: f.email.trim() || null,
      notes: f.notes.trim() || null,
    }
    try {
      const saved = must(
        vendor
          ? await supabase.from('vendors').update(row).eq('id', vendor.id).select().single()
          : await supabase.from('vendors').insert(row).select().single(),
      ) as Vendor
      d.upsertLocal('vendors', saved)
      toast(`${saved.name} saved`)
      onClose()
    } catch (err) {
      const msg = (err as Error).message
      toast(msg.includes('vendors_name_uq') ? 'A vendor with that name already exists.' : msg, true)
      setBusy(false)
    }
  }

  const retire = async () => {
    if (!vendor) return
    try {
      const saved = must(
        await supabase.from('vendors').update({ retired_at: vendor.retired_at ? null : new Date().toISOString() }).eq('id', vendor.id).select().single(),
      )
      d.upsertLocal('vendors', saved as Vendor)
      toast(vendor.retired_at ? 'Vendor restored' : 'Vendor retired')
      onClose()
    } catch (err) {
      toast((err as Error).message, true)
    }
  }

  return (
    <Sheet
      title={vendor ? `Edit ${vendor.name}` : 'Add vendor'}
      onClose={onClose}
      footer={
        <>
          {vendor && (vendor.retired_at ? (
            <button type="button" className="btn" onClick={retire}>Restore</button>
          ) : (
            <ConfirmButton onConfirm={retire} confirmText="Tap to retire">Retire</ConfirmButton>
          ))}
          <button type="submit" form="vendor-form" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="vendor-form" className="form" onSubmit={submit}>
        <Field label="Name *" htmlFor="vname">
          <input id="vname" value={f.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <div className="form-grid">
          <Field label="Contact person" htmlFor="vcontact">
            <input id="vcontact" value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="vphone">
            <input id="vphone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="Email" htmlFor="vemail">
            <input id="vemail" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
          </Field>
        </div>
        <Field label="Notes" htmlFor="vnotes" hint="Account number, hours, what they're good for…">
          <textarea id="vnotes" value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </form>
    </Sheet>
  )
}
