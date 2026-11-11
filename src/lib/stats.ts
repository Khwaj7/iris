import type { Media } from './supabase'
import type { MediaType } from './media'
import { categoryColor } from './tmdb'

// Everything the stats view shows, derived from data App already holds in
// memory — no extra Supabase or TMDB request. Pure, so it recomputes on every
// realtime update like the rest of the UI.

export type TypeSplit = Record<MediaType, number>

export type GenreStat = { name: string; color: string; count: number }

export type PersonStat = {
  name: string
  added: number
  seen: number
  // Share of the (filtered) list this profile has seen, 0–1.
  seenShare: number
}

export type Bucket = {
  key: string
  // Short axis label, and the full one for the tooltip.
  label: string
  fullLabel: string
  counts: TypeSplit
  total: number
}

export type Stats = {
  total: number
  byType: TypeSplit
  seenByMe: number
  toWatchForMe: number
  seenByAnyone: number
  genres: GenreStat[]
  people: PersonStat[]
  decades: Bucket[]
  // Rows with no release year, left out of the decade chart.
  undated: number
  months: Bucket[]
  seenByEveryone: Media[]
  seenByNobody: Media[]
  oldest: Media | null
  newest: Media | null
  lastAdded: Media | null
}

const MONTH_COUNT = 12

const emptySplit = (): TypeSplit => ({ movie: 0, tv: 0 })

function byTitle(a: Media, b: Media) {
  return a.title.localeCompare(b.title, 'fr')
}

export function computeStats(
  media: Media[],
  seenBy: Record<string, string[]>,
  profiles: string[],
  username: string,
  now: Date = new Date()
): Stats {
  const viewers = (item: Media) => seenBy[item.id] ?? []

  const byType = emptySplit()
  for (const item of media) byType[item.media_type]++

  const seenByMe = media.filter((m) => viewers(m).includes(username)).length
  const seenByAnyone = media.filter((m) => viewers(m).length > 0).length

  // Genres, largest first; "Autre" always last whatever its size.
  const genreCounts = new Map<string, number>()
  for (const item of media) {
    const name = item.category ?? 'Autre'
    genreCounts.set(name, (genreCounts.get(name) ?? 0) + 1)
  }
  const genres = [...genreCounts]
    .map(([name, count]) => ({ name, count, color: categoryColor(name === 'Autre' ? null : name) }))
    .sort((a, b) => {
      if (a.name === 'Autre') return 1
      if (b.name === 'Autre') return -1
      return b.count - a.count || a.name.localeCompare(b.name, 'fr')
    })

  // Everyone who has a profile or added something — a person who added a title
  // but never registered a profile still counts as an adder.
  const names = new Set(profiles)
  for (const item of media) names.add(item.added_by)
  const people = [...names]
    .map((name) => {
      const added = media.filter((m) => m.added_by === name).length
      const seen = media.filter((m) => viewers(m).includes(name)).length
      return { name, added, seen, seenShare: media.length ? seen / media.length : 0 }
    })
    .filter((p) => p.added > 0 || p.seen > 0 || profiles.includes(p.name))
    .sort((a, b) => b.seen - a.seen || b.added - a.added || a.name.localeCompare(b.name, 'fr'))

  // Decades, continuous from the oldest to the newest so gaps show as gaps.
  const dated = media.filter((m) => m.year != null)
  const decades: Bucket[] = []
  if (dated.length > 0) {
    const years = dated.map((m) => m.year!)
    const first = Math.floor(Math.min(...years) / 10) * 10
    const last = Math.floor(Math.max(...years) / 10) * 10
    for (let decade = first; decade <= last; decade += 10) {
      decades.push({
        key: String(decade),
        label: decade >= 2000 ? String(decade) : `${String(decade).slice(2)}s`,
        fullLabel: `Années ${decade}`,
        counts: emptySplit(),
        total: 0,
      })
    }
    for (const item of dated) {
      const bucket = decades[(Math.floor(item.year! / 10) * 10 - first) / 10]
      bucket.counts[item.media_type]++
      bucket.total++
    }
  }

  // Additions over the last twelve months, current month included.
  const monthShort = new Intl.DateTimeFormat('fr-FR', { month: 'short' })
  const monthLong = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' })
  const months: Bucket[] = []
  for (let i = MONTH_COUNT - 1; i >= 0; i--) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      key: `${date.getFullYear()}-${date.getMonth()}`,
      label: monthShort.format(date).replace('.', ''),
      fullLabel: monthLong.format(date),
      counts: emptySplit(),
      total: 0,
    })
  }
  const monthIndex = new Map(months.map((m, i) => [m.key, i]))
  for (const item of media) {
    const date = new Date(item.created_at)
    const index = monthIndex.get(`${date.getFullYear()}-${date.getMonth()}`)
    if (index === undefined) continue
    months[index].counts[item.media_type]++
    months[index].total++
  }

  // "Seen by everyone" needs at least one profile, or it would be every title.
  const seenByEveryone =
    profiles.length > 0
      ? media.filter((m) => profiles.every((p) => viewers(m).includes(p))).sort(byTitle)
      : []
  const seenByNobody = media.filter((m) => viewers(m).length === 0).sort(byTitle)

  const pick = (better: (a: Media, b: Media) => boolean, list: Media[]) =>
    list.reduce<Media | null>((best, m) => (best === null || better(m, best) ? m : best), null)

  return {
    total: media.length,
    byType,
    seenByMe,
    toWatchForMe: media.length - seenByMe,
    seenByAnyone,
    genres,
    people,
    decades,
    undated: media.length - dated.length,
    months,
    seenByEveryone,
    seenByNobody,
    oldest: pick((a, b) => a.year! < b.year!, dated),
    newest: pick((a, b) => a.year! > b.year!, dated),
    lastAdded: pick((a, b) => a.created_at > b.created_at, media),
  }
}
