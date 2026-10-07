import { Link } from 'react-router-dom'
import type { RepeatAlert } from '../lib/reliability'

const KIND_LABEL: Record<RepeatAlert['kind'], { text: string; cls: string }> = {
  same_problem: { text: 'Keeps coming back', cls: 'danger' },
  temporary: { text: 'Temporary fix', cls: 'temporary' },
  frequent: { text: 'Frequent breakdowns', cls: 'warn' },
}

/** List of repeat-failure alerts; each links to the newest work order involved. */
export function RepeatAlerts({ alerts, limit }: { alerts: RepeatAlert[]; limit?: number }) {
  return (
    <div className="list">
      {alerts.slice(0, limit ?? alerts.length).map((a, i) => {
        const latest = a.workOrders[a.workOrders.length - 1]
        const k = KIND_LABEL[a.kind]
        return (
          <Link key={`${a.kind}-${a.asset.id}-${i}`} to={`/work-orders/${latest.id}`} className="row" style={{ flexWrap: 'wrap' }}>
            <div className="grow" style={{ minWidth: 200 }}>
              <div className="title">{a.title}</div>
              <div className="meta">{a.detail}</div>
            </div>
            <span className={`pill ${k.cls}`}>{k.text}</span>
          </Link>
        )
      })}
    </div>
  )
}
