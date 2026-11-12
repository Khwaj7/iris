import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import type { Media } from './lib/supabase'
import { supabase } from './lib/supabase'
import { MEDIA_TYPE_ICON } from './lib/media'
import { ADMIN_CODE, deleteProfile, mergeProfile } from './lib/admin'
import { LAST_SEEN_SQL } from './lib/profiles'
import { computeProfileInsights } from './lib/profileInsights'
import type { DatedMedia, ProfileInsights } from './lib/profileInsights'
import type { RemovalMode } from './lib/admin'
import { Avatar, CinemaHero, Counter, Reveal } from './cinema'
import { posterWall, useInView } from './motion'
import './AdminView.css'

// Remembers on this device that the right code was typed. Storing the code
// itself means changing VITE_ADMIN_CODE locks every device out again.
const ADMIN_UNLOCK_KEY = 'iris-admin-code'

export type ProfileChange = { name: string; mode: RemovalMode; into?: string }

type ProfileRow = {
  name: string
  createdAt: string | null
  // Last time the app was opened under this name (profiles.last_seen_at).
  lastSeen: string | null
  added: number
  seen: number
  // Another profile whose name differs only by case or accents: a likely
  // duplicate, and the default merge target.
  twin: string | null
  insights: ProfileInsights
}

const fold = (name: string) =>
  name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()

const since = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

const RECENT_LIMIT = 5

const relative = new Intl.RelativeTimeFormat('fr-FR', { numeric: 'auto' })
const DAY_MS = 24 * 60 * 60 * 1000

// "à l'instant", "il y a 12 minutes", "hier", "il y a 5 jours", then a date.
function lastSeenLabel(iso: string, now: number) {
  const elapsed = Math.max(0, now - new Date(iso).getTime())
  const minutes = Math.round(elapsed / 60000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return relative.format(-minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (hours < 24) return relative.format(-hours, 'hour')
  const days = Math.round(elapsed / DAY_MS)
  if (days < 30) return relative.format(-days, 'day')
  return `le ${since.format(new Date(iso))}`
}

const plural = (n: number, one: string, many: string) =>
  `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`

function readUnlocked() {
  try {
    return !!ADMIN_CODE && localStorage.getItem(ADMIN_UNLOCK_KEY) === ADMIN_CODE
  } catch {
    return false
  }
}

function Lock({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('')
  const [wrong, setWrong] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    if (code === ADMIN_CODE) {
      try {
        localStorage.setItem(ADMIN_UNLOCK_KEY, code)
      } catch {
        // Private mode: unlocked for this visit only.
      }
      onUnlock()
    } else {
      setWrong(true)
    }
  }

  if (!ADMIN_CODE) {
    // Setup instructions only for the developer running it locally; visitors
    // of a deployed build just learn that the panel is off there.
    return import.meta.env.DEV ? (
      <p className="adm-lock-note">
        Aucun code admin n'est défini. Ajoute <code>VITE_ADMIN_CODE=…</code> dans{' '}
        <code>.env.local</code>, puis relance le serveur.
      </p>
    ) : (
      <p className="adm-lock-note">Le panel admin n'est pas configuré sur ce déploiement.</p>
    )
  }

  return (
    <form className={wrong ? 'adm-lock is-wrong' : 'adm-lock'} onSubmit={submit}>
      <input
        autoFocus
        type="password"
        value={code}
        onChange={(e) => {
          setCode(e.target.value)
          setWrong(false)
        }}
        placeholder="Code admin"
        aria-label="Code admin"
        autoComplete="off"
      />
      <button type="submit" className="cine-pill is-accent" disabled={!code}>
        Déverrouiller
      </button>
      {wrong && <p className="adm-lock-error">Mauvais code.</p>}
    </form>
  )
}

const split = (counts: { movie: number; tv: number }) =>
  `${MEDIA_TYPE_ICON.movie} ${counts.movie} · ${MEDIA_TYPE_ICON.tv} ${counts.tv}`

function TitleAt({ entry, now }: { entry: DatedMedia; now: number }) {
  return (
    <>
      <span className="adm-fact-title">
        {entry.item.title}
        {entry.item.year && <span className="media-year"> ({entry.item.year})</span>}
      </span>
      <span className="adm-fact-date"> · {lastSeenLabel(entry.at, now)}</span>
    </>
  )
}

// The per-profile numbers and facts under each card's header.
function ProfileDetails({ insights: p, now }: { insights: ProfileInsights; now: number }) {
  const percent = Math.round(p.seenShare * 100)
  const facts: { label: string; value: ReactNode }[] = []

  if (p.favouriteGenre) {
    facts.push({
      label: 'Genre préféré',
      value: (
        <span className="adm-genre" style={{ '--genre': p.favouriteGenre.color } as CSSProperties}>
          {p.favouriteGenre.name}
          <span className="adm-fact-date"> · {p.favouriteGenre.count}</span>
        </span>
      ),
    })
  }
  if (p.lastSeen) facts.push({ label: 'Dernier vu', value: <TitleAt entry={p.lastSeen} now={now} /> })
  if (p.lastAdded) facts.push({ label: 'Dernier ajout', value: <TitleAt entry={p.lastAdded} now={now} /> })
  if (p.firstAdded && p.added.total > 1) {
    facts.push({ label: 'Premier ajout', value: <TitleAt entry={p.firstAdded} now={now} /> })
  }
  if (p.added.total > 0) {
    facts.push({
      label: 'Ses ajouts vus',
      value: `${p.addedSeenByOthers} sur ${p.added.total} par quelqu’un d’autre`,
    })
  }
  if (p.seen.total > 0) {
    facts.push({
      label: 'Vus en solo',
      value: p.seenAlone > 0 ? plural(p.seenAlone, 'titre que personne d’autre n’a vu', 'titres que personne d’autre n’a vus') : 'aucun',
    })
  }
  if (p.closest) {
    facts.push({
      label: 'Goûts proches',
      value: `${p.closest.name} · ${plural(p.closest.common, 'vu en commun', 'vus en commun')}`,
    })
  }
  if (p.lastActivity) {
    facts.push({ label: 'Dernière activité', value: lastSeenLabel(p.lastActivity, now) })
  }

  return (
    <div className="adm-details">
      <div className="adm-stats">
        <div className="adm-stat">
          <strong>{p.added.total}</strong>
          <span>{p.added.total > 1 ? 'ajouts' : 'ajout'}</span>
          <small>{split(p.added)}</small>
        </div>
        <div className="adm-stat">
          <strong>{p.seen.total}</strong>
          <span>{p.seen.total > 1 ? 'vus' : 'vu'}</span>
          <small>{split(p.seen)}</small>
        </div>
        <div className="adm-stat">
          <strong>{p.toWatch}</strong>
          <span>à voir</span>
          <small>
            <span className="adm-progress" aria-hidden="true">
              <span style={{ width: `${percent}%` }} />
            </span>
            {percent} % vus
          </small>
        </div>
      </div>
      {facts.length > 0 && (
        <dl className="adm-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}

function ManageModal({
  row,
  others,
  media,
  seenBy,
  username,
  onClose,
  onDone,
}: {
  row: ProfileRow
  others: string[]
  media: Media[]
  seenBy: Record<string, string[]>
  username: string
  onClose: () => void
  onDone: (change: ProfileChange) => void
}) {
  const [mode, setMode] = useState<RemovalMode>(row.twin ? 'merge' : 'deleteSeen')
  const [into, setInto] = useState(row.twin ?? others[0] ?? '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')

  useEffect(() => {
    if (busy) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [busy, onClose])

  // Shown under "Supprimer le profil et ses vus": the titles that stay in
  // the list under this name, newest first.
  const recentAdded = media
    .filter((m) => m.added_by === row.name)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, RECENT_LIMIT)

  const canMerge = others.length > 0
  const effectiveMode = mode === 'merge' && !canMerge ? 'deleteSeen' : mode

  async function apply() {
    setBusy(true)
    setFailure('')
    try {
      if (effectiveMode === 'merge') await mergeProfile(row.name, into, seenBy)
      else await deleteProfile(row.name, media, seenBy, effectiveMode === 'deleteAll')
      onDone({ name: row.name, mode: effectiveMode, into: effectiveMode === 'merge' ? into : undefined })
    } catch (err) {
      setFailure((err as Error).message)
      setBusy(false)
    }
  }

  const options: { value: RemovalMode; title: string; detail: string; disabled?: boolean }[] = [
    {
      value: 'merge',
      title: 'Fusionner avec un autre profil',
      detail: canMerge
        ? `Ses ${plural(row.seen, 'vu', 'vus')} et ${plural(row.added, 'ajout', 'ajouts')} passent à ${into || '…'}, puis « ${row.name} » disparaît.`
        : 'Aucun autre profil vers lequel fusionner.',
      disabled: !canMerge,
    },
    {
      value: 'deleteSeen',
      title: 'Supprimer le profil et ses vus',
      detail:
        row.added > 0
          ? `Ses ${plural(row.added, 'titre ajouté reste', 'titres ajoutés restent')} dans la liste, signés « ${row.name} ».`
          : 'Il n’a ajouté aucun titre.',
    },
    {
      value: 'deleteAll',
      title: 'Supprimer le profil, ses vus et ses ajouts',
      detail:
        row.added > 0
          ? `${plural(row.added, 'titre disparaît', 'titres disparaissent')} de la liste pour tout le monde.`
          : 'Il n’a ajouté aucun titre : revient au choix précédent.',
    },
  ]

  const confirmLabel =
    effectiveMode === 'merge'
      ? `Fusionner dans ${into}`
      : effectiveMode === 'deleteAll'
        ? 'Tout supprimer'
        : 'Supprimer le profil'

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onClose}>
      <div className="modal adm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="adm-modal-head">
          <Avatar name={row.name} />
          <div>
            <h2>Gérer « {row.name} »</h2>
            <p className="modal-subtitle">
              {plural(row.added, 'titre ajouté', 'titres ajoutés')} ·{' '}
              {plural(row.seen, 'titre vu', 'titres vus')}
            </p>
          </div>
        </div>

        <div className="adm-options" role="radiogroup">
          {options.map((option) => (
            <label
              key={option.value}
              className={[
                'adm-option',
                effectiveMode === option.value && 'is-selected',
                option.value !== 'merge' && 'is-danger',
                option.disabled && 'is-disabled',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <input
                type="radio"
                name="mode"
                value={option.value}
                checked={effectiveMode === option.value}
                disabled={option.disabled || busy}
                onChange={() => setMode(option.value)}
              />
              <span className="adm-option-text">
                <span className="adm-option-title">{option.title}</span>
                <span className="adm-option-detail">{option.detail}</span>
                {option.value === 'deleteSeen' && effectiveMode === 'deleteSeen' && recentAdded.length > 0 && (
                  <div className="adm-recent">
                    <span className="adm-recent-label">
                      {row.added > RECENT_LIMIT ? `Ses ${RECENT_LIMIT} derniers ajouts` : 'Ses ajouts'}
                    </span>
                    <ul>
                      {recentAdded.map((item) => (
                        <li key={item.id}>
                          {item.thumbnail_url ? (
                            <img src={item.thumbnail_url} alt="" />
                          ) : (
                            <span className="adm-recent-poster poster-placeholder">
                              {MEDIA_TYPE_ICON[item.media_type]}
                            </span>
                          )}
                          <span className="adm-recent-title">
                            {item.title}
                            {item.year && <span className="media-year"> ({item.year})</span>}
                          </span>
                          <span className="adm-recent-date">{shortDate.format(new Date(item.created_at))}</span>
                        </li>
                      ))}
                    </ul>
                    {row.added > RECENT_LIMIT && (
                      <span className="adm-recent-more">et {row.added - RECENT_LIMIT} autres</span>
                    )}
                  </div>
                )}
                {option.value === 'merge' && canMerge && effectiveMode === 'merge' && (
                  <select
                    className="adm-select"
                    value={into}
                    disabled={busy}
                    onChange={(e) => setInto(e.target.value)}
                  >
                    {others.map((name) => (
                      <option key={name} value={name}>
                        {name}
                        {name === row.twin ? ' (doublon probable)' : ''}
                      </option>
                    ))}
                  </select>
                )}
              </span>
            </label>
          ))}
        </div>

        {row.name === username && (
          <p className="adm-warning">
            C’est ton profil actuel :{' '}
            {effectiveMode === 'merge'
              ? `tu continueras sous le nom « ${into} ».`
              : 'tu devras choisir un nouveau prénom.'}
          </p>
        )}
        {failure && <p className="adm-failure">{failure}</p>}

        <div className="modal-actions">
          <button className="modal-cancel" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          <button
            className={effectiveMode === 'merge' ? 'modal-save' : 'modal-save adm-danger'}
            onClick={apply}
            disabled={busy || (effectiveMode === 'merge' && !into)}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function AdminView({
  media,
  seenBy,
  profiles,
  username,
  onBack,
  onChanged,
}: {
  media: Media[]
  seenBy: Record<string, string[]>
  profiles: string[]
  username: string
  onBack: () => void
  onChanged: (change: ProfileChange) => void
}) {
  const [unlocked, setUnlocked] = useState(readUnlocked)
  const [managing, setManaging] = useState<string | null>(null)
  const [details, setDetails] = useState<
    Record<string, { createdAt: string | null; lastSeen: string | null }>
  >({})
  // False until the dashboard has the last_seen_at column (see LAST_SEEN_SQL).
  const [hasLastSeen, setHasLastSeen] = useState(true)
  // media id -> profile name -> when it was marked seen (seen.created_at).
  const [seenAt, setSeenAt] = useState<Record<string, Record<string, string>>>({})
  const [now, setNow] = useState(() => Date.now())
  const [heroRef, heroVisible] = useInView<HTMLDivElement>()

  // Sign-up and last-connection dates are only needed here, so they're
  // fetched here rather than kept in App with the rest. `*` rather than named
  // columns, so this still works before last_seen_at exists.
  useEffect(() => {
    if (!unlocked) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('*')
      .then(({ data }) => {
        if (cancelled || !data) return
        setHasLastSeen(data.length === 0 || 'last_seen_at' in data[0])
        setNow(Date.now())
        setDetails(
          Object.fromEntries(
            data.map((p) => [
              p.name as string,
              {
                createdAt: (p.created_at as string | null) ?? null,
                lastSeen: (p.last_seen_at as string | null | undefined) ?? null,
              },
            ])
          )
        )
      })
    return () => {
      cancelled = true
    }
  }, [unlocked, profiles])

  // When each title was marked seen, for "Dernier vu". App only keeps who saw
  // what; `*` so a missing created_at column just leaves the dates out.
  useEffect(() => {
    if (!unlocked) return
    let cancelled = false
    supabase
      .from('seen')
      .select('*')
      .then(({ data }) => {
        if (cancelled || !data) return
        const map: Record<string, Record<string, string>> = {}
        for (const row of data) {
          const at = row.created_at as string | undefined
          if (at) (map[row.media_id as string] ??= {})[row.profile_name as string] = at
        }
        setSeenAt(map)
      })
    return () => {
      cancelled = true
    }
  }, [unlocked, seenBy])

  // Keep "il y a 3 minutes" current while the panel stays open.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(timer)
  }, [])

  const rows = useMemo<ProfileRow[]>(() => {
    const seenCounts = new Map<string, number>()
    for (const names of Object.values(seenBy)) {
      for (const name of names) seenCounts.set(name, (seenCounts.get(name) ?? 0) + 1)
    }
    return profiles.map((name) => {
      const twins = profiles.filter((other) => other !== name && fold(other) === fold(name))
      // Only the lesser of a pair is flagged, pointing at the twin that has
      // done the most, so merging keeps the "main" account. Ties go by name.
      const score = (n: string) => (seenCounts.get(n) ?? 0) + media.filter((m) => m.added_by === n).length
      const main = [name, ...twins].sort((a, b) => score(b) - score(a) || a.localeCompare(b))[0]
      const twin = main === name ? null : main
      return {
        name,
        createdAt: details[name]?.createdAt ?? null,
        lastSeen: details[name]?.lastSeen ?? null,
        added: media.filter((m) => m.added_by === name).length,
        seen: seenCounts.get(name) ?? 0,
        twin,
        insights: computeProfileInsights(
          name,
          media,
          seenBy,
          profiles,
          seenAt,
          details[name]?.lastSeen ?? null
        ),
      }
    })
  }, [profiles, media, seenBy, details, seenAt])

  const duplicates = rows.filter((r) => r.twin).length
  const managed = rows.find((r) => r.name === managing)

  return (
    <div className="adm">
      <CinemaHero posters={posterWall(media)} heroRef={heroRef} width="960px">
        <div className="adm-topbar">
          <button className="cine-pill" onClick={onBack}>
            ← Retour à la liste
          </button>
          {unlocked && (
            <button
              className="cine-pill"
              onClick={() => {
                try {
                  localStorage.removeItem(ADMIN_UNLOCK_KEY)
                } catch {
                  // Nothing stored to clear.
                }
                setUnlocked(false)
              }}
            >
              🔒 Verrouiller
            </button>
          )}
        </div>
        <span className="cine-eyebrow">⚙️ Administration</span>
        {unlocked ? (
          <>
            <h1 className="cine-hero-title adm-title">
              <Counter value={profiles.length} active={heroVisible} />{' '}
              <span>{profiles.length > 1 ? 'profils' : 'profil'}</span>
            </h1>
            <p className="cine-hero-sub">
              {duplicates > 0
                ? `${plural(duplicates, 'doublon probable', 'doublons probables')} à vérifier`
                : 'Aucun doublon repéré'}
            </p>
          </>
        ) : (
          <>
            <h1 className="cine-hero-title adm-title">
              Accès <span>réservé</span>
            </h1>
            <p className="cine-hero-sub">Entre le code admin pour gérer les profils.</p>
            <Lock onUnlock={() => setUnlocked(true)} />
          </>
        )}
      </CinemaHero>

      {unlocked && (
        <div className="adm-body">
          {!hasLastSeen && (
            <div className="adm-setup">
              <strong>Dernière connexion : une étape dans Supabase</strong>
              <p>
                Pour enregistrer la dernière connexion de chaque compte, exécute une fois cette
                ligne dans le dashboard Supabase (SQL Editor) :
              </p>
              <code>{LAST_SEEN_SQL}</code>
            </div>
          )}
          <ul className="adm-list">
            {rows.map((row, i) => (
              <li key={row.name} style={{ '--i': Math.min(i, 10) } as CSSProperties}>
                <Reveal as="div" className="adm-card" delay={Math.min(i, 10) * 50}>
                  <div className="adm-card-head">
                    <Avatar name={row.name} />
                    <div className="adm-card-text">
                      <span className="adm-card-name">
                        {row.name}
                        {row.name === username && <span className="adm-chip is-you">toi</span>}
                        {row.twin && <span className="adm-chip is-twin">doublon de {row.twin} ?</span>}
                      </span>
                      <span className="adm-card-meta">
                        {row.createdAt
                          ? `Membre depuis le ${since.format(new Date(row.createdAt))}`
                          : 'Date d’inscription inconnue'}
                      </span>
                      {hasLastSeen && (
                        <span
                          className={
                            row.lastSeen && now - new Date(row.lastSeen).getTime() < DAY_MS
                              ? 'adm-card-last is-recent'
                              : 'adm-card-last'
                          }
                        >
                          <span className="adm-last-dot" aria-hidden="true" />
                          {row.lastSeen
                            ? `Dernière connexion ${lastSeenLabel(row.lastSeen, now)}`
                            : 'Pas encore de connexion enregistrée'}
                        </span>
                      )}
                    </div>
                    <button className="adm-manage" onClick={() => setManaging(row.name)}>
                      Gérer
                    </button>
                  </div>
                  <ProfileDetails insights={row.insights} now={now} />
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      )}

      {managed && (
        <ManageModal
          row={managed}
          others={profiles.filter((p) => p !== managed.name)}
          media={media}
          seenBy={seenBy}
          username={username}
          onClose={() => setManaging(null)}
          onDone={(change) => {
            setManaging(null)
            onChanged(change)
          }}
        />
      )}
    </div>
  )
}
