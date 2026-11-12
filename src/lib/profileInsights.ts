import type { Media } from './supabase'
import type { MediaType } from './media'
import { categoryColor } from './tmdb'

// Everything the admin panel can say about one profile, derived from data App
// already holds plus the `seen` timestamps the panel fetches itself. Pure, so
// it recomputes on every realtime update.

export type TypeSplit = Record<MediaType, number>

export type DatedMedia = { item: Media; at: string }

export type ProfileInsights = {
  added: TypeSplit & { total: number }
  seen: TypeSplit & { total: number }
  // Titles in the shared list this profile hasn't seen yet.
  toWatch: number
  // Share of the whole list this profile has seen, 0–1.
  seenShare: number
  // Most frequent genre among what it has seen, else among what it added.
  favouriteGenre: { name: string; color: string; count: number } | null
  firstAdded: DatedMedia | null
  lastAdded: DatedMedia | null
  // Needs seen.created_at; null when unknown.
  lastSeen: DatedMedia | null
  // Of the titles it added, how many someone else has seen.
  addedSeenByOthers: number
  // Titles nobody else has seen.
  seenAlone: number
  // The other profile with the most titles seen in common.
  closest: { name: string; common: number } | null
  // Most recent sign of life: an addition, a "seen" mark, or opening the app.
  lastActivity: string | null
}

const emptySplit = (): TypeSplit => ({ movie: 0, tv: 0 })

const latest = (...dates: (string | null | undefined)[]) =>
  dates.reduce<string | null>((best, d) => (d && (!best || d > best) ? d : best), null)

export function computeProfileInsights(
  name: string,
  media: Media[],
  seenBy: Record<string, string[]>,
  profiles: string[],
  // media id -> profile name -> when it was marked seen
  seenAt: Record<string, Record<string, string>>,
  lastConnection: string | null
): ProfileInsights {
  const viewers = (item: Media) => seenBy[item.id] ?? []

  const addedList = media.filter((m) => m.added_by === name)
  const seenList = media.filter((m) => viewers(m).includes(name))

  const added = { ...emptySplit(), total: addedList.length }
  for (const m of addedList) added[m.media_type]++
  const seen = { ...emptySplit(), total: seenList.length }
  for (const m of seenList) seen[m.media_type]++

  const genreSource = seenList.length > 0 ? seenList : addedList
  const genreCounts = new Map<string, number>()
  for (const m of genreSource) {
    if (m.category) genreCounts.set(m.category, (genreCounts.get(m.category) ?? 0) + 1)
  }
  const [topGenre] = [...genreCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))

  const byCreated = [...addedList].sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  const first = byCreated[0]
  const last = byCreated[byCreated.length - 1]

  let lastSeen: DatedMedia | null = null
  for (const m of seenList) {
    const at = seenAt[m.id]?.[name]
    if (at && (!lastSeen || at > lastSeen.at)) lastSeen = { item: m, at }
  }

  const common = new Map<string, number>()
  for (const m of seenList) {
    for (const other of viewers(m)) {
      if (other !== name && profiles.includes(other)) common.set(other, (common.get(other) ?? 0) + 1)
    }
  }
  const [closest] = [...common].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))

  return {
    added,
    seen,
    toWatch: media.length - seenList.length,
    seenShare: media.length ? seenList.length / media.length : 0,
    favouriteGenre: topGenre
      ? { name: topGenre[0], count: topGenre[1], color: categoryColor(topGenre[0]) }
      : null,
    firstAdded: first ? { item: first, at: first.created_at } : null,
    lastAdded: last ? { item: last, at: last.created_at } : null,
    lastSeen,
    addedSeenByOthers: addedList.filter((m) => viewers(m).some((v) => v !== name)).length,
    seenAlone: seenList.filter((m) => viewers(m).length === 1).length,
    closest: closest ? { name: closest[0], common: closest[1] } : null,
    lastActivity: latest(last?.created_at, lastSeen?.at, lastConnection),
  }
}
