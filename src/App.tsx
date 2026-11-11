import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode, TouchEvent } from 'react'
import { supabase } from './lib/supabase'
import type { Media } from './lib/supabase'
import type { MediaType } from './lib/media'
import {
  MEDIA_EMPTY_SEEN,
  MEDIA_EMPTY_TO_WATCH,
  MEDIA_NOUN,
  MEDIA_TYPE_ICON,
  MEDIA_TYPE_PLURAL,
} from './lib/media'
import {
  categoryColor,
  genreThemes,
  getMediaGenreIds,
  posterUrl,
  primaryCategory,
  searchMedia,
  searchMediaByType,
} from './lib/tmdb'

type Theme = { name: string; color: string }
import type { MediaSearchResult } from './lib/tmdb'
import MediaBadge from './MediaBadge'
import MediaDetail from './MediaDetail'
import StatsView from './StatsView'
import { CinemaHero, Counter, Reveal, Segmented } from './cinema'
import { posterWall, useInView } from './motion'
import './App.css'

type Tab = 'toWatch' | 'seen'

const USERNAME_STORAGE_KEY = 'iris-username'
const GENRES_STORAGE_KEY = 'iris-genres-v2'
const SWIPE_HINT_KEY = 'iris-swipe-hint-seen'

function NamePrompt({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <div className="name-prompt">
      <h1>👁️ Iris</h1>
      <p>Choisis ton prénom pour commencer :</p>
      <form onSubmit={handleSubmit}>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ton prénom"
          maxLength={40}
        />
        <button type="submit" disabled={!name.trim()}>
          C'est parti
        </button>
      </form>
    </div>
  )
}

// "Vu par…" for a film, "Vue par…" for a série — French agreement.
const seenLabel = (item: Media) => (item.media_type === 'tv' ? 'Vue par…' : 'Vu par…')

// Lowercased and stripped of accents so "amelie" matches "Amélie".
function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
}

// TMDB numbers films and series in separate, overlapping ranges, so a bare id
// is ambiguous: everything that identifies a result must carry its type too.
const resultKey = (result: MediaSearchResult) => `${result.mediaType}:${result.id}`

// The row already in our list that corresponds to a TMDB result: matched on
// TMDB id, or on title + year for legacy rows saved before tmdb_id was stored.
// Both branches are gated on the media type — without that, a series would be
// reported as already in the list because some film shares its numeric id.
function findExisting(
  media: Media[],
  result: MediaSearchResult
): Media | undefined {
  return media.find(
    (m) =>
      m.media_type === result.mediaType &&
      ((m.tmdb_id != null && m.tmdb_id === result.id) ||
        (m.title.toLowerCase() === result.title.toLowerCase() &&
          m.year === result.year))
  )
}

function AddMediaForm({
  username,
  media,
  isSeen,
  onAdded,
  onReveal,
  onError,
}: {
  username: string
  media: Media[]
  isSeen: (item: Media) => boolean
  onAdded: (item: Media, genreIds: number[]) => void
  onReveal: (item: Media) => void
  onError: (message: string) => void
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<MediaSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  // Result keys currently being inserted, and those inserted since the query
  // last changed. Both are sets so several titles can be added from one search.
  const [addingIds, setAddingIds] = useState<ReadonlySet<string>>(new Set())
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(new Set())
  const formRef = useRef<HTMLDivElement>(null)

  // Debounced TMDB search; the cancelled flag drops responses that land
  // after the query has changed.
  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setResults([])
      setSearching(false)
      return
    }

    let cancelled = false
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const found = await searchMedia(trimmed)
        if (!cancelled) setResults(found.slice(0, 8))
      } catch (err) {
        if (!cancelled) {
          onError(`Recherche TMDB impossible : ${(err as Error).message}`)
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, onError])

  function clear() {
    setQuery('')
    setResults([])
    setAddedIds(new Set())
  }

  // Dismiss the search on a tap/click outside the form or on Escape. pointerdown
  // covers mouse and touch alike, which is also the mobile gesture; the ✕ button
  // below is the explicit affordance for it.
  useEffect(() => {
    if (!query) return

    function onPointerDown(e: PointerEvent) {
      if (!formRef.current?.contains(e.target as Node)) clear()
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') clear()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [query])

  function reveal(item: Media) {
    clear()
    onReveal(item)
  }

  async function addMedia(result: MediaSearchResult) {
    const key = resultKey(result)
    if (addingIds.has(key) || addedIds.has(key)) return

    // Belt and braces: already-added results are listed apart, but a realtime
    // insert can land between render and click.
    const existing = findExisting(media, result)
    if (existing) {
      reveal(existing)
      return
    }

    setAddingIds((current) => new Set(current).add(key))

    // category is written once here and never recomputed, so it must not be
    // left null: if the search result carried no genres, fetch them first.
    let genreIds = result.genreIds
    if (genreIds.length === 0) {
      try {
        genreIds = await getMediaGenreIds(result.mediaType, result.id)
      } catch {
        genreIds = []
      }
    }

    const { data, error } = await supabase
      .from('media')
      .insert({
        title: result.title,
        year: result.year,
        thumbnail_url: result.posterPath ? posterUrl(result.posterPath) : null,
        category: primaryCategory(genreIds),
        tmdb_id: result.id,
        media_type: result.mediaType,
        added_by: username,
      })
      .select()
      .single()
    setAddingIds((current) => {
      const next = new Set(current)
      next.delete(key)
      return next
    })

    if (error) {
      onError(`Impossible d'ajouter ${MEDIA_NOUN[result.mediaType]} : ${error.message}`)
      return
    }
    // The search stays open so more titles can be added from the same results.
    setAddedIds((current) => new Set(current).add(key))
    onAdded(data as Media, genreIds)
  }

  const trimmed = query.trim()

  // Split the TMDB results into what we already own and what can be added, then
  // append any of our rows whose title matches but that TMDB didn't return.
  const alreadyAdded: Media[] = []
  const addable: MediaSearchResult[] = []
  // Rows added during this search, kept out of the "already in the list" group.
  const justAdded = new Set<string>()
  for (const result of results) {
    const existing = findExisting(media, result)
    if (addedIds.has(resultKey(result))) {
      // Just added: leave the row where it is, marked, rather than let it jump
      // to the other group and reflow the list under the next click.
      addable.push(result)
      if (existing) justAdded.add(existing.id)
    } else if (existing) {
      alreadyAdded.push(existing)
    } else {
      addable.push(result)
    }
  }
  if (trimmed.length >= 2) {
    const needle = normalize(trimmed)
    // Deliberately type-agnostic: this answers "what in your list looks like
    // this?", and the badge on each row makes the kind obvious.
    for (const item of media) {
      if (justAdded.has(item.id)) continue
      if (alreadyAdded.some((m) => m.id === item.id)) continue
      if (normalize(item.title).includes(needle)) alreadyAdded.push(item)
    }
  }

  const hasResults = alreadyAdded.length > 0 || addable.length > 0

  return (
    <div className="add-form" ref={formRef}>
      <div className="add-input-wrap">
        <input
          className="add-title"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // A new search: stop marking the previous one's additions.
            setAddedIds(new Set())
          }}
          placeholder="Chercher un film ou une série…"
          maxLength={200}
        />
        {query && (
          <button className="add-clear" onClick={clear} title="Fermer la recherche">
            ✕
          </button>
        )}
      </div>
      {searching && <p className="search-status">Recherche…</p>}
      {!searching && trimmed.length >= 2 && !hasResults && (
        <p className="search-status">Aucun résultat.</p>
      )}
      {hasResults && (
        <ul className="search-results">
          {alreadyAdded.length > 0 && (
            <>
              <li className="search-group">Déjà dans la liste</li>
              {alreadyAdded.map((item) => (
                <li key={item.id}>
                  <button
                    className="search-result"
                    onClick={() => reveal(item)}
                    title="Voir dans la liste"
                  >
                    {item.thumbnail_url ? (
                      <img className="result-poster" src={item.thumbnail_url} alt="" />
                    ) : (
                      <div className="result-poster poster-placeholder">
                        {MEDIA_TYPE_ICON[item.media_type]}
                      </div>
                    )}
                    <MediaBadge mediaType={item.media_type} />
                    <span className="result-title">
                      {item.title}
                      {item.year && <span className="media-year"> ({item.year})</span>}
                    </span>
                    <span className="result-goto">
                      → {isSeen(item) ? 'Vus' : 'À voir'}
                    </span>
                  </button>
                </li>
              ))}
            </>
          )}
          {addable.length > 0 && (
            <>
              {alreadyAdded.length > 0 && <li className="search-group">Ajouter</li>}
              {addable.map((result) => {
                const key = resultKey(result)
                const added = addedIds.has(key)
                const adding = addingIds.has(key)
                return (
                  <li key={key}>
                    <button
                      className={added ? 'search-result is-added' : 'search-result'}
                      disabled={added || adding}
                      onClick={() => addMedia(result)}
                    >
                      {result.posterPath ? (
                        <img
                          className="result-poster"
                          src={posterUrl(result.posterPath, 92)}
                          alt=""
                        />
                      ) : (
                        <div className="result-poster poster-placeholder">
                          {MEDIA_TYPE_ICON[result.mediaType]}
                        </div>
                      )}
                      <MediaBadge mediaType={result.mediaType} />
                      <span className="result-title">
                        {result.title}
                        {result.year && (
                          <span className="media-year"> ({result.year})</span>
                        )}
                      </span>
                      <span className="result-add">
                        {added ? '✓ Ajouté' : adding ? '…' : '+ Ajouter'}
                      </span>
                    </button>
                  </li>
                )
              })}
            </>
          )}
        </ul>
      )}
    </div>
  )
}

// Distance in px a horizontal drag must cover to mark a title as seen.
const SWIPE_THRESHOLD = 80

const cardAnchorId = (mediaId: string) => `media-${mediaId}`

function MediaCard({
  item,
  index,
  seen,
  themes,
  hint,
  highlight,
  onSeen,
  onOpen,
}: {
  item: Media
  // Position in its section, to stagger the entrance animation.
  index: number
  seen: boolean
  themes: Theme[]
  hint?: boolean
  highlight?: boolean
  onSeen: (item: Media) => void
  onOpen: (item: Media) => void
}) {
  const [dragX, setDragX] = useState(0)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const draggingRef = useRef(false)

  function onTouchStart(e: TouchEvent) {
    startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    draggingRef.current = false
  }

  function onTouchMove(e: TouchEvent) {
    if (!startRef.current) return
    const dx = e.touches[0].clientX - startRef.current.x
    const dy = e.touches[0].clientY - startRef.current.y
    if (!draggingRef.current) {
      // Commit to a horizontal drag only once it clearly beats vertical scroll.
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) draggingRef.current = true
      else if (Math.abs(dy) > 10) {
        startRef.current = null
        return
      } else return
    }
    // Only a right-to-left drag reveals the "seen" action.
    setDragX(Math.max(-140, Math.min(0, dx)))
  }

  function onTouchEnd() {
    // A committed right-to-left swipe opens the "seen by…" profile picker.
    if (draggingRef.current && dragX <= -SWIPE_THRESHOLD) onSeen(item)
    startRef.current = null
    draggingRef.current = false
    setDragX(0)
  }

  const cardStyle = {
    transform: dragX ? `translateX(${dragX}px)` : undefined,
    transition: dragX ? 'none' : 'transform 0.2s ease',
    // Blurred into a faint ambient tint behind the card (see .media-card::before).
    '--poster': item.thumbnail_url ? `url("${item.thumbnail_url}")` : 'none',
  } as CSSProperties

  const cardClass = ['media-card', hint && 'swipe-hint', highlight && 'is-highlighted']
    .filter(Boolean)
    .join(' ')

  return (
    // The id is the scroll anchor used when a search hit is already in the list.
    <li
      className="media-card-wrap"
      id={cardAnchorId(item.id)}
      style={{ '--i': Math.min(index, 8) } as CSSProperties}
    >
      <div className="swipe-reveal">{seenLabel(item)}</div>
      <div
        className={cardClass}
        style={cardStyle}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <button className="media-open" onClick={() => onOpen(item)}>
          {item.thumbnail_url ? (
            <img className="poster" src={item.thumbnail_url} alt="" />
          ) : (
            <div className="poster poster-placeholder">
              {MEDIA_TYPE_ICON[item.media_type]}
            </div>
          )}
          <div className="media-info">
            <span className="media-title">
              {item.title}
              {item.year && <span className="media-year"> ({item.year})</span>}
            </span>
            {/* No film/série badge here: the list is already one type only.
                Search results and the detail page still carry it. */}
            <span className="media-themes">
              {themes.map((theme) => (
                <span
                  key={theme.name}
                  className="media-theme"
                  style={{ color: theme.color, borderColor: theme.color }}
                >
                  {theme.name}
                </span>
              ))}
            </span>
            <span className="media-meta">ajouté par {item.added_by}</span>
          </div>
        </button>
        <button
          className={seen ? 'seen-button is-seen' : 'seen-button'}
          onClick={() => onSeen(item)}
          title="Choisir qui l'a vu"
        >
          ✓
        </button>
      </div>
    </li>
  )
}

function SeenPicker({
  item,
  profiles,
  initial,
  onClose,
  onSave,
}: {
  item: Media
  profiles: string[]
  initial: string[]
  onClose: () => void
  onSave: (selected: string[]) => void
}) {
  const [selected, setSelected] = useState(() => new Set(initial))
  const allSelected = profiles.length > 0 && profiles.every((name) => selected.has(name))

  function toggle(name: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(profiles))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{seenLabel(item)}</h2>
        <p className="modal-subtitle">{item.title}</p>
        {profiles.length > 1 && (
          <label className="profile-option select-all">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} />
            Tout sélectionner
          </label>
        )}
        <ul className="profile-options">
          {profiles.map((name) => (
            <li key={name}>
              <label className="profile-option">
                <input
                  type="checkbox"
                  checked={selected.has(name)}
                  onChange={() => toggle(name)}
                />
                {name}
              </label>
            </li>
          ))}
        </ul>
        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose}>
            Annuler
          </button>
          <button className="modal-save" onClick={() => onSave([...selected])}>
            Valider
          </button>
        </div>
      </div>
    </div>
  )
}

type FilterOption = { value: string; count: number; color?: string }

// Replaces a row of filter pills: a compact trigger showing what's picked,
// opening a checkbox list. An empty selection means no filter at all — which is
// why the trigger then reads "Tous" rather than showing zero of everything.
// Changes apply immediately; unlike SeenPicker there is nothing to commit.
function FilterSelect({
  label,
  options,
  selected,
  onChange,
}: {
  label: string
  options: FilterOption[]
  selected: ReadonlySet<string>
  onChange: (next: ReadonlySet<string>) => void
}) {
  const [open, setOpen] = useState(false)

  // Count only what's actually on offer, so a pick left over from another tab
  // never shows up in the summary.
  const picked = options.filter((option) => selected.has(option.value))
  const summary =
    picked.length === 0
      ? 'Tous'
      : picked.length === 1
        ? picked[0].value
        : `${picked.length} sélectionnés`

  function toggle(value: string) {
    const next = new Set(selected)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    onChange(next)
  }

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  return (
    <div className="filter-select">
      <button
        className={picked.length > 0 ? 'filter-trigger is-active' : 'filter-trigger'}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="filter-trigger-label">{label}</span>
        <span className="filter-trigger-value">{summary}</span>
        <span className="filter-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <>
          <div className="filter-backdrop" onClick={() => setOpen(false)} />
          <div className="filter-menu">
            {picked.length > 0 && (
              <button className="filter-clear" onClick={() => onChange(new Set())}>
                Tout effacer
              </button>
            )}
            <ul className="filter-options">
              {options.map((option) => (
                <li key={option.value}>
                  <label className="profile-option">
                    <input
                      type="checkbox"
                      checked={selected.has(option.value)}
                      onChange={() => toggle(option.value)}
                    />
                    {option.color && (
                      <span
                        className="pill-dot"
                        style={{ background: option.color }}
                      />
                    )}
                    <span className="filter-option-name">{option.value}</span>
                    <span className="pill-count">{option.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}

// The list's header: the poster wall of the current list, the brand and
// account buttons, a big count of what's in the current tab, the search and
// the films / séries switch. Its own component so the count-up hook only
// mounts with the list view.
function ListHero({
  posters,
  count,
  noun,
  sub,
  top,
  children,
}: {
  posters: Media[]
  count: number
  noun: string
  sub: string
  // Above the headline (the top bar); children go below it.
  top: ReactNode
  children: ReactNode
}) {
  const [heroRef, heroVisible] = useInView<HTMLDivElement>()
  return (
    <CinemaHero posters={posters} heroRef={heroRef} width={LIST_WIDTH}>
      {top}
      <h1 className="cine-hero-title list-hero-title">
        <Counter value={count} active={heroVisible} /> <span>{noun}</span>
      </h1>
      <p className="cine-hero-sub">{sub}</p>
      {children}
    </CinemaHero>
  )
}

const LIST_WIDTH = '960px'

function App() {
  const [username, setUsername] = useState(
    () => localStorage.getItem(USERNAME_STORAGE_KEY) ?? ''
  )
  const [media, setMedia] = useState<Media[]>([])
  // The top-level split: films and series are two separate lists, and every
  // filter below applies within the chosen one.
  const [mediaTypeTab, setMediaTypeTab] = useState<MediaType>('movie')
  const [tab, setTab] = useState<Tab>('toWatch')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The stats page. A selected title still wins over it, so opening one from
  // the stats and coming back lands on the stats again.
  const [showStats, setShowStats] = useState(false)
  // Both filters are multi-select; an empty set means "no filter".
  const [categoryFilters, setCategoryFilters] = useState<ReadonlySet<string>>(
    new Set()
  )
  const [addedByFilters, setAddedByFilters] = useState<ReadonlySet<string>>(new Set())
  const [profiles, setProfiles] = useState<string[]>([])
  // media row id -> names of the profiles that have seen it
  const [seenBy, setSeenBy] = useState<Record<string, string[]>>({})
  const [seenPickerId, setSeenPickerId] = useState<string | null>(null)
  const [notices, setNotices] = useState<{ id: number; text: string }[]>([])
  const noticeIdRef = useRef(0)
  // One-time animated swipe demo shown to touch users.
  const [swipeHint, setSwipeHint] = useState(false)
  const swipeHintDone = useRef(false)
  // Row to scroll to and flash after picking it from the search results. Held
  // as a fresh object so picking the same one twice retriggers the effect.
  const [highlight, setHighlight] = useState<{ id: string } | null>(null)
  // media row id -> known genre ids, cached in localStorage to colour theme
  // borders without refetching. Seeded on add and backfilled otherwise.
  // Bump GENRES_STORAGE_KEY whenever the resolution logic changes: this cache
  // is never invalidated, so a wrong write would persist per device.
  const [genresById, setGenresById] = useState<Record<string, number[]>>(() => {
    try {
      return JSON.parse(localStorage.getItem(GENRES_STORAGE_KEY) ?? '{}')
    } catch {
      return {}
    }
  })
  const fetchingGenres = useRef<Set<string>>(new Set())
  const failedGenres = useRef<Set<string>>(new Set())

  useEffect(() => {
    localStorage.setItem(GENRES_STORAGE_KEY, JSON.stringify(genresById))
  }, [genresById])

  // Resolve a row's full genre id list: directly by tmdb_id, or via a
  // title/year search for legacy rows that never stored one. Both paths are
  // media-type-aware — film and series ids overlap, so querying the wrong
  // endpoint can return an unrelated title's genres.
  async function loadGenreIds(item: Media): Promise<number[] | null> {
    try {
      if (item.tmdb_id != null) {
        return await getMediaGenreIds(item.media_type, item.tmdb_id)
      }
      const results = await searchMediaByType(item.title, item.media_type)
      const best =
        (item.year ? results.find((r) => r.year === item.year) : null) ?? results[0]
      return best ? best.genreIds : null
    } catch {
      return null
    }
  }

  // Backfill genre ids for any row we haven't cached yet so its theme border
  // reflects every genre, not just the primary category. Rows that fail are
  // remembered so a permanent failure can't spin the effect forever.
  useEffect(() => {
    const pending = media.filter(
      (m) =>
        !(m.id in genresById) &&
        !fetchingGenres.current.has(m.id) &&
        !failedGenres.current.has(m.id)
    )
    if (pending.length === 0) return

    pending.forEach((m) => fetchingGenres.current.add(m.id))
    let cancelled = false
    Promise.allSettled(
      pending.map(async (m) => [m.id, await loadGenreIds(m)] as const)
    ).then((results) => {
      pending.forEach((m) => fetchingGenres.current.delete(m.id))
      if (cancelled) return
      const additions: Record<string, number[]> = {}
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value[1]) {
          additions[result.value[0]] = result.value[1]
        } else if (result.status === 'fulfilled') {
          failedGenres.current.add(result.value[0])
        }
      }
      if (Object.keys(additions).length > 0) {
        setGenresById((current) => ({ ...current, ...additions }))
      }
    })

    return () => {
      cancelled = true
    }
  }, [media, genresById])

  function sortedProfiles(names: Iterable<string>): string[] {
    return [...names].sort((a, b) => a.localeCompare(b, 'fr'))
  }

  function pushNotice(text: string) {
    const id = ++noticeIdRef.current
    setNotices((current) => [...current.slice(-3), { id, text }])
    setTimeout(() => {
      setNotices((current) => current.filter((n) => n.id !== id))
    }, 6000)
  }

  function dismissNotice(id: number) {
    setNotices((current) => current.filter((n) => n.id !== id))
  }

  // Insert or replace a row in local state (dedupes realtime echoes of our own writes).
  function upsertMedia(item: Media) {
    setMedia((current) => {
      const exists = current.some((m) => m.id === item.id)
      return exists
        ? current.map((m) => (m.id === item.id ? item : m))
        : [item, ...current]
    })
  }

  useEffect(() => {
    supabase
      .from('media')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(`Chargement impossible : ${error.message}`)
        else setMedia(data as Media[])
        setLoading(false)
      })

    supabase
      .from('profiles')
      .select('name')
      .then(({ data, error }) => {
        if (error) setError(`Chargement des profils impossible : ${error.message}`)
        else setProfiles(sortedProfiles(data.map((p) => p.name as string)))
      })

    supabase
      .from('seen')
      .select('media_id, profile_name')
      .then(({ data, error }) => {
        if (error) {
          setError(`Chargement des vus impossible : ${error.message}`)
          return
        }
        const map: Record<string, string[]> = {}
        for (const row of data) {
          ;(map[row.media_id as string] ??= []).push(row.profile_name as string)
        }
        setSeenBy(map)
      })

    const channel = supabase
      .channel('media-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'media' },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            upsertMedia(payload.new as Media)
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'profiles' },
        (payload) => {
          const { name } = payload.new as { name: string }
          setProfiles((current) =>
            current.includes(name) ? current : sortedProfiles([...current, name])
          )
        }
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'seen' },
        (payload) => {
          const row = payload.new as { media_id: string; profile_name: string }
          setSeenBy((current) => {
            const names = current[row.media_id] ?? []
            if (names.includes(row.profile_name)) return current
            return { ...current, [row.media_id]: [...names, row.profile_name] }
          })
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'seen' },
        (payload) => {
          const row = payload.old as { media_id: string; profile_name: string }
          setSeenBy((current) => {
            const names = current[row.media_id]
            if (!names?.includes(row.profile_name)) return current
            return {
              ...current,
              [row.media_id]: names.filter((n) => n !== row.profile_name),
            }
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [])

  // Once the list is ready, play a single animated swipe demo for touch users
  // (only the first time on this device) so they discover the gesture.
  useEffect(() => {
    if (swipeHintDone.current || loading || media.length === 0) return
    if (!window.matchMedia('(hover: none)').matches) return
    swipeHintDone.current = true
    if (localStorage.getItem(SWIPE_HINT_KEY)) return
    localStorage.setItem(SWIPE_HINT_KEY, '1')
    setSwipeHint(true)
    const timer = setTimeout(() => setSwipeHint(false), 3400)
    return () => clearTimeout(timer)
  }, [loading, media.length])

  // Bring the picked card into view, then drop the flash. The tab and
  // filter changes are batched with the highlight, so the card is already in the
  // DOM by the time this runs.
  useEffect(() => {
    if (!highlight) return
    document
      .getElementById(cardAnchorId(highlight.id))
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timer = setTimeout(() => setHighlight(null), 2500)
    return () => clearTimeout(timer)
  }, [highlight])

  // Register the current profile so it shows up in everyone's "seen by" picker.
  useEffect(() => {
    if (!username) return
    supabase
      .from('profiles')
      .upsert({ name: username }, { ignoreDuplicates: true })
      .then(({ error }) => {
        if (!error) {
          setProfiles((current) =>
            current.includes(username)
              ? current
              : sortedProfiles([...current, username])
          )
        }
      })
  }, [username])

  async function saveSeen(item: Media, selected: string[]) {
    setSeenPickerId(null)
    const before = seenBy[item.id] ?? []
    const toAdd = selected.filter((name) => !before.includes(name))
    const toRemove = before.filter((name) => !selected.includes(name))
    if (toAdd.length === 0 && toRemove.length === 0) return

    // Optimistic update; rolled back if any write fails.
    // seenByAnyone is the legacy denormalised media.seen flag — NOT what drives
    // the À voir / Vus tabs, which are per-profile via the `seen` table.
    const seenByAnyone = selected.length > 0
    setSeenBy((current) => ({ ...current, [item.id]: selected }))
    if (seenByAnyone !== item.seen) upsertMedia({ ...item, seen: seenByAnyone })

    const results = await Promise.all([
      toAdd.length > 0
        ? supabase.from('seen').upsert(
            toAdd.map((profile_name) => ({ media_id: item.id, profile_name })),
            { ignoreDuplicates: true }
          )
        : null,
      toRemove.length > 0
        ? supabase
            .from('seen')
            .delete()
            .eq('media_id', item.id)
            .in('profile_name', toRemove)
        : null,
      seenByAnyone !== item.seen
        ? supabase.from('media').update({ seen: seenByAnyone }).eq('id', item.id)
        : null,
    ])

    const failed = results.find((result) => result?.error)
    if (failed) {
      setSeenBy((current) => ({ ...current, [item.id]: before }))
      upsertMedia(item)
      setError(`Mise à jour impossible : ${failed.error!.message}`)
    }
  }

  function handleAdded(item: Media, genreIds: number[]) {
    upsertMedia(item)
    // Switch to the list it landed in, so closing the search doesn't leave the
    // user looking at the other list wondering where it went.
    setMediaTypeTab(item.media_type)
    setGenresById((current) => ({ ...current, [item.id]: genreIds }))
    const verb = item.media_type === 'tv' ? 'ajoutée' : 'ajouté'
    pushNotice(`${MEDIA_TYPE_ICON[item.media_type]} « ${item.title} » ${verb} à ta liste`)
  }

  // The named, coloured themes to frame and label a row with: its full genre
  // set when known, otherwise a single one derived from the stored category.
  function itemThemes(item: Media): Theme[] {
    const ids = genresById[item.id]
    const themes = ids ? genreThemes(ids) : []
    if (themes.length > 0) return themes
    return [{ name: item.category ?? 'Autre', color: categoryColor(item.category) }]
  }

  function chooseUsername(name: string) {
    localStorage.setItem(USERNAME_STORAGE_KEY, name)
    setUsername(name)
  }

  if (!username) {
    return <NamePrompt onSubmit={chooseUsername} />
  }

  // Reading the selected row from the list keeps the detail page in sync
  // with realtime updates (e.g. someone marks it as seen).
  const noticeStack = notices.length > 0 && (
    <div className="notice-stack">
      {notices.map((notice) => (
        <div
          key={notice.id}
          className="notice"
          onClick={() => dismissNotice(notice.id)}
        >
          {notice.text}
        </div>
      ))}
    </div>
  )

  const selectedItem = media.find((m) => m.id === selectedId)
  if (selectedItem) {
    return (
      <>
        {noticeStack}
        <MediaDetail
          item={selectedItem}
          seenBy={seenBy[selectedItem.id] ?? []}
          onBack={() => setSelectedId(null)}
        />
      </>
    )
  }

  if (showStats) {
    return (
      <>
        {noticeStack}
        <StatsView
          media={media}
          seenBy={seenBy}
          profiles={profiles}
          username={username}
          onBack={() => setShowStats(false)}
          onOpen={setSelectedId}
        />
      </>
    )
  }

  const pickerItem = media.find((m) => m.id === seenPickerId)

  // The tabs are personal: a title is "seen" only if MY profile has seen it,
  // even when others already have.
  const seenByMe = (item: Media) => (seenBy[item.id] ?? []).includes(username)

  // Sizes of the two lists, shown on the selector itself. Not scoped to the
  // À voir / Vus tab: the selector sits above it in the hierarchy.
  const movieCount = media.filter((m) => m.media_type === 'movie').length
  const seriesCount = media.length - movieCount

  const typeMedia = media.filter((m) => m.media_type === mediaTypeTab)
  const visibleMedia = typeMedia.filter((m) =>
    tab === 'seen' ? seenByMe(m) : !seenByMe(m)
  )

  // Make a row visible wherever it sits: switch to its list and tab, clear both
  // filters (it may have been added by someone else), then let the effect
  // scroll to it. Missing any of these leaves us scrolling to a hidden card.
  function revealItem(item: Media) {
    setMediaTypeTab(item.media_type)
    setTab(seenByMe(item) ? 'seen' : 'toWatch')
    setCategoryFilters(new Set())
    setAddedByFilters(new Set())
    setHighlight({ id: item.id })
  }

  const toWatchCount = typeMedia.filter((m) => !seenByMe(m)).length
  const seenCount = typeMedia.length - toWatchCount

  // Who added what, counted over the current tab only — so the pills and their
  // counts stay stable while the category filter narrows the list below.
  const adderCounts = new Map<string, number>()
  for (const item of visibleMedia) {
    adderCounts.set(item.added_by, (adderCounts.get(item.added_by) ?? 0) + 1)
  }
  const sortedAdders = [...adderCounts.keys()].sort((a, b) => a.localeCompare(b, 'fr'))

  // Ignore any pick that isn't on offer in this tab, so a leftover selection
  // narrows nothing instead of emptying the list.
  const activeAdders = sortedAdders.filter((name) => addedByFilters.has(name))
  const activeAdderSet = new Set(activeAdders)
  const filteredMedia =
    activeAdders.length === 0
      ? visibleMedia
      : visibleMedia.filter((m) => activeAdderSet.has(m.added_by))

  // Group by category, alphabetical order, "Autre" always last.
  const categoryGroups = new Map<string, Media[]>()
  for (const item of filteredMedia) {
    const category = item.category ?? 'Autre'
    const group = categoryGroups.get(category)
    if (group) group.push(item)
    else categoryGroups.set(category, [item])
  }
  const sortedCategories = [...categoryGroups.keys()].sort((a, b) => {
    if (a === 'Autre') return 1
    if (b === 'Autre') return -1
    return a.localeCompare(b, 'fr')
  })

  // Same for themes: keep the list's own ordering and drop picks that vanished
  // from the current view (tab switch, realtime update, person filter...).
  const activeCategories = new Set(
    sortedCategories.filter((category) => categoryFilters.has(category))
  )
  const displayedCategories =
    activeCategories.size === 0
      ? sortedCategories
      : sortedCategories.filter((category) => activeCategories.has(category))

  const categoryOptions: FilterOption[] = sortedCategories.map((category) => ({
    value: category,
    count: categoryGroups.get(category)!.length,
    color: categoryColor(category),
  }))
  const adderOptions: FilterOption[] = sortedAdders.map((name) => ({
    value: name,
    count: adderCounts.get(name)!,
  }))

  // The very first card in the list demos the swipe gesture for new touch users.
  const hintItemId =
    swipeHint && displayedCategories.length > 0
      ? categoryGroups.get(displayedCategories[0])?.[0]?.id
      : undefined

  // "47 films à voir", "1 série vue": French agreement for the hero headline.
  const headlineCount = filteredMedia.length
  const many = headlineCount > 1
  const typeNoun =
    mediaTypeTab === 'tv' ? (many ? 'séries' : 'série') : many ? 'films' : 'film'
  const headlineNoun =
    tab === 'toWatch'
      ? `${typeNoun} à voir`
      : `${typeNoun} ${mediaTypeTab === 'tv' ? 'vue' : 'vu'}${many ? 's' : ''}`
  const headlineSub =
    tab === 'toWatch'
      ? `${seenCount} déjà ${seenCount > 1 ? 'vus' : 'vu'} sur ${typeMedia.length}`
      : `${toWatchCount} encore à voir sur ${typeMedia.length}`

  return (
    <div className="list-page">
      {noticeStack}
      <ListHero
        posters={posterWall(typeMedia)}
        count={headlineCount}
        noun={headlineNoun}
        sub={headlineSub}
        top={
          <div className="list-topbar">
          <span className="list-brand">👁️ Iris</span>
          <div className="list-actions">
            <button
              className="cine-pill"
              onClick={() => {
                window.scrollTo(0, 0)
                setShowStats(true)
              }}
              title="Voir les statistiques"
            >
              📊 Stats
            </button>
            <button
              className="cine-pill is-accent"
              onClick={() => setUsername('')}
              title="Changer de prénom"
            >
              {username}
            </button>
          </div>
          </div>
        }
      >
        <AddMediaForm
          username={username}
          media={media}
          isSeen={seenByMe}
          onAdded={handleAdded}
          onReveal={revealItem}
          onError={setError}
        />

        <Segmented
          options={[
            {
              value: 'movie',
              label: `${MEDIA_TYPE_ICON.movie} ${MEDIA_TYPE_PLURAL.movie}`,
              count: movieCount,
            },
            {
              value: 'tv',
              label: `${MEDIA_TYPE_ICON.tv} ${MEDIA_TYPE_PLURAL.tv}`,
              count: seriesCount,
            },
          ]}
          value={mediaTypeTab}
          onChange={setMediaTypeTab}
        />
      </ListHero>

      <div className="list-body">
        {error && (
          <div className="error-banner" onClick={() => setError('')}>
            {error} <span className="error-dismiss">(cliquer pour fermer)</span>
          </div>
        )}

        {/* One row: the status toggle and both filters, all scoped to the list
            chosen above. Wraps to a second line on narrow screens. */}
        <div className="control-row">
          <Segmented
            surface
            options={[
              { value: 'toWatch', label: 'À voir', count: toWatchCount },
              { value: 'seen', label: 'Vus', count: seenCount },
            ]}
            value={tab}
            onChange={(next) => {
              setTab(next)
              setCategoryFilters(new Set())
            }}
          />

          {categoryOptions.length > 1 && (
            <FilterSelect
              label="Thèmes"
              options={categoryOptions}
              selected={categoryFilters}
              onChange={setCategoryFilters}
            />
          )}
          {adderOptions.length > 1 && (
            <FilterSelect
              label="Ajouté par"
              options={adderOptions}
              selected={addedByFilters}
              onChange={setAddedByFilters}
            />
          )}
        </div>

        {loading ? (
          <p className="empty-state">Chargement…</p>
        ) : filteredMedia.length === 0 ? (
          <p className="empty-state">
            {activeAdders.length > 0
              ? `Rien d'ajouté par ${activeAdders.join(', ')} dans cette liste.`
              : tab === 'toWatch'
                ? MEDIA_EMPTY_TO_WATCH[mediaTypeTab]
                : MEDIA_EMPTY_SEEN[mediaTypeTab]}
          </p>
        ) : (
          displayedCategories.map((category) => (
            <Reveal key={category} className="category-section">
              <h2 className="category-title">
                <span
                  className="category-dot"
                  style={{ background: categoryColor(category === 'Autre' ? null : category) }}
                />
                {category}
                <span className="category-count">{categoryGroups.get(category)!.length}</span>
              </h2>
              <ul className="media-list">
                {categoryGroups.get(category)!.map((item, index) => (
                  <MediaCard
                    key={item.id}
                    item={item}
                    index={index}
                    seen={seenByMe(item)}
                    themes={itemThemes(item)}
                    hint={item.id === hintItemId}
                    highlight={item.id === highlight?.id}
                    onSeen={(m) => setSeenPickerId(m.id)}
                    onOpen={(m) => setSelectedId(m.id)}
                  />
                ))}
              </ul>
            </Reveal>
          ))
        )}
      </div>

      {pickerItem && (
        <SeenPicker
          item={pickerItem}
          profiles={profiles}
          initial={seenBy[pickerItem.id] ?? []}
          onClose={() => setSeenPickerId(null)}
          onSave={(selected) => saveSeen(pickerItem, selected)}
        />
      )}
    </div>
  )
}

export default App
