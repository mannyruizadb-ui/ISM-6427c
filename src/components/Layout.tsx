import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { Icon } from './Icon'
import { useAuth, useRole } from '../state/auth'
import { useData } from '../state/data'
import { allPmStatuses } from '../lib/pm'
import { useTheme, type ThemeChoice } from '../state/theme'

export interface NavItem {
  to: string
  label: string
  icon: string
  badge?: number
}

export function useNav() {
  const { isAdmin, isStaff, isDriver } = useRole()
  const d = useData()
  const counts = useMemo(() => {
    const open = d.work_orders.filter((w) => w.status !== 'done').length
    const overdue = allPmStatuses(d.pm_schedules, d.assets).filter((s) => s.state === 'overdue').length
    const low = d.parts.filter((p) => !p.retired_at && p.qty_on_hand <= p.reorder_point).length
    return { open, overdue, low }
  }, [d.work_orders, d.pm_schedules, d.assets, d.parts])

  const main: NavItem[] = []
  const more: NavItem[] = []
  if (isDriver) {
    main.push({ to: '/', label: 'Home', icon: 'home' }, { to: '/report', label: 'Report', icon: 'alert' })
  }
  if (isStaff) {
    main.push(
      { to: '/', label: 'Home', icon: 'home' },
      { to: '/work-orders', label: 'Work orders', icon: 'wrench', badge: counts.open },
      { to: '/assets', label: 'Assets', icon: 'truck' },
      { to: '/parts', label: 'Parts', icon: 'box', badge: counts.low },
    )
    more.push({ to: '/maintenance', label: 'Maintenance', icon: 'calendar', badge: counts.overdue })
  }
  if (isAdmin) {
    more.push(
      { to: '/reports', label: 'Reports', icon: 'chart' },
      { to: '/admin/people', label: 'People', icon: 'users' },
      { to: '/admin/vendors', label: 'Vendors', icon: 'store' },
      { to: '/admin/import', label: 'Import CSV', icon: 'upload' },
    )
  }
  more.push({ to: '/settings', label: 'Settings', icon: 'settings' })
  return { main, more }
}

const TITLES: [RegExp, string][] = [
  [/^\/$/, 'Home'],
  [/^\/work-orders\/new/, 'New work order'],
  [/^\/work-orders\/.+/, 'Work order'],
  [/^\/work-orders/, 'Work orders'],
  [/^\/report/, 'Report a problem'],
  [/^\/assets\/.+/, 'Asset'],
  [/^\/assets/, 'Assets'],
  [/^\/parts\/reorder/, 'Reorder'],
  [/^\/parts/, 'Parts'],
  [/^\/maintenance/, 'Maintenance'],
  [/^\/reports/, 'Reports'],
  [/^\/admin\/people/, 'People'],
  [/^\/admin\/vendors/, 'Vendors'],
  [/^\/admin\/import/, 'Import CSV'],
  [/^\/settings/, 'Settings'],
  [/^\/more/, 'More'],
]

export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  const next: Record<ThemeChoice, ThemeChoice> = { system: 'light', light: 'dark', dark: 'system' }
  const icon = theme === 'light' ? 'sun' : theme === 'dark' ? 'moon' : 'monitor'
  return (
    <button
      type="button"
      className="icon-btn"
      onClick={() => setTheme(next[theme])}
      aria-label={`Theme: ${theme}. Switch to ${next[theme]}`}
      title={`Theme: ${theme}`}
    >
      <Icon name={icon} />
    </button>
  )
}

export function Layout() {
  const { main, more } = useNav()
  const { profile, signOut } = useAuth()
  const loc = useLocation()
  const nav = useNavigate()
  const title = TITLES.find(([re]) => re.test(loc.pathname))?.[1] ?? 'Fleet Repair Log'
  const isTop = main.some((m) => m.to === loc.pathname) || loc.pathname === '/more'
  const moreActive = more.some((m) => loc.pathname.startsWith(m.to)) || loc.pathname === '/more'

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <img src="/icons/icon-192.png" alt="" />
          <span>Fleet Repair Log</span>
        </div>
        {main.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className="nav-link">
            <Icon name={n.icon} />
            {n.label}
            {!!n.badge && <span className="nav-badge">{n.badge}</span>}
          </NavLink>
        ))}
        {more.length > 0 && <div className="nav-section">More</div>}
        {more.map((n) => (
          <NavLink key={n.to} to={n.to} className="nav-link">
            <Icon name={n.icon} />
            {n.label}
            {!!n.badge && <span className="nav-badge">{n.badge}</span>}
          </NavLink>
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 16 }}>
          <div className="small muted" style={{ padding: '0 12px 8px' }}>
            Signed in as <strong>{profile?.full_name}</strong>
          </div>
          <div style={{ display: 'flex', gap: 4, padding: '0 4px' }}>
            <ThemeToggle />
            <button type="button" className="icon-btn" onClick={signOut} aria-label="Sign out" title="Sign out">
              <Icon name="logout" />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          {!isTop && (
            <button type="button" className="icon-btn" onClick={() => nav(-1)} aria-label="Back">
              <Icon name="back" />
            </button>
          )}
          <div className="title">{title}</div>
          <ThemeToggle />
        </header>
        <main className="content">
          <Outlet />
        </main>
        <nav className="tabbar" aria-label="Main navigation">
          {main.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}>
              <Icon name={n.icon} />
              {n.label === 'Work orders' ? 'Work' : n.label}
              {!!n.badge && <span className="dot" aria-label={`${n.badge} items`} />}
            </NavLink>
          ))}
          <NavLink to="/more" className={moreActive ? 'active' : ''}>
            <Icon name="menu" />
            More
            {more.some((m) => m.badge) && <span className="dot" />}
          </NavLink>
        </nav>
      </div>
    </div>
  )
}
