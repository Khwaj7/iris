import { supabase } from './supabase'

// "Last connection" for the admin panel: `profiles.last_seen_at`, stamped
// whenever the app is opened (or comes back to the foreground) under a name.
//
// An UPDATE, never an upsert: a profile deleted from the admin panel must not
// be re-created by its owner simply opening the app (see `profileRemoved` in
// App). Failures are ignored on purpose — before the column is added in the
// Supabase dashboard this simply records nothing, and nothing else depends on it.
export function recordVisit(name: string) {
  supabase
    .from('profiles')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('name', name)
    .then(() => {})
}

// The SQL to run once in the Supabase dashboard (SQL editor) to enable it.
export const LAST_SEEN_SQL = 'alter table public.profiles add column if not exists last_seen_at timestamptz;'
