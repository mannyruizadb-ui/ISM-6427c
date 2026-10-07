import { useMemo, useState } from 'react'
import { useData } from '../state/data'
import { supabase, must } from '../lib/supabase'
import { autoMap, downloadText, FIELDS, parseCsv, parseDateLoose, templateCsv, type ImportKind } from '../lib/csv'
import { toNum, todayISO } from '../lib/format'
import { EQUIPMENT_TYPES, type Asset, type EquipmentType, type Vendor } from '../lib/types'
import { PageHead, Segmented, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

interface Prepared {
  ok: any[]
  skipped: { line: number; reason: string }[]
  errors: { line: number; reason: string }[]
}

const KIND_LABEL: Record<ImportKind, string> = { assets: 'Trucks & equipment', parts: 'Parts', repairs: 'Past repairs' }
const BATCH = 200

export function Import() {
  const d = useData()
  const toast = useToast()
  const [kind, setKind] = useState<ImportKind>('assets')
  const [file, setFile] = useState<{ name: string; headers: string[]; rows: Record<string, string>[] } | null>(null)
  const [map, setMap] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const reset = (k: ImportKind = kind) => {
    setKind(k)
    setFile(null)
    setMap({})
    setResult(null)
  }

  const onFile = async (f: File) => {
    try {
      const parsed = await parseCsv(f)
      if (!parsed.rows.length) return toast('That file has no data rows.', true)
      setFile({ name: f.name, ...parsed })
      setMap(autoMap(kind, parsed.headers))
      setResult(null)
    } catch (e) {
      toast(`Couldn't read the file: ${(e as Error).message}`, true)
    }
  }

  const get = (row: Record<string, string>, key: string) => (map[key] ? (row[map[key]] ?? '').trim() : '')

  const prepared = useMemo<Prepared | null>(() => {
    if (!file) return null
    const out: Prepared = { ok: [], skipped: [], errors: [] }
    const missing = FIELDS[kind].filter((f) => f.required && !map[f.key])
    if (missing.length) {
      out.errors.push({ line: 0, reason: `Map a column for: ${missing.map((m) => m.label).join(', ')}` })
      return out
    }
    const assetKey = (a: Pick<Asset, 'kind' | 'label'>) => `${a.kind}:${a.label.toLowerCase()}`
    const existingAssets = new Set(d.assets.map(assetKey))
    const assetByLabel = new Map(d.assets.map((a) => [a.label.toLowerCase(), a]))
    const existingParts = new Set(d.parts.map((p) => p.part_number.toLowerCase()))
    const seen = new Set<string>()

    file.rows.forEach((row, i) => {
      const line = i + 2 // header is line 1
      try {
        if (kind === 'assets') {
          const unit = get(row, 'unit_number')
          const name = get(row, 'name')
          const kindRaw = get(row, 'kind').toLowerCase()
          const k: Asset['kind'] = /equip|machine|plant|washer|dryer|ironer|folder/.test(kindRaw)
            ? 'equipment'
            : /truck|vehicle|van/.test(kindRaw)
              ? 'truck'
              : unit
                ? 'truck'
                : 'equipment'
          const label = k === 'truck' ? unit || name : name || unit
          if (!label) throw new Error(k === 'truck' ? 'missing unit number' : 'missing name')
          let et = get(row, 'equipment_type').toLowerCase() || (EQUIPMENT_TYPES.find((t) => kindRaw.includes(t)) ?? '')
          if (k === 'equipment' && !EQUIPMENT_TYPES.includes(et as EquipmentType)) et = 'other'
          const key = assetKey({ kind: k, label })
          if (existingAssets.has(key) || seen.has(key)) return out.skipped.push({ line, reason: `${label} already exists` })
          seen.add(key)
          const year = toNum(get(row, 'year'))
          const miles = toNum(get(row, 'current_mileage'))
          out.ok.push({
            kind: k,
            unit_number: k === 'truck' ? label : null,
            name: k === 'equipment' ? label : null,
            equipment_type: k === 'equipment' ? et : null,
            year: year && year >= 1950 && year <= 2100 ? Math.round(year) : null,
            make: get(row, 'make') || null,
            model: get(row, 'model') || null,
            vin: k === 'truck' ? get(row, 'vin').toUpperCase() || null : null,
            serial_number: get(row, 'serial_number') || null,
            current_mileage: k === 'truck' && miles != null && miles >= 0 ? Math.round(miles) : null,
            status: /down|out/.test(get(row, 'status').toLowerCase()) ? 'down' : 'in_service',
            notes: get(row, 'notes') || null,
          })
        } else if (kind === 'parts') {
          const pn = get(row, 'part_number')
          const desc = get(row, 'description')
          if (!pn) throw new Error('missing part number')
          if (!desc) throw new Error('missing description')
          if (existingParts.has(pn.toLowerCase()) || seen.has(pn.toLowerCase())) return out.skipped.push({ line, reason: `${pn} already exists` })
          seen.add(pn.toLowerCase())
          const cost = toNum(get(row, 'unit_cost'))
          if (get(row, 'unit_cost') && (cost == null || cost < 0)) throw new Error('unit cost is not a number')
          const fits = get(row, 'fits')
            .split(/[;,]/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
          out.ok.push({
            part_number: pn,
            description: desc,
            vendor: get(row, 'vendor'),
            unit_cost: cost ?? 0,
            qty_on_hand: toNum(get(row, 'qty_on_hand')) ?? 0,
            reorder_point: Math.max(0, toNum(get(row, 'reorder_point')) ?? 0),
            location: get(row, 'location') || null,
            fits: fits.map((f) => assetByLabel.get(f)?.id).filter(Boolean),
            unknownFits: fits.filter((f) => !assetByLabel.has(f)),
          })
        } else {
          const label = get(row, 'asset')
          const asset = assetByLabel.get(label.toLowerCase())
          if (!asset) throw new Error(`no asset called “${label}” — import assets first`)
          const date = parseDateLoose(get(row, 'date'))
          if (!date) throw new Error(`can't read date “${get(row, 'date')}”`)
          if (date > todayISO()) throw new Error('date is in the future')
          const problem = get(row, 'problem')
          if (!problem) throw new Error('missing problem')
          const num = (k: string) => {
            const raw = get(row, k)
            const n = toNum(raw)
            if (raw && (n == null || n < 0)) throw new Error(`${k.replace('_', ' ')} “${raw}” is not a number`)
            return n ?? 0
          }
          const st = get(row, 'status').toLowerCase()
          const status = !st || /done|closed|complete|fixed/.test(st) ? 'done' : /part/.test(st) ? 'waiting_parts' : 'open'
          const miles = toNum(get(row, 'mileage'))
          out.ok.push({
            wo: {
              asset_id: asset.id,
              opened_on: date,
              problem,
              fix: get(row, 'fix') || null,
              labor_hours: num('labor_hours'),
              downtime_hours: num('downtime_hours'),
              mileage: asset.kind === 'truck' && miles != null && miles >= 0 ? Math.round(miles) : null,
              status,
              closed_at: status === 'done' ? `${date}T12:00:00` : null,
              source: 'import',
              reported_by: null,
              reported_by_name: get(row, 'reported_by') || null,
              mechanicName: get(row, 'mechanic'),
            },
            cost: { labor_rate: num('labor_rate'), other_parts_cost: num('parts_cost'), vendor_cost: num('vendor_cost') },
          })
        }
      } catch (e) {
        out.errors.push({ line, reason: (e as Error).message })
      }
    })
    return out
  }, [file, map, kind, d.assets, d.parts])

  const run = async () => {
    if (!prepared || !prepared.ok.length) return
    setBusy(true)
    setResult(null)
    let done = 0
    try {
      if (kind === 'assets') {
        for (let i = 0; i < prepared.ok.length; i += BATCH) {
          const rows = must(await supabase.from('assets').insert(prepared.ok.slice(i, i + BATCH)).select()) as Asset[]
          rows.forEach((r) => d.upsertLocal('assets', r))
          done += rows.length
          setProgress(`${done} of ${prepared.ok.length}`)
        }
      } else if (kind === 'parts') {
        // Create any vendors that don't exist yet.
        const vendorByName = new Map(d.vendors.map((v) => [v.name.toLowerCase(), v]))
        const newNames = [...new Set(prepared.ok.map((p) => p.vendor).filter((n: string) => n && !vendorByName.has(n.toLowerCase())))] as string[]
        const uniqueNew = [...new Map(newNames.map((n) => [n.toLowerCase(), n])).values()]
        if (uniqueNew.length) {
          const vs = must(await supabase.from('vendors').insert(uniqueNew.map((name) => ({ name }))).select()) as Vendor[]
          vs.forEach((v) => {
            vendorByName.set(v.name.toLowerCase(), v)
            d.upsertLocal('vendors', v)
          })
        }
        for (let i = 0; i < prepared.ok.length; i += BATCH) {
          const chunk = prepared.ok.slice(i, i + BATCH)
          const rows = must(
            await supabase
              .from('parts')
              .insert(chunk.map(({ vendor, fits: _f, unknownFits: _u, ...p }) => ({ ...p, vendor_id: vendor ? vendorByName.get(vendor.toLowerCase())?.id ?? null : null })))
              .select(),
          ) as any[]
          const fits = rows.flatMap((r, j) => (chunk[j].fits as string[]).map((asset_id) => ({ part_id: r.id, asset_id })))
          if (fits.length) must(await supabase.from('part_fits').insert(fits))
          done += rows.length
          setProgress(`${done} of ${prepared.ok.length}`)
        }
      } else {
        const profByName = new Map(d.profiles.map((p) => [p.full_name.toLowerCase(), p.id]))
        const vendByName = new Map(d.vendors.map((v) => [v.name.toLowerCase(), v.id]))
        for (let i = 0; i < prepared.ok.length; i += BATCH) {
          const chunk = prepared.ok.slice(i, i + BATCH)
          const rows = must(
            await supabase
              .from('work_orders')
              .insert(
                chunk.map(({ wo: { mechanicName, ...wo } }) => {
                  const key = (mechanicName as string).toLowerCase()
                  return {
                    ...wo,
                    assigned_to: profByName.get(key) ?? null,
                    vendor_id: profByName.has(key) ? null : vendByName.get(key) ?? null,
                    assigned_name: mechanicName || null,
                  }
                }),
              )
              .select('id'),
          ) as { id: string }[]
          must(await supabase.from('work_order_costs').upsert(rows.map((r, j) => ({ work_order_id: r.id, ...chunk[j].cost }))))
          done += rows.length
          setProgress(`${done} of ${prepared.ok.length}`)
        }
        await d.reload()
      }
      setResult(`Imported ${done} ${kind === 'repairs' ? 'repair records' : kind}.`)
      toast(`Imported ${done} rows`)
      setFile(null)
    } catch (e) {
      setResult(`Stopped after ${done} rows: ${(e as Error).message}. Rows already imported were kept — fix the file and re-import; existing ${kind === 'repairs' ? 'records are NOT skipped, so remove the rows that went in' : 'items are skipped'}.`)
      toast((e as Error).message, true)
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const unknownFits = prepared && kind === 'parts' ? [...new Set(prepared.ok.flatMap((p) => p.unknownFits as string[]))] : []

  return (
    <>
      <PageHead title="Import CSV" sub="Load your old Excel log. In Excel: File → Save As → CSV (Comma delimited)." />
      <div className="stack">
        <section className="card form">
          <h2>1. What are you importing?</h2>
          <Segmented
            label="Import type"
            value={kind}
            onChange={(k) => reset(k)}
            options={(['assets', 'parts', 'repairs'] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          <p className="small muted">
            {kind === 'assets' && 'One row per truck or machine. Import these first — repairs and parts are matched to them by unit number or name.'}
            {kind === 'parts' && 'One row per part. Vendors that don’t exist yet are created. Existing part numbers are skipped.'}
            {kind === 'repairs' && 'One row per past repair. The asset column must match a unit number or equipment name. Parts cost is recorded as a dollar amount and does not touch inventory. Re-importing the same file creates duplicates.'}
          </p>
          <div>
            <button className="btn" onClick={() => downloadText(`${kind}-template.csv`, templateCsv(kind))}>
              <Icon name="download" /> Download blank template
            </button>
          </div>
        </section>

        <section className="card form">
          <h2>2. Choose your CSV file</h2>
          <label className="btn primary" style={{ alignSelf: 'flex-start' }}>
            <Icon name="upload" /> {file ? `Change file (${file.name})` : 'Choose CSV file'}
            <input type="file" accept=".csv,text/csv" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          {file && <p className="small muted">{file.rows.length} rows, {file.headers.length} columns found.</p>}
        </section>

        {file && (
          <section className="card form">
            <h2>3. Match your columns</h2>
            <p className="small muted">We guessed from your headers. Fix anything that's wrong; leave unused fields blank.</p>
            <div className="form-grid">
              {FIELDS[kind].map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={`map-${f.key}`}>
                    {f.label}
                    {f.required && ' *'}
                  </label>
                  <select id={`map-${f.key}`} value={map[f.key] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value }))}>
                    <option value="">— not in my file —</option>
                    {file.headers.map((h) => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  {f.hint && <span className="hint">{f.hint}</span>}
                </div>
              ))}
            </div>
          </section>
        )}

        {prepared && (
          <section className="card form">
            <h2>4. Check and import</h2>
            <div className="stats">
              <div className="stat"><div className="label">Ready</div><div className="value">{prepared.ok.length}</div></div>
              <div className={`stat${prepared.skipped.length ? ' warn' : ''}`}><div className="label">Skipped (already exist)</div><div className="value">{prepared.skipped.length}</div></div>
              <div className={`stat${prepared.errors.length ? ' alert' : ''}`}><div className="label">Problems</div><div className="value">{prepared.errors.length}</div></div>
            </div>
            {prepared.errors.length > 0 && (
              <div className="banner error">
                <div style={{ marginBottom: 6 }}>These rows won't be imported:</div>
                <ul style={{ margin: 0, paddingLeft: 20, maxHeight: 200, overflowY: 'auto', fontWeight: 400 }}>
                  {prepared.errors.slice(0, 100).map((e, i) => (
                    <li key={i}>{e.line ? `Line ${e.line}: ` : ''}{e.reason}</li>
                  ))}
                  {prepared.errors.length > 100 && <li>…and {prepared.errors.length - 100} more</li>}
                </ul>
              </div>
            )}
            {prepared.skipped.length > 0 && (
              <details>
                <summary style={{ cursor: 'pointer' }}>Show skipped rows</summary>
                <ul className="small">{prepared.skipped.slice(0, 100).map((s, i) => <li key={i}>Line {s.line}: {s.reason}</li>)}</ul>
              </details>
            )}
            {unknownFits.length > 0 && (
              <div className="banner warn">These “fits” names don't match any asset and will be ignored: {unknownFits.slice(0, 15).join(', ')}{unknownFits.length > 15 && '…'}</div>
            )}
            <button className="btn primary big" disabled={busy || !prepared.ok.length} onClick={run}>
              {busy ? `Importing… ${progress ?? ''}` : `Import ${prepared.ok.length} ${prepared.ok.length === 1 ? 'row' : 'rows'}`}
            </button>
          </section>
        )}
        {result && <div className={`banner ${result.startsWith('Imported') ? 'ok' : 'error'}`} role="status">{result}</div>}
      </div>
    </>
  )
}
