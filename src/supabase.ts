import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY)?.trim()

export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey)
export const supabase = supabaseConfigured && supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  : null

export type SavedDashboard = {
  id: string
  title: string
  dataset: unknown
  metadata: unknown
  created_at: string
}

export async function saveDashboardRecord(id: string, title: string, dataset: unknown, metadata: unknown) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('create_shared_dashboard', {
    p_id: id,
    p_title: title,
    p_dataset: dataset,
    p_metadata: metadata,
  })
  if (error) throw new Error(error.message)
  if (data !== id) throw new Error('Supabase did not confirm the saved dashboard ID.')
}

export async function getDashboardRecord(id: string): Promise<SavedDashboard | null> {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.rpc('get_shared_dashboard', { p_id: id })
  if (error) throw new Error(error.message)
  const rows = Array.isArray(data) ? data : data ? [data] : []
  return (rows[0] as SavedDashboard | undefined) ?? null
}
