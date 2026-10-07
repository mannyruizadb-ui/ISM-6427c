import { useMemo, useState } from 'react'
import type { Asset, AssetKind } from '../lib/types'
import { cap, fmtMiles } from '../lib/format'
import { Search } from './ui'

/** Big tappable grid of assets with a search box — no typing needed for small fleets. */
export function AssetPicker({
  assets,
  value,
  onChange,
  kind,
}: {
  assets: Asset[]
  value: string | null
  onChange: (id: string) => void
  kind?: AssetKind
}) {
  const [q, setQ] = useState('')
  const [tab, setTab] = useState<AssetKind | 'all'>(kind ?? 'all')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return assets
      .filter((a) => !a.retired_at)
      .filter((a) => (kind ? a.kind === kind : tab === 'all' || a.kind === tab))
      .filter((a) =>
        !t ||
        [a.label, a.make, a.model, a.vin, a.serial_number, a.equipment_type].some((v) => v?.toLowerCase().includes(t)),
      )
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
  }, [assets, q, tab, kind])

  return (
    <div className="stack">
      {!kind && (
        <div className="chips" role="group" aria-label="Asset type">
          {(['all', 'truck', 'equipment'] as const).map((k) => (
            <button key={k} type="button" className="chip" aria-pressed={tab === k} onClick={() => setTab(k)}>
              {k === 'all' ? 'All' : k === 'truck' ? 'Trucks' : 'Equipment'}
            </button>
          ))}
        </div>
      )}
      {assets.length > 12 && <Search value={q} onChange={setQ} placeholder="Search unit, name, make…" />}
      <div className="picker">
        {list.map((a) => (
          <button key={a.id} type="button" aria-pressed={value === a.id} onClick={() => onChange(a.id)}>
            <span className="t">{a.label}</span>
            <span className="m">
              {a.kind === 'truck'
                ? [a.year, a.make, a.model].filter(Boolean).join(' ') || fmtMiles(a.current_mileage)
                : cap(a.equipment_type ?? '')}
              {a.status === 'down' && ' · Down'}
            </span>
          </button>
        ))}
      </div>
      {list.length === 0 && <p className="muted">No matching assets.</p>}
    </div>
  )
}
