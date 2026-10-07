import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { Profile, Role } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  role: Role | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  // Id of the user whose profile we've finished fetching; avoids flashing the
  // "waiting for approval" screen between sign-in and the profile arriving.
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null)
      setLoadedFor(null)
      return
    }
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile((data as Profile) ?? null)
    setLoadedFor(userId)
  }, [])

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session?.user.id)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Defer: calling Supabase inside this callback can deadlock the auth lock.
        setTimeout(() => loadProfile(s?.user.id), 0)
      }
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  // Live updates to my own profile (e.g. an admin approves me or changes my role).
  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    const ch = supabase
      .channel(`me-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${userId}` }, () =>
        loadProfile(userId),
      )
      .subscribe()
    const onFocus = () => loadProfile(userId)
    window.addEventListener('focus', onFocus)
    return () => {
      supabase.removeChannel(ch)
      window.removeEventListener('focus', onFocus)
    }
  }, [userId, loadProfile])

  const value: AuthState = {
    session,
    profile,
    role: profile && profile.active ? profile.role : null,
    loading: loading || (!!session && loadedFor !== session.user.id),
    refreshProfile: () => loadProfile(userId),
    signOut: async () => {
      await supabase.auth.signOut()
      setProfile(null)
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}

export function useRole() {
  const { role } = useAuth()
  return {
    role,
    isAdmin: role === 'admin',
    isStaff: role === 'admin' || role === 'mechanic',
    isDriver: role === 'driver',
  }
}
