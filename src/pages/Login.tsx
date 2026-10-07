import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Field, Segmented } from '../components/ui'
import { ThemeToggle } from '../components/Layout'

type Mode = 'signin' | 'signup' | 'forgot'

export function Login() {
  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setInfo(null)
    try {
      if (mode === 'signin') {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      } else if (mode === 'signup') {
        if (!name.trim()) throw new Error('Please enter your name.')
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin },
        })
        if (error) throw error
        if (!data.session) setInfo('Account created. Check your email for a confirmation link, then sign in.')
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/settings`,
        })
        if (error) throw error
        setInfo('If that email has an account, a reset link is on its way.')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <img src="/icons/icon-192.png" alt="" />
          <span>Fleet Repair Log</span>
        </div>
        <p className="muted" style={{ textAlign: 'center', marginBottom: 20 }}>
          Trucks, plant equipment, repairs and parts in one place.
        </p>
        <div className="card">
          {mode !== 'forgot' && (
            <div style={{ marginBottom: 16 }}>
              <Segmented
                label="Sign in or create account"
                value={mode}
                onChange={(m) => {
                  setMode(m)
                  setError(null)
                  setInfo(null)
                }}
                options={[
                  { value: 'signin', label: 'Sign in' },
                  { value: 'signup', label: 'Create account' },
                ]}
              />
            </div>
          )}
          <form className="form" onSubmit={submit}>
            {mode === 'forgot' && <h2>Reset your password</h2>}
            {mode === 'signup' && (
              <Field label="Your name" htmlFor="name">
                <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </Field>
            )}
            <Field label="Email" htmlFor="email">
              <input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </Field>
            {mode !== 'forgot' && (
              <Field label="Password" htmlFor="password" hint={mode === 'signup' ? 'At least 8 characters.' : undefined}>
                <input
                  id="password"
                  type="password"
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  minLength={mode === 'signup' ? 8 : undefined}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </Field>
            )}
            {error && <div className="banner error" role="alert">{error}</div>}
            {info && <div className="banner ok" role="status">{info}</div>}
            <button className="btn primary big block" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'}
            </button>
            {mode === 'signin' && (
              <button type="button" className="btn ghost" onClick={() => setMode('forgot')}>
                Forgot password?
              </button>
            )}
            {mode === 'forgot' && (
              <button type="button" className="btn ghost" onClick={() => setMode('signin')}>
                Back to sign in
              </button>
            )}
          </form>
        </div>
        {mode === 'signup' && (
          <p className="small muted" style={{ textAlign: 'center', marginTop: 12 }}>
            New accounts wait for an admin to approve them and choose their role.
          </p>
        )}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}
