import { useState } from 'react'
import { useData } from '../state/data'
import { useAuth } from '../state/auth'
import { supabase, must } from '../lib/supabase'
import { fmtDate, ROLE_LABEL } from '../lib/format'
import type { Profile, Role } from '../lib/types'
import { EmptyState, Field, PageHead, Segmented, Sheet, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

const ROLES: { value: Exclude<Role, 'pending'>; label: string }[] = [
  { value: 'mechanic', label: 'Mechanic' },
  { value: 'driver', label: 'Driver' },
  { value: 'admin', label: 'Admin' },
]

export function People() {
  const d = useData()
  const { profile: me } = useAuth()
  const toast = useToast()
  const [editing, setEditing] = useState<Profile | null>(null)
  const pending = d.profiles.filter((p) => p.role === 'pending' && p.active)
  const active = d.profiles.filter((p) => p.role !== 'pending' && p.active)
  const retired = d.profiles.filter((p) => !p.active)
  const link = window.location.origin

  const update = async (p: Profile, patch: Partial<Profile>, msg: string) => {
    try {
      const row = must(await supabase.from('profiles').update(patch).eq('id', p.id).select().single())
      d.upsertLocal('profiles', row as Profile)
      toast(msg)
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  const byRole = (r: Role) => active.filter((p) => p.role === r).sort((a, b) => a.full_name.localeCompare(b.full_name))

  return (
    <>
      <PageHead title="People" sub="Mechanics, drivers and admins who can sign in." />

      <section className="card" style={{ marginBottom: 16 }}>
        <h2 style={{ marginBottom: 8 }}>Adding someone</h2>
        <ol style={{ margin: '0 0 12px', paddingLeft: 20 }}>
          <li>Send them the app link below.</li>
          <li>They tap <strong>Create account</strong> and enter their name, email and a password.</li>
          <li>They appear under <strong>Waiting for approval</strong> here — pick their role.</li>
        </ol>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input readOnly value={link} aria-label="App link" style={{ flex: 1, minWidth: 200 }} onFocus={(e) => e.target.select()} />
          <button
            className="btn primary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(link)
                toast('Link copied')
              } catch {
                toast('Could not copy — select the link and copy it', true)
              }
            }}
          >
            <Icon name="clipboard" /> Copy link
          </button>
        </div>
        <p className="small muted" style={{ marginTop: 8 }}>
          New sign-ups can't see anything until you approve them.
        </p>
      </section>

      <section style={{ marginBottom: 20 }}>
        <h2 style={{ marginBottom: 10 }}>Waiting for approval {pending.length > 0 && <span className="pill warn">{pending.length}</span>}</h2>
        {pending.length === 0 ? (
          <EmptyState icon="users" title="No one waiting">
            When a mechanic or driver creates an account, they show up here for you to approve.
          </EmptyState>
        ) : (
          <div className="list">
            {pending.map((p) => (
              <div key={p.id} className="row" style={{ cursor: 'default', flexWrap: 'wrap' }}>
                <div className="grow" style={{ minWidth: 180 }}>
                  <div className="title">{p.full_name}</div>
                  <div className="meta">{p.email} · signed up {fmtDate(p.created_at)}</div>
                </div>
                <div className="actions">
                  <button className="btn primary" onClick={() => update(p, { role: 'mechanic' }, `${p.full_name} approved as mechanic`)}>Mechanic</button>
                  <button className="btn primary" onClick={() => update(p, { role: 'driver' }, `${p.full_name} approved as driver`)}>Driver</button>
                  <button className="btn" onClick={() => update(p, { role: 'admin' }, `${p.full_name} approved as admin`)}>Admin</button>
                  <button className="btn danger" onClick={() => update(p, { active: false }, 'Sign-up declined')}>Decline</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {(['mechanic', 'driver', 'admin'] as const).map((r) => (
        <section key={r} style={{ marginBottom: 20 }}>
          <h2 style={{ marginBottom: 10 }}>{ROLE_LABEL[r]}s ({byRole(r).length})</h2>
          {byRole(r).length === 0 ? (
            <p className="muted">
              {r === 'mechanic' ? 'No mechanics yet — share the link above and approve them as Mechanic.' : r === 'driver' ? 'No drivers yet.' : ''}
            </p>
          ) : (
            <div className="list">
              {byRole(r).map((p) => (
                <button key={p.id} className="row" onClick={() => setEditing(p)}>
                  <div className="grow">
                    <div className="title">{p.full_name}{p.id === me?.id && ' (you)'}</div>
                    <div className="meta">{[p.email, p.phone].filter(Boolean).join(' · ')}</div>
                  </div>
                  <span className="chev"><Icon name="chevron" /></span>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}

      {retired.length > 0 && (
        <section>
          <h2 style={{ marginBottom: 10 }}>Access turned off ({retired.length})</h2>
          <div className="list">
            {retired.map((p) => (
              <div key={p.id} className="row retired" style={{ cursor: 'default' }}>
                <div className="grow">
                  <div className="title">{p.full_name}</div>
                  <div className="meta">{p.email} · was {ROLE_LABEL[p.role]}</div>
                </div>
                <button className="btn" onClick={() => update(p, { active: true }, `${p.full_name} restored`)}>Restore</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {editing && <PersonSheet person={editing} isMe={editing.id === me?.id} onClose={() => setEditing(null)} />}
    </>
  )
}

function PersonSheet({ person, isMe, onClose }: { person: Profile; isMe: boolean; onClose: () => void }) {
  const d = useData()
  const toast = useToast()
  const [name, setName] = useState(person.full_name)
  const [phone, setPhone] = useState(person.phone ?? '')
  const [role, setRole] = useState<Exclude<Role, 'pending'>>(person.role === 'pending' ? 'mechanic' : person.role)
  const [busy, setBusy] = useState(false)

  const save = async (patch: Partial<Profile>, msg: string) => {
    setBusy(true)
    try {
      const row = must(await supabase.from('profiles').update(patch).eq('id', person.id).select().single())
      d.upsertLocal('profiles', row as Profile)
      toast(msg)
      onClose()
    } catch (e) {
      toast((e as Error).message, true)
      setBusy(false)
    }
  }

  return (
    <Sheet
      title={person.full_name}
      onClose={onClose}
      footer={
        <>
          {!isMe && (
            <button className="btn danger" disabled={busy} onClick={() => confirm(`Turn off access for ${person.full_name}? Their history stays.`) && save({ active: false }, 'Access turned off')}>
              Turn off access
            </button>
          )}
          <button className="btn primary" disabled={busy || !name.trim()} onClick={() => save({ full_name: name.trim(), phone: phone.trim() || null, role }, 'Saved')}>
            Save
          </button>
        </>
      }
    >
      <div className="form">
        <Field label="Name" htmlFor="pname">
          <input id="pname" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Phone" htmlFor="pphone">
          <input id="pphone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
        <div className="field">
          <span className="label">Role</span>
          <Segmented label="Role" value={role} onChange={setRole} options={ROLES} />
          <span className="hint">
            {role === 'admin' && 'Full access: costs, reports, setup and people.'}
            {role === 'mechanic' && 'Creates and closes work orders, logs parts used, updates asset status and mileage.'}
            {role === 'driver' && 'Reports problems on trucks with photos. Sees no cost data.'}
          </span>
        </div>
        <p className="small muted">Email: {person.email}</p>
      </div>
    </Sheet>
  )
}
