import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Only the PUBLIC anon/publishable key is ever used in the browser.
// Both values come from Netlify environment variables at build time.
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient = createClient(
  url || 'http://localhost.invalid',
  anonKey || 'missing-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)

export const PHOTO_BUCKET = 'work-order-photos'

/** Throw on a Supabase error so callers can use try/catch. */
export function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}
