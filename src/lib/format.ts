const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const money0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const num = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export const fmtMoney = (n: number | null | undefined) => money.format(Number(n ?? 0))
export const fmtMoney0 = (n: number | null | undefined) => money0.format(Number(n ?? 0))
export const fmtNum = (n: number | null | undefined) => (n == null ? '—' : num.format(Number(n)))
export const fmtMiles = (n: number | null | undefined) => (n == null ? '—' : `${num.format(n)} mi`)
export const fmtHours = (n: number | null | undefined) => `${num.format(Number(n ?? 0))} h`

/** Parse a YYYY-MM-DD date as a local date (not UTC midnight). */
export function parseDay(d: string): Date {
  const [y, m, day] = d.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, day)
}

export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—'
  const date = d.length <= 10 ? parseDay(d) : new Date(d)
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function todayISO(): string {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

export function addDays(iso: string, days: number): string {
  const d = parseDay(iso)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((parseDay(toISO).getTime() - parseDay(fromISO).getTime()) / 86_400_000)
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function firstName(full: string | null | undefined): string {
  return (full || '').trim().split(/\s+/)[0] || 'there'
}

export const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  waiting_parts: 'Waiting on parts',
  done: 'Done',
  in_service: 'In service',
  down: 'Down',
  fixed: 'Fixed',
  temporary: 'Temporary fix',
  not_fixed: 'Not fixed',
  emergency: 'Emergency',
  maintenance: 'Maintenance',
}

export const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  mechanic: 'Mechanic',
  driver: 'Driver',
  pending: 'Waiting for approval',
}

export function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function toNum(v: string): number | null {
  const t = v.replace(/[$,\s]/g, '')
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
