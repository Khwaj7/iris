import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode, RefObject } from 'react'
import type { Media } from './lib/supabase'
import type { MediaType } from './lib/media'
import { MEDIA_TYPE_ICON, MEDIA_TYPE_PLURAL } from './lib/media'
import { computeStats } from './lib/stats'
import type { Bucket, GenreStat, PersonStat } from './lib/stats'
import './StatsView.css'

type Scope = 'all' | MediaType

const TYPES: MediaType[] = ['movie', 'tv']

// Series colours for films vs séries, defined per theme in index.css
// (--series-movie / --series-tv) and validated as a colour-blind-safe pair.
const seriesColor = (type: MediaType) => `var(--series-${type})`

const percent = (share: number) => `${Math.round(share * 100)} %`

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// ---- Animation hooks ----

// True once the element has scrolled into view, and stays true: every reveal
// animation plays once. Without IntersectionObserver, or with reduced motion,
// everything is simply visible from the start.
function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined' || reducedMotion()
  )
  useEffect(() => {
    if (visible || !ref.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [visible])
  return [ref, visible]
}

// Counts up to `target` once `active`, easing out. A later change of target
// (switching Films / Séries) animates from the number currently shown.
function useCountUp(target: number, active: boolean, duration = 1100) {
  const [value, setValue] = useState(0)
  const shown = useRef(0)
  const still = reducedMotion()
  useEffect(() => {
    if (!active || still) return
    const from = shown.current
    const start = performance.now()
    let frame = 0
    const tick = (now: number) => {
      // A frame's timestamp can predate `start` by a hair; clamp so the first
      // frame never eases to a negative number ("-0").
      const t = Math.min(1, Math.max(0, (now - start) / duration))
      const next = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3)))
      shown.current = next
      setValue(next)
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, active, duration, still])
  // Reduced motion: no counting, just the number.
  return still ? target : value
}

// ---- Building blocks ----

// A block that fades and slides up when it enters the viewport. Children
// (bars, columns) key their own grow-in off the parent's .is-visible class.
function Reveal({
  as: Tag = 'section',
  className = '',
  delay = 0,
  children,
}: {
  as?: 'section' | 'div'
  className?: string
  delay?: number
  children: ReactNode
}) {
  const [ref, visible] = useInView<HTMLElement>()
  return (
    <Tag
      ref={ref as RefObject<HTMLElement & HTMLDivElement>}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ '--delay': `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  )
}

function Card({
  title,
  subtitle,
  wide,
  delay,
  children,
}: {
  title: string
  subtitle?: string
  wide?: boolean
  delay?: number
  children: ReactNode
}) {
  return (
    <Reveal className={wide ? 'sv-card is-wide' : 'sv-card'} delay={delay}>
      <header className="sv-card-head">
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </header>
      {children}
    </Reveal>
  )
}

function Counter({ value, active }: { value: number; active: boolean }) {
  return <>{useCountUp(value, active).toLocaleString('fr-FR')}</>
}

// Progress ring around a headline number; the arc draws itself on reveal.
function Ring({
  label,
  value,
  share,
  detail,
  active,
}: {
  label: string
  value: number
  share: number
  detail: string
  active: boolean
}) {
  const radius = 44
  const circumference = 2 * Math.PI * radius
  return (
    <div className="sv-ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="sv-ring-track" cx="50" cy="50" r={radius} />
        <circle
          className="sv-ring-arc"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={active ? circumference * (1 - share) : circumference}
        />
      </svg>
      <div className="sv-ring-center">
        <span className="sv-ring-value">
          <Counter value={value} active={active} />
        </span>
        <span className="sv-ring-percent">{detail}</span>
      </div>
      <span className="sv-ring-label">{label}</span>
    </div>
  )
}

function Legend() {
  return (
    <ul className="sv-legend">
      {TYPES.map((type) => (
        <li key={type}>
          <span className="sv-swatch" style={{ background: seriesColor(type) }} />
          {MEDIA_TYPE_PLURAL[type]}
        </li>
      ))}
    </ul>
  )
}

function Avatar({ name }: { name: string }) {
  // A stable hue per name, so each person keeps their colour everywhere.
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return (
    <span className="sv-avatar" style={{ '--hue': hash } as CSSProperties} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}

function TypeSplitBar({ counts, total }: { counts: Record<MediaType, number>; total: number }) {
  return (
    <div className="sv-split">
      <div className="sv-split-bar">
        {TYPES.filter((type) => counts[type] > 0).map((type) => (
          <span
            key={type}
            style={{ flexGrow: counts[type], background: seriesColor(type) }}
            title={`${MEDIA_TYPE_PLURAL[type]} : ${counts[type]}`}
          />
        ))}
      </div>
      <ul className="sv-split-labels">
        {TYPES.map((type) => (
          <li key={type}>
            <span className="sv-swatch" style={{ background: seriesColor(type) }} />
            {MEDIA_TYPE_ICON[type]} {MEDIA_TYPE_PLURAL[type]}
            <strong>{counts[type].toLocaleString('fr-FR')}</strong>
            <span className="sv-muted">{total ? percent(counts[type] / total) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

type BarRow = {
  key: string
  label: ReactNode
  value: number
  valueText?: string
  color?: string
  fill: number
}

// Horizontal bars, label and value above each: reads well at phone width. The
// fills grow in one after another when the card is revealed.
function BarList({ rows, ranked }: { rows: BarRow[]; ranked?: boolean }) {
  return (
    <ol className={ranked ? 'sv-bars is-ranked' : 'sv-bars'}>
      {rows.map((row, i) => (
        <li key={row.key} style={{ '--i': i } as CSSProperties}>
          {ranked && <span className="sv-rank">{i + 1}</span>}
          <div className="sv-bar-body">
            <div className="sv-bar-head">
              <span className="sv-bar-label">{row.label}</span>
              <span className="sv-bar-value">{row.valueText ?? row.value.toLocaleString('fr-FR')}</span>
            </div>
            <span className="sv-bar-track">
              <span
                className="sv-bar-fill"
                style={{
                  width: `${Math.max(row.fill * 100, row.value > 0 ? 2 : 0)}%`,
                  background: row.color,
                }}
              />
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}

function GenreChart({ genres }: { genres: GenreStat[] }) {
  const max = Math.max(1, ...genres.map((g) => g.count))
  return (
    <BarList
      ranked
      rows={genres.map((g) => ({
        key: g.name,
        label: (
          <>
            <span className="sv-swatch" style={{ background: g.color }} />
            {g.name}
          </>
        ),
        value: g.count,
        color: g.color,
        fill: g.count / max,
      }))}
    />
  )
}

function personLabel(person: PersonStat, username: string) {
  return (
    <>
      <Avatar name={person.name} />
      {person.name}
      {person.name === username && <span className="sv-you">toi</span>}
    </>
  )
}

// Vertical columns over an ordered axis (decades, months), stacked by type
// when both are in scope. Columns rise one after another on reveal; each is
// focusable so its tooltip also opens on tap and from the keyboard.
function ColumnChart({ buckets, stacked }: { buckets: Bucket[]; stacked: boolean }) {
  const max = Math.max(1, ...buckets.map((b) => b.total))
  // With many columns, every other label is "minor" and hidden on narrow
  // screens so they never collide. Counted from the end, so the latest bucket
  // (the current month) always keeps its label.
  const isMinor = (i: number) => buckets.length > 8 && (buckets.length - 1 - i) % 2 === 1
  return (
    <div className="sv-columns-wrap">
      <span className="sv-columns-max">{max}</span>
      <div className="sv-columns" style={{ '--cols': buckets.length } as CSSProperties}>
        {buckets.map((bucket, i) => {
          const parts = TYPES.filter((type) => bucket.counts[type] > 0)
          const tip = [
            bucket.fullLabel,
            plural(bucket.total, 'titre', 'titres'),
            stacked && bucket.total > 0
              ? TYPES.map((t) => `${MEDIA_TYPE_ICON[t]} ${bucket.counts[t]}`).join('  ')
              : null,
          ]
            .filter(Boolean)
            .join('\n')
          const align = i < 2 ? 'is-start' : i >= buckets.length - 2 ? 'is-end' : ''
          return (
            <div
              key={bucket.key}
              className={`sv-col ${align}`}
              tabIndex={0}
              data-tip={tip}
              aria-label={tip.replace(/\n/g, ', ')}
              style={{ '--i': i } as CSSProperties}
            >
              <div className="sv-col-plot">
                <div className="sv-col-stack" style={{ height: `${(bucket.total / max) * 100}%` }}>
                  {(stacked ? parts : parts.slice(0, 1)).map((type) => (
                    <span
                      key={type}
                      style={{
                        flexGrow: stacked ? bucket.counts[type] : 1,
                        background: stacked ? seriesColor(type) : 'var(--accent)',
                      }}
                    />
                  ))}
                </div>
              </div>
              <span className={isMinor(i) ? 'sv-col-label is-minor' : 'sv-col-label'}>
                {bucket.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const ROW_LIMIT = 40

// A horizontally scrolling row of posters. Arrow buttons page through it on
// devices with a pointer; touch users just swipe.
function PosterRow({
  title,
  subtitle,
  items,
  empty,
  onOpen,
}: {
  title: string
  subtitle: string
  items: Media[]
  empty: string
  onOpen: (id: string) => void
}) {
  const scroller = useRef<HTMLUListElement>(null)
  const [edges, setEdges] = useState({ start: true, end: false })

  function updateEdges() {
    const el = scroller.current
    if (!el) return
    setEdges({
      start: el.scrollLeft <= 4,
      end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
    })
  }

  useEffect(updateEdges, [items])

  function page(direction: 1 | -1) {
    const el = scroller.current
    if (!el) return
    el.scrollBy({
      left: direction * el.clientWidth * 0.85,
      behavior: reducedMotion() ? 'auto' : 'smooth',
    })
  }

  return (
    <Reveal className="sv-row">
      <header className="sv-row-head">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </header>
      {items.length === 0 ? (
        <p className="sv-empty">{empty}</p>
      ) : (
        <div className="sv-row-frame">
          {!edges.start && (
            <button className="sv-row-arrow is-prev" onClick={() => page(-1)} aria-label="Précédents">
              ‹
            </button>
          )}
          <ul className="sv-row-track" ref={scroller} onScroll={updateEdges}>
            {items.slice(0, ROW_LIMIT).map((item, i) => (
              <li key={item.id} style={{ '--i': Math.min(i, 10) } as CSSProperties}>
                <button className="sv-poster" onClick={() => onOpen(item.id)} title={item.title}>
                  {item.thumbnail_url ? (
                    <img src={item.thumbnail_url} alt="" loading="lazy" />
                  ) : (
                    <span className="sv-poster-fallback">{MEDIA_TYPE_ICON[item.media_type]}</span>
                  )}
                  <span className="sv-poster-caption">
                    <span className="sv-poster-title">{item.title}</span>
                    {item.year && <span className="sv-poster-year">{item.year}</span>}
                  </span>
                </button>
              </li>
            ))}
            {items.length > ROW_LIMIT && (
              <li className="sv-row-more">+{items.length - ROW_LIMIT}</li>
            )}
          </ul>
          {!edges.end && (
            <button className="sv-row-arrow is-next" onClick={() => page(1)} aria-label="Suivants">
              ›
            </button>
          )}
        </div>
      )}
    </Reveal>
  )
}

function Spotlight({
  label,
  item,
  detail,
  delay,
  onOpen,
}: {
  label: string
  item: Media | null
  detail: (item: Media) => string
  delay: number
  onOpen: (id: string) => void
}) {
  if (!item) return null
  return (
    <Reveal as="div" delay={delay} className="sv-spot-wrap">
      <button className="sv-spot" onClick={() => onOpen(item.id)}>
        {item.thumbnail_url && (
          <span
            className="sv-spot-backdrop"
            style={{ backgroundImage: `url("${item.thumbnail_url}")` }}
            aria-hidden="true"
          />
        )}
        {item.thumbnail_url ? (
          <img className="sv-spot-poster" src={item.thumbnail_url} alt="" />
        ) : (
          <span className="sv-spot-poster sv-poster-fallback">{MEDIA_TYPE_ICON[item.media_type]}</span>
        )}
        <span className="sv-spot-text">
          <span className="sv-eyebrow">{label}</span>
          <span className="sv-spot-title">{item.title}</span>
          <span className="sv-spot-detail">{detail(item)}</span>
        </span>
      </button>
    </Reveal>
  )
}

const addedOn = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

const HERO_POSTERS = 24

export default function StatsView({
  media,
  seenBy,
  profiles,
  username,
  onBack,
  onOpen,
}: {
  media: Media[]
  seenBy: Record<string, string[]>
  profiles: string[]
  username: string
  onBack: () => void
  onOpen: (id: string) => void
}) {
  const [scope, setScope] = useState<Scope>('all')
  const [heroRef, heroVisible] = useInView<HTMLDivElement>()

  const scoped = useMemo(
    () => (scope === 'all' ? media : media.filter((m) => m.media_type === scope)),
    [media, scope]
  )
  const stats = useMemo(
    () => computeStats(scoped, seenBy, profiles, username),
    [scoped, seenBy, profiles, username]
  )
  // The hero wall: the latest posters, whatever the scope, so it doesn't
  // reshuffle on every filter change.
  const wall = useMemo(
    () =>
      [...media]
        .filter((m) => m.thumbnail_url)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, HERO_POSTERS),
    [media]
  )

  const stacked = scope === 'all'
  const me = stats.people.find((p) => p.name === username)
  const share = (n: number) => (stats.total ? n / stats.total : 0)

  const scopes: { value: Scope; label: string; count: number }[] = [
    { value: 'all', label: 'Tout', count: media.length },
    { value: 'movie', label: `${MEDIA_TYPE_ICON.movie} Films`, count: media.filter((m) => m.media_type === 'movie').length },
    { value: 'tv', label: `${MEDIA_TYPE_ICON.tv} Séries`, count: media.filter((m) => m.media_type === 'tv').length },
  ]
  const scopeIndex = scopes.findIndex((s) => s.value === scope)

  const adders = [...stats.people]
    .filter((p) => p.added > 0)
    .sort((a, b) => b.added - a.added || a.name.localeCompare(b.name, 'fr'))

  return (
    <div className="sv">
      <div className="sv-hero" ref={heroRef}>
        <div className="sv-hero-wall" aria-hidden="true">
          {wall.map((m, i) => (
            <img key={m.id} src={m.thumbnail_url!} alt="" style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
        <div className="sv-hero-shade" />
        <div className="sv-hero-content">
          <button className="sv-back" onClick={onBack}>
            ← Retour à la liste
          </button>
          <span className="sv-eyebrow">📊 Statistiques</span>
          <h1 className="sv-hero-title">
            <Counter value={stats.total} active={heroVisible} />{' '}
            <span>{stats.total > 1 ? 'titres' : 'titre'}</span>
          </h1>
          <p className="sv-hero-sub">
            {plural(stats.byType.movie, 'film', 'films')} · {plural(stats.byType.tv, 'série', 'séries')}
            {me && ` · tu en as vu ${percent(me.seenShare)}`}
          </p>

          <nav
            className="sv-scope"
            style={{ '--index': scopeIndex, '--count': scopes.length } as CSSProperties}
          >
            <span className="sv-scope-thumb" aria-hidden="true" />
            {scopes.map((s) => (
              <button
                key={s.value}
                className={scope === s.value ? 'active' : undefined}
                onClick={() => setScope(s.value)}
              >
                {s.label}
                <span className="sv-scope-count">{s.count}</span>
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="sv-body">
        {stats.total === 0 ? (
          <p className="empty-state">Rien à compter pour l'instant : ajoute des titres !</p>
        ) : (
          <>
            <Reveal as="div" className="sv-rings">
              <Ring
                label="Vus par toi"
                value={stats.seenByMe}
                share={share(stats.seenByMe)}
                detail={percent(share(stats.seenByMe))}
                active={heroVisible}
              />
              <Ring
                label="À voir pour toi"
                value={stats.toWatchForMe}
                share={share(stats.toWatchForMe)}
                detail={percent(share(stats.toWatchForMe))}
                active={heroVisible}
              />
              <Ring
                label="Vus par quelqu'un"
                value={stats.seenByAnyone}
                share={share(stats.seenByAnyone)}
                detail={percent(share(stats.seenByAnyone))}
                active={heroVisible}
              />
            </Reveal>

            <div className="sv-spots">
              <Spotlight
                label="Le doyen"
                item={stats.oldest}
                detail={(m) => `${m.media_type === 'tv' ? 'Sortie' : 'Sorti'} en ${m.year}`}
                delay={0}
                onOpen={onOpen}
              />
              <Spotlight
                label="Le plus récent"
                item={stats.newest}
                detail={(m) => `${m.media_type === 'tv' ? 'Sortie' : 'Sorti'} en ${m.year}`}
                delay={120}
                onOpen={onOpen}
              />
              <Spotlight
                label="Dernier ajouté"
                item={stats.lastAdded}
                detail={(m) => `Par ${m.added_by}, le ${addedOn.format(new Date(m.created_at))}`}
                delay={240}
                onOpen={onOpen}
              />
            </div>

            <PosterRow
              title="Vus par tout le monde"
              subtitle={`${plural(stats.seenByEveryone.length, 'titre', 'titres')} vus par les ${plural(profiles.length, 'profil', 'profils')}`}
              items={stats.seenByEveryone}
              empty="Aucun titre n'a encore été vu par tout le monde."
              onOpen={onOpen}
            />
            <PosterRow
              title="Personne ne les a vus"
              subtitle={plural(stats.seenByNobody.length, 'titre qui attend son public', 'titres qui attendent leur public')}
              items={stats.seenByNobody}
              empty="Tout a été vu par au moins une personne. Bravo !"
              onOpen={onOpen}
            />

            <div className="sv-grid">
              {stacked && (
                <Card title="Films et séries" wide>
                  <TypeSplitBar counts={stats.byType} total={stats.total} />
                </Card>
              )}

              <Card title="Top genres" subtitle="Genre principal de chaque titre">
                <GenreChart genres={stats.genres} />
              </Card>

              <Card
                title="Qui a vu quoi"
                subtitle={me ? `Toi : ${percent(me.seenShare)} de la liste` : 'Part de la liste vue par chacun'}
                delay={100}
              >
                <BarList
                  rows={stats.people.map((p) => ({
                    key: p.name,
                    label: personLabel(p, username),
                    value: p.seen,
                    valueText: `${p.seen.toLocaleString('fr-FR')} · ${percent(p.seenShare)}`,
                    fill: p.seenShare,
                  }))}
                />
              </Card>

              <Card title="Qui ajoute quoi" subtitle="Titres ajoutés par chacun">
                <BarList
                  rows={adders.map((p) => ({
                    key: p.name,
                    label: personLabel(p, username),
                    value: p.added,
                    valueText: `${p.added.toLocaleString('fr-FR')} · ${percent(share(p.added))}`,
                    fill: p.added / Math.max(1, adders[0]?.added ?? 1),
                  }))}
                />
              </Card>

              <Card
                title="Par décennie"
                subtitle={
                  stats.undated > 0
                    ? `Année de sortie · ${plural(stats.undated, 'titre', 'titres')} sans année`
                    : 'Année de sortie'
                }
                delay={100}
              >
                {stats.decades.length > 0 ? (
                  <>
                    {stacked && <Legend />}
                    <ColumnChart buckets={stats.decades} stacked={stacked} />
                  </>
                ) : (
                  <p className="sv-empty">Aucune année de sortie connue.</p>
                )}
              </Card>

              <Card title="Activité" subtitle="Titres ajoutés ces 12 derniers mois" wide>
                {stacked && <Legend />}
                <ColumnChart buckets={stats.months} stacked={stacked} />
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
