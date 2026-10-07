import { Link } from 'react-router-dom'
import { useNav } from '../components/Layout'
import { useAuth } from '../state/auth'
import { ROLE_LABEL } from '../lib/format'
import { Icon } from '../components/Icon'

export function More() {
  const { more } = useNav()
  const { profile, signOut } = useAuth()
  return (
    <div className="stack">
      <div className="card">
        <div className="title" style={{ fontWeight: 700 }}>{profile?.full_name}</div>
        <div className="muted small">{profile?.email} · {ROLE_LABEL[profile?.role ?? 'pending']}</div>
      </div>
      <div className="list">
        {more.map((n) => (
          <Link key={n.to} to={n.to} className="row">
            <Icon name={n.icon} />
            <div className="grow title">{n.label}</div>
            {!!n.badge && <span className="pill danger">{n.badge}</span>}
            <span className="chev"><Icon name="chevron" /></span>
          </Link>
        ))}
        <button className="row" onClick={signOut}>
          <Icon name="logout" />
          <div className="grow title">Sign out</div>
        </button>
      </div>
    </div>
  )
}
