import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { Media } from './lib/supabase'
import { supabase } from './lib/supabase'
import { MEDIA_TYPE_ICON } from './lib/media'
import { ADMIN_CODE, deleteProfile, mergeProfile } from './lib/admin'
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
  added: number
  seen: number
  // Another profile whose name differs only by case or accents: a likely
  // duplicate, and the default merge target.
  twin: string | null
}

const fold = (name: string) =>
  name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()

const since = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' })

const RECENT_LIMIT = 5

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
    return (
      <p className="adm-lock-note">
        Aucun code admin n'est défini. Ajoute <code>VITE_ADMIN_CODE=…</code> dans{' '}
        <code>.env.local</code>, puis relance le serveur.
      </p>
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
  const [createdAt, setCreatedAt] = useState<Record<string, string>>({})
  const [heroRef, heroVisible] = useInView<HTMLDivElement>()

  // Sign-up dates are only needed here, so they're fetched here rather than
  // kept in App with the rest.
  useEffect(() => {
    if (!unlocked) return
    let cancelled = false
    supabase
      .from('profiles')
      .select('name, created_at')
      .then(({ data }) => {
        if (cancelled || !data) return
        setCreatedAt(Object.fromEntries(data.map((p) => [p.name as string, p.created_at as string])))
      })
    return () => {
      cancelled = true
    }
  }, [unlocked, profiles])

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
        createdAt: createdAt[name] ?? null,
        added: media.filter((m) => m.added_by === name).length,
        seen: seenCounts.get(name) ?? 0,
        twin,
      }
    })
  }, [profiles, media, seenBy, createdAt])

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
          <ul className="adm-list">
            {rows.map((row, i) => (
              <li key={row.name} style={{ '--i': Math.min(i, 10) } as CSSProperties}>
                <Reveal as="div" className="adm-card" delay={Math.min(i, 10) * 50}>
                  <Avatar name={row.name} />
                  <div className="adm-card-text">
                    <span className="adm-card-name">
                      {row.name}
                      {row.name === username && <span className="adm-chip is-you">toi</span>}
                      {row.twin && <span className="adm-chip is-twin">doublon de {row.twin} ?</span>}
                    </span>
                    <span className="adm-card-meta">
                      {plural(row.added, 'ajout', 'ajouts')} · {plural(row.seen, 'vu', 'vus')}
                      {row.createdAt && ` · depuis le ${since.format(new Date(row.createdAt))}`}
                    </span>
                  </div>
                  <button className="adm-manage" onClick={() => setManaging(row.name)}>
                    Gérer
                  </button>
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
