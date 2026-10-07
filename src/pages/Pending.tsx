import { useAuth } from '../state/auth'
import { firstName } from '../lib/format'
import { EmptyState } from '../components/ui'
import { ThemeToggle } from '../components/Layout'

export function Pending() {
  const { profile, signOut, refreshProfile } = useAuth()
  const retired = profile && !profile.active
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <EmptyState
          icon="users"
          title={retired ? 'Your access has been turned off' : `Thanks, ${firstName(profile?.full_name)} — you're almost in`}
          action={
            <div className="actions" style={{ justifyContent: 'center' }}>
              {!retired && (
                <button className="btn primary" onClick={refreshProfile}>
                  Check again
                </button>
              )}
              <button className="btn" onClick={signOut}>
                Sign out
              </button>
              <ThemeToggle />
            </div>
          }
        >
          {retired
            ? 'Ask an admin if you think this is a mistake.'
            : 'An admin needs to approve your account and set you up as a mechanic, driver or admin. This page updates by itself once they do.'}
        </EmptyState>
      </div>
    </div>
  )
}
