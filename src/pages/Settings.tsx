import { useEffect, useState } from 'react'
import { useAuth, useRole } from '../state/auth'
import { useData } from '../state/data'
import { useTheme } from '../state/theme'
import { supabase, must } from '../lib/supabase'
import { ROLE_LABEL, toNum } from '../lib/format'
import type { Settings as SettingsRow } from '../lib/types'
import { Field, PageHead, Segmented, useToast } from '../components/ui'

export function Settings() {
  const { profile, refreshProfile, signOut } = useAuth()
  const { isAdmin } = useRole()
  const d = useData()
  const toast = useToast()
  const { theme, setTheme } = useTheme()
  const [name, setName] = useState(profile?.full_name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [pw, setPw] = useState('')
  const [company, setCompany] = useState(d.settings?.company_name ?? '')
  const [rate, setRate] = useState(d.settings?.default_labor_rate != null ? String(d.settings.default_labor_rate) : '')

  useEffect(() => {
    setCompany(d.settings?.company_name ?? '')
    setRate(d.settings?.default_labor_rate != null ? String(d.settings.default_labor_rate) : '')
  }, [d.settings])

  const saveProfile = async () => {
    try {
      must(await supabase.from('profiles').update({ full_name: name.trim(), phone: phone.trim() || null }).eq('id', profile!.id))
      await refreshProfile()
      toast('Profile saved')
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  const savePassword = async () => {
    if (pw.length < 8) return toast('Use at least 8 characters.', true)
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) return toast(error.message, true)
    setPw('')
    toast('Password changed')
  }

  const saveShop = async () => {
    const r = rate.trim() === '' ? null : toNum(rate)
    if (rate.trim() !== '' && (r == null || r < 0)) return toast('Labor rate must be a number.', true)
    try {
      const row = must(
        await supabase.from('app_settings').update({ company_name: company.trim() || null, default_labor_rate: r }).eq('id', 1).select().single(),
      )
      d.upsertLocal('app_settings', row as SettingsRow)
      toast('Shop settings saved')
    } catch (e) {
      toast((e as Error).message, true)
    }
  }

  return (
    <div className="stack">
      <PageHead title="Settings" />

      <section className="card form">
        <h2>Appearance</h2>
        <Segmented
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
            { value: 'system', label: 'System' },
          ]}
        />
        <p className="small muted">Saved on this device.</p>
      </section>

      {isAdmin && (
        <section className="card form">
          <h2>Shop</h2>
          <div className="form-grid">
            <Field label="Company name" htmlFor="company" hint="Shown on PDF reports.">
              <input id="company" value={company} onChange={(e) => setCompany(e.target.value)} />
            </Field>
            <Field label="Default labor rate ($/hour)" htmlFor="rate" hint="Filled in on each new work order; can be changed per job.">
              <input id="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </Field>
          </div>
          <div>
            <button className="btn primary" onClick={saveShop}>Save shop settings</button>
          </div>
          {d.settings?.setup_dismissed && (
            <button
              className="btn ghost"
              onClick={async () => {
                const { error } = await supabase.from('app_settings').update({ setup_dismissed: false }).eq('id', 1)
                if (error) toast(error.message, true)
                else toast('Setup checklist is back on the dashboard')
              }}
            >
              Show the setup checklist again
            </button>
          )}
        </section>
      )}

      <section className="card form">
        <h2>My profile</h2>
        <p className="small muted">
          {profile?.email} · {ROLE_LABEL[profile?.role ?? 'pending']}
        </p>
        <div className="form-grid">
          <Field label="Name" htmlFor="myname">
            <input id="myname" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Phone" htmlFor="myphone">
            <input id="myphone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Field>
        </div>
        <div>
          <button className="btn primary" onClick={saveProfile} disabled={!name.trim()}>Save profile</button>
        </div>
      </section>

      <section className="card form" id="password">
        <h2>Change password</h2>
        <Field label="New password" htmlFor="newpw">
          <input id="newpw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
        </Field>
        <div>
          <button className="btn" onClick={savePassword}>Change password</button>
        </div>
      </section>

      <button className="btn danger" onClick={signOut}>Sign out</button>
    </div>
  )
}
