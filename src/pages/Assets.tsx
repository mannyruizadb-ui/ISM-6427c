import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useData } from '../state/data'
import { useRole } from '../state/auth'
import { cap, fmtMiles } from '../lib/format'
import type { AssetKind } from '../lib/types'
import { AssetForm } from '../components/AssetForm'
import { EmptyState, PageHead, Search, StatusPill } from '../components/ui'
import { Icon } from '../components/Icon'

export function Assets() {
  const d = useData()
  const { isAdmin } = useRole()
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as AssetKind) || 'truck'
  const downOnly = params.get('status') === 'down'
  const adding = params.get('add') === '1' && isAdmin
  const [q, setQ] = useState('')
  const [showRetired, setShowRetired] = useState(false)

  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params)
    if (v == null) p.delete(k)
    else p.set(k, v)
    setParams(p, { replace: true })
  }

  const all = d.assets.filter((a) => a.kind === tab)
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return all
      .filter((a) => showRetired || !a.retired_at)
      .filter((a) => !downOnly || a.status === 'down')
      .filter((a) => !t || [a.label, a.make, a.model, a.vin, a.serial_number, a.equipment_type].some((v) => v?.toLowerCase().includes(t)))
      .sort((a, b) => Number(!!a.retired_at) - Number(!!b.retired_at) || a.label.localeCompare(b.label, undefined, { numeric: true }))
  }, [all, q, showRetired, downOnly])
  const openByAsset = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of d.work_orders) if (w.status !== 'done') m.set(w.asset_id, (m.get(w.asset_id) ?? 0) + 1)
    return m
  }, [d.work_orders])

  const noun = tab === 'truck' ? 'truck' : 'piece of equipment'

  return (
    <>
      <PageHead
        title="Assets"
        actions={
          isAdmin ? (
            <button className="btn primary" onClick={() => setParam('add', '1')}>
              <Icon name="plus" /> Add {tab === 'truck' ? 'truck' : 'equipment'}
            </button>
          ) : undefined
        }
      />
      <div className="tabs" role="tablist">
        {(['truck', 'equipment'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setParam('tab', k)}>
            {k === 'truck' ? 'Trucks' : 'Plant equipment'} ({d.assets.filter((a) => a.kind === k && !a.retired_at).length})
          </button>
        ))}
      </div>

      {all.length === 0 ? (
        <EmptyState
          icon={tab === 'truck' ? 'truck' : 'factory'}
          title={tab === 'truck' ? 'No trucks yet' : 'No plant equipment yet'}
          action={
            isAdmin ? (
              <button className="btn primary" onClick={() => setParam('add', '1')}>
                <Icon name="plus" /> Add your first {noun}
              </button>
            ) : undefined
          }
        >
          {tab === 'truck'
            ? 'Add each truck with its unit number, year/make/model, VIN and current mileage.'
            : 'Add washers, dryers, ironers, folders and other machines with make, model and serial number.'}
          {!isAdmin && ' An admin needs to add them.'}
        </EmptyState>
      ) : (
        <>
          <div className="stack" style={{ marginBottom: 12 }}>
            <Search value={q} onChange={setQ} placeholder={tab === 'truck' ? 'Search unit, make, VIN…' : 'Search name, type, serial…'} />
            <div className="chips">
              <button className="chip" aria-pressed={downOnly} onClick={() => setParam('status', downOnly ? null : 'down')}>
                Down only
              </button>
              <button className="chip" aria-pressed={showRetired} onClick={() => setShowRetired((s) => !s)}>
                Show retired
              </button>
            </div>
          </div>
          {list.length === 0 ? (
            <EmptyState icon="search" title="Nothing matches">Try clearing the filters.</EmptyState>
          ) : (
            <div className="list">
              {list.map((a) => (
                <Link key={a.id} to={`/assets/${a.id}`} className={`row${a.retired_at ? ' retired' : ''}`}>
                  <div className="grow">
                    <div className="title">{a.label}</div>
                    <div className="meta">
                      {a.kind === 'truck'
                        ? [[a.year, a.make, a.model].filter(Boolean).join(' '), fmtMiles(a.current_mileage)].filter(Boolean).join(' · ')
                        : [cap(a.equipment_type ?? ''), a.make, a.model].filter(Boolean).join(' · ')}
                      {openByAsset.get(a.id) ? ` · ${openByAsset.get(a.id)} open` : ''}
                    </div>
                  </div>
                  {a.retired_at ? <span className="pill neutral">Retired</span> : <StatusPill status={a.status} />}
                  <span className="chev"><Icon name="chevron" /></span>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
      {adding && <AssetForm kind={tab} onClose={() => setParam('add', null)} />}
    </>
  )
}
