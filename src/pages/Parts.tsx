import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData, useLookups } from '../state/data'
import { useRole } from '../state/auth'
import { supabase, must } from '../lib/supabase'
import { fmtMoney, fmtNum, toNum } from '../lib/format'
import type { Part } from '../lib/types'
import { ConfirmButton, EmptyState, Field, PageHead, Search, Sheet, Stepper, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

export function Parts() {
  const d = useData()
  const { isAdmin } = useRole()
  const { vendorById } = useLookups()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState(params.get('q') ?? '')
  const [lowOnly, setLowOnly] = useState(false)
  const [showRetired, setShowRetired] = useState(false)
  const [editing, setEditing] = useState<Part | 'new' | null>(params.get('add') === '1' && isAdmin ? 'new' : null)
  const [receiving, setReceiving] = useState<Part | null>(null)

  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return d.parts
      .filter((p) => showRetired || !p.retired_at)
      .filter((p) => !lowOnly || p.qty_on_hand <= p.reorder_point)
      .filter((p) => !t || [p.part_number, p.description, p.location, vendorById.get(p.vendor_id ?? '')?.name].some((v) => v?.toLowerCase().includes(t)))
      .sort((a, b) => a.part_number.localeCompare(b.part_number, undefined, { numeric: true }))
  }, [d.parts, q, lowOnly, showRetired, vendorById])
  const lowCount = d.parts.filter((p) => !p.retired_at && p.qty_on_hand <= p.reorder_point).length
  const stockValue = d.parts.filter((p) => !p.retired_at).reduce((s, p) => s + Math.max(0, p.qty_on_hand) * p.unit_cost, 0)

  const closeEdit = () => {
    setEditing(null)
    if (params.get('add')) setParams({}, { replace: true })
  }

  return (
    <>
      <PageHead
        title="Parts inventory"
        sub={d.parts.length ? `${d.parts.filter((p) => !p.retired_at).length} parts · ${fmtMoney(stockValue)} in stock` : undefined}
        actions={
          <>
            <Link to="/parts/reorder" className="btn">
              <Icon name="cart" /> Reorder{lowCount ? ` (${lowCount})` : ''}
            </Link>
            {isAdmin && (
              <button className="btn primary" onClick={() => setEditing('new')}>
                <Icon name="plus" /> Add part
              </button>
            )}
          </>
        }
      />
      {d.parts.length === 0 ? (
        <EmptyState
          icon="box"
          title="No parts yet"
          action={
            isAdmin ? (
              <div className="actions" style={{ justifyContent: 'center' }}>
                <button className="btn primary" onClick={() => setEditing('new')}>
                  <Icon name="plus" /> Add your first part
                </button>
                <Link to="/admin/import" className="btn">Import from CSV</Link>
              </div>
            ) : undefined
          }
        >
          Track part numbers, which trucks and machines they fit, cost, quantity on hand and reorder points. Parts used on a
          work order come out of stock automatically.
        </EmptyState>
      ) : (
        <>
          <div className="stack" style={{ marginBottom: 12 }}>
            <Search value={q} onChange={setQ} placeholder="Search part #, description, vendor, bin…" />
            <div className="chips">
              <button className="chip" aria-pressed={lowOnly} onClick={() => setLowOnly((x) => !x)}>Low stock only</button>
              <button className="chip" aria-pressed={showRetired} onClick={() => setShowRetired((x) => !x)}>Show retired</button>
            </div>
          </div>
          {list.length === 0 ? (
            <EmptyState icon="search" title="Nothing matches">Try a different search.</EmptyState>
          ) : (
            <div className="list">
              {list.map((p) => {
                const low = p.qty_on_hand <= p.reorder_point
                return (
                  <div key={p.id} className={`row${p.retired_at ? ' retired' : ''}`} style={{ cursor: isAdmin ? 'pointer' : 'default', flexWrap: 'wrap' }} onClick={() => isAdmin && setEditing(p)}>
                    <div className="grow" style={{ minWidth: 180 }}>
                      <div className="title">{p.part_number} · {p.description}</div>
                      <div className="meta">
                        {[vendorById.get(p.vendor_id ?? '')?.name, p.location && `Bin ${p.location}`, `${fmtMoney(p.unit_cost)} each`, `reorder at ${fmtNum(p.reorder_point)}`].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <span className={`pill ${p.qty_on_hand <= 0 ? 'danger' : low ? 'warn' : 'ok'}`}>{fmtNum(p.qty_on_hand)} on hand</span>
                    {isAdmin && !p.retired_at && (
                      <button className="btn" onClick={(e) => { e.stopPropagation(); setReceiving(p) }}>
                        Receive
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
      {editing && <PartForm part={editing === 'new' ? undefined : editing} onClose={closeEdit} />}
      {receiving && <ReceiveSheet part={receiving} onClose={() => setReceiving(null)} />}
    </>
  )
}

function ReceiveSheet({ part, onClose }: { part: Part; onClose: () => void }) {
  const d = useData()
  const toast = useToast()
  const [qty, setQty] = useState(1)
  const [cost, setCost] = useState(String(part.unit_cost))
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const c = toNum(cost)
    if (c == null || c < 0) return toast('Enter a valid unit cost.', true)
    setBusy(true)
    try {
      const row = must(await supabase.rpc('receive_part', { p_part_id: part.id, p_qty: qty, p_unit_cost: c }))
      d.upsertLocal('parts', row as Part)
      toast(`Received ${qty} × ${part.part_number}`)
      onClose()
    } catch (e) {
      toast((e as Error).message, true)
      setBusy(false)
    }
  }
  return (
    <Sheet
      title={`Receive ${part.part_number}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || qty <= 0} onClick={save}>Add {qty} to stock</button>
        </>
      }
    >
      <div className="form">
        <p className="muted">{part.description} · {fmtNum(part.qty_on_hand)} on hand now</p>
        <Field label="Quantity received" htmlFor="rq">
          <Stepper id="rq" label="Quantity received" value={qty} onChange={setQty} />
        </Field>
        <Field label="Unit cost" htmlFor="rc" hint="Update if the price changed. Past work orders keep the cost they were logged at.">
          <input id="rc" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  )
}

function PartForm({ part, onClose }: { part?: Part; onClose: () => void }) {
  const d = useData()
  const toast = useToast()
  const [f, setF] = useState({
    part_number: part?.part_number ?? '',
    description: part?.description ?? '',
    vendor_id: part?.vendor_id ?? '',
    unit_cost: part ? String(part.unit_cost) : '',
    qty_on_hand: part ? String(part.qty_on_hand) : '',
    reorder_point: part ? String(part.reorder_point) : '',
    location: part?.location ?? '',
  })
  const initialFits = useMemo(
    () => new Set(part ? d.part_fits.filter((x) => x.part_id === part.id).map((x) => x.asset_id) : []),
    [part, d.part_fits],
  )
  const [fits, setFits] = useState<Set<string>>(initialFits)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }))
  const assets = d.assets.filter((a) => !a.retired_at || fits.has(a.id)).sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label, undefined, { numeric: true }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const cost = toNum(f.unit_cost) ?? 0
    const qty = toNum(f.qty_on_hand) ?? 0
    const rp = toNum(f.reorder_point) ?? 0
    if (!f.part_number.trim() || !f.description.trim()) return toast('Part number and description are required.', true)
    setBusy(true)
    try {
      const row = {
        part_number: f.part_number.trim(),
        description: f.description.trim(),
        vendor_id: f.vendor_id || null,
        unit_cost: cost,
        qty_on_hand: qty,
        reorder_point: rp,
        location: f.location.trim() || null,
      }
      const saved = must(
        part
          ? await supabase.from('parts').update(row).eq('id', part.id).select().single()
          : await supabase.from('parts').insert(row).select().single(),
      ) as Part
      d.upsertLocal('parts', saved)
      const add = [...fits].filter((x) => !initialFits.has(x))
      const remove = [...initialFits].filter((x) => !fits.has(x))
      if (add.length) must(await supabase.from('part_fits').insert(add.map((asset_id) => ({ part_id: saved.id, asset_id }))))
      if (remove.length) must(await supabase.from('part_fits').delete().eq('part_id', saved.id).in('asset_id', remove))
      add.forEach((asset_id) => d.upsertLocal('part_fits', { part_id: saved.id, asset_id }))
      remove.forEach((asset_id) => d.removeLocal('part_fits', `${saved.id}:${asset_id}`))
      toast(`${saved.part_number} saved`)
      onClose()
    } catch (err) {
      const msg = (err as Error).message
      toast(msg.includes('parts_number_uq') ? 'That part number already exists.' : msg, true)
      setBusy(false)
    }
  }

  const retire = async () => {
    if (!part) return
    try {
      const row = must(
        await supabase.from('parts').update({ retired_at: part.retired_at ? null : new Date().toISOString() }).eq('id', part.id).select().single(),
      )
      d.upsertLocal('parts', row as Part)
      toast(part.retired_at ? 'Part restored' : 'Part retired')
      onClose()
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  return (
    <Sheet
      title={part ? `Edit ${part.part_number}` : 'Add part'}
      onClose={onClose}
      footer={
        <>
          {part && (part.retired_at ? (
            <button type="button" className="btn" onClick={retire}>Restore</button>
          ) : (
            <ConfirmButton onConfirm={retire} confirmText="Tap to retire">Retire</ConfirmButton>
          ))}
          <button type="submit" form="part-form" className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="part-form" className="form" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Part number *" htmlFor="pn">
            <input id="pn" value={f.part_number} onChange={(e) => set('part_number', e.target.value)} required />
          </Field>
          <Field label="Bin / location" htmlFor="loc">
            <input id="loc" value={f.location} onChange={(e) => set('location', e.target.value)} />
          </Field>
        </div>
        <Field label="Description *" htmlFor="desc">
          <input id="desc" value={f.description} onChange={(e) => set('description', e.target.value)} required />
        </Field>
        <Field label="Vendor" htmlFor="vendor" hint={d.vendors.length === 0 ? <Link to="/admin/vendors?add=1">Add a vendor first</Link> : undefined}>
          <select id="vendor" value={f.vendor_id} onChange={(e) => set('vendor_id', e.target.value)}>
            <option value="">—</option>
            {d.vendors.filter((v) => !v.retired_at || v.id === f.vendor_id).map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </Field>
        <div className="form-grid">
          <Field label="Unit cost" htmlFor="uc">
            <input id="uc" inputMode="decimal" value={f.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} />
          </Field>
          <Field label="Quantity on hand" htmlFor="qoh" hint={part ? 'Use “Receive” for deliveries; edit here only to correct a count.' : undefined}>
            <input id="qoh" inputMode="decimal" value={f.qty_on_hand} onChange={(e) => set('qty_on_hand', e.target.value)} />
          </Field>
          <Field label="Reorder point" htmlFor="rp" hint="Flag as low at or below this.">
            <input id="rp" inputMode="decimal" value={f.reorder_point} onChange={(e) => set('reorder_point', e.target.value)} />
          </Field>
        </div>
        <div className="field">
          <span className="label">Fits these assets</span>
          {assets.length === 0 ? (
            <span className="hint">Add trucks or equipment first.</span>
          ) : (
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {assets.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="chip"
                  aria-pressed={fits.has(a.id)}
                  onClick={() =>
                    setFits((s) => {
                      const n = new Set(s)
                      if (n.has(a.id)) n.delete(a.id)
                      else n.add(a.id)
                      return n
                    })
                  }
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </form>
    </Sheet>
  )
}
