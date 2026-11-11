import { supabase } from './supabase'
import type { Media } from './supabase'

// Profile management for the admin panel. Supabase has no transactions over
// the REST API, so each operation is a sequence of writes, ordered so that a
// failure part-way leaves nothing dangling: rows that point at a profile
// (`seen`, then `media`) are dealt with before the profile row itself.
//
// Every function throws on the first failed write, with a French message.

function check(step: string, error: { message: string } | null) {
  if (error) throw new Error(`${step} : ${error.message}`)
}

// The admin code, from VITE_ADMIN_CODE. Client-side like every VITE_ value,
// so it keeps honest people out, not a determined one.
export const ADMIN_CODE: string | undefined = import.meta.env.VITE_ADMIN_CODE || undefined

export type RemovalMode = 'merge' | 'deleteSeen' | 'deleteAll'

// Moves everything `from` did onto `into`, then removes `from`: its "seen"
// marks (skipping titles `into` had already seen) and the titles it added.
export async function mergeProfile(
  from: string,
  into: string,
  seenBy: Record<string, string[]>
) {
  const mediaIds = Object.entries(seenBy)
    .filter(([, names]) => names.includes(from) && !names.includes(into))
    .map(([id]) => id)
  if (mediaIds.length > 0) {
    const { error } = await supabase.from('seen').upsert(
      mediaIds.map((media_id) => ({ media_id, profile_name: into })),
      { ignoreDuplicates: true }
    )
    check('Transfert des vus impossible', error)
  }

  const { error: seenError } = await supabase.from('seen').delete().eq('profile_name', from)
  check('Suppression des anciens vus impossible', seenError)

  const { error: mediaError } = await supabase
    .from('media')
    .update({ added_by: into })
    .eq('added_by', from)
  check('Transfert des ajouts impossible', mediaError)

  await deleteProfileRow(from)
}

// Removes the profile and its "seen" marks. With `withAdded`, the titles it
// added go too — for everyone, along with everyone's "seen" marks on them.
export async function deleteProfile(
  name: string,
  media: Media[],
  seenBy: Record<string, string[]>,
  withAdded: boolean
) {
  const added = withAdded ? media.filter((m) => m.added_by === name).map((m) => m.id) : []
  if (added.length > 0) {
    const { error } = await supabase.from('seen').delete().in('media_id', added)
    check('Suppression des vus sur ses ajouts impossible', error)
    const { error: mediaError } = await supabase.from('media').delete().in('id', added)
    check('Suppression de ses ajouts impossible', mediaError)
  }

  const { error } = await supabase.from('seen').delete().eq('profile_name', name)
  check('Suppression de ses vus impossible', error)

  // Keep the legacy media.seen flag ("seen by anyone") true only where someone
  // is left who has seen the title.
  const removedAdded = new Set(added)
  const nowUnseen = Object.entries(seenBy)
    .filter(([id, names]) => !removedAdded.has(id) && names.length === 1 && names[0] === name)
    .map(([id]) => id)
  if (nowUnseen.length > 0) {
    const { error: flagError } = await supabase
      .from('media')
      .update({ seen: false })
      .in('id', nowUnseen)
    check('Mise à jour des titres vus impossible', flagError)
  }

  await deleteProfileRow(name)
}

async function deleteProfileRow(name: string) {
  // `.select()` returns the deleted rows, so a delete silently filtered out by
  // a row-level-security policy shows up as zero rows instead of "success".
  const { data, error } = await supabase.from('profiles').delete().eq('name', name).select()
  check('Suppression du profil impossible', error)
  if (!data || data.length === 0) {
    throw new Error(
      `Suppression du profil « ${name} » refusée par Supabase (règle d'accès sur la table profiles ?)`
    )
  }
}
