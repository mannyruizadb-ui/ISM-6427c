import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useData, useLookups } from '../state/data'
import { fmtMoney, fmtNum } from '../lib/format'
import type { Part, Vendor } from '../lib/types'
import { EmptyState, PageHead, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

/** Suggest ordering back up to twice the reorder point. */
export function suggestedQty(p: Part): number {
  return Math.max(1, Math.ceil(p.reorder_point * 2 - p.qty_on_hand))
}

export function Reorder() {
  const d = useData()
  const { vendorById } = useLookups()
  const toast = useToast()

  const groups = useMemo(() => {
    const low = d.parts.filter((p) => !p.retired_at && p.qty_on_hand <= p.reorder_point)
    const map = new Map<string, { vendor: Vendor | null; parts: Part[] }>()
    for (const p of low) {
      const key = p.vendor_id ?? ''
      if (!map.has(key)) map.set(key, { vendor: vendorById.get(key) ?? null, parts: [] })
      map.get(key)!.parts.push(p)
    }
    return [...map.values()].sort((a, b) => (a.vendor?.name ?? '~').localeCompare(b.vendor?.name ?? '~'))
  }, [d.parts, vendorById])

  const listText = (g: { vendor: Vendor | null; parts: Part[] }) =>
    [`Order for ${g.vendor?.name ?? 'vendor'}:`, ...g.parts.map((p) => `${suggestedQty(p)} x ${p.part_number} - ${p.description}`)].join('\n')

  return (
    <>
      <PageHead
        title="Reorder list"
        sub="Parts at or below their reorder point, grouped by vendor. Suggested quantity brings stock back to twice the reorder point."
        actions={groups.length ? <button className="btn" onClick={() => window.print()}>Print</button> : undefined}
      />
      {d.parts.length === 0 ? (
        <EmptyState icon="box" title="No parts in inventory yet" action={<Link to="/parts?add=1" className="btn primary">Add parts</Link>}>
          Once parts have reorder points, anything running low shows up here grouped by vendor.
        </EmptyState>
      ) : groups.length === 0 ? (
        <EmptyState icon="check" title="Nothing to reorder">
          Every part is above its reorder point.
        </EmptyState>
      ) : (
        <div className="stack">
          {groups.map((g) => {
            const total = g.parts.reduce((s, p) => s + suggestedQty(p) * p.unit_cost, 0)
            const text = listText(g)
            return (
              <section key={g.vendor?.id ?? 'none'} className="card">
                <div className="card-head">
                  <div>
                    <h2>{g.vendor?.name ?? 'No vendor set'}</h2>
                    <p className="small muted">
                      {[g.vendor?.contact_name, g.vendor?.phone, g.vendor?.email].filter(Boolean).join(' · ') || (g.vendor ? 'No contact details' : 'Assign a vendor to these parts')}
                    </p>
                  </div>
                  <div className="actions no-print">
                    {g.vendor?.phone && (
                      <a className="btn" href={`tel:${g.vendor.phone}`}>Call</a>
                    )}
                    {g.vendor?.email && (
                      <a className="btn" href={`mailto:${g.vendor.email}?subject=${encodeURIComponent('Parts order')}&body=${encodeURIComponent(text)}`}>
                        Email
                      </a>
                    )}
                    <button
                      className="btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(text)
                          toast('Order list copied')
                        } catch {
                          toast('Could not copy', true)
                        }
                      }}
                    >
                      <Icon name="clipboard" /> Copy
                    </button>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Part #</th>
                        <th>Description</th>
                        <th className="num">On hand</th>
                        <th className="num">Reorder at</th>
                        <th className="num">Order</th>
                        <th className="num">Est. cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.parts.map((p) => (
                        <tr key={p.id}>
                          <td className="nowrap">{p.part_number}</td>
                          <td>{p.description}</td>
                          <td className="num" style={{ color: p.qty_on_hand <= 0 ? 'var(--danger)' : undefined }}>{fmtNum(p.qty_on_hand)}</td>
                          <td className="num">{fmtNum(p.reorder_point)}</td>
                          <td className="num"><strong>{suggestedQty(p)}</strong></td>
                          <td className="num">{fmtMoney(suggestedQty(p) * p.unit_cost)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={5}>Estimated order total</td>
                        <td className="num">{fmtMoney(total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>
            )
          })}
        </div>
      )}
    </>
  )
}
