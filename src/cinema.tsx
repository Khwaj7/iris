import type { CSSProperties, ReactNode, RefObject } from 'react'
import type { Media } from './lib/supabase'
import { useCountUp, useInView } from './motion'
import './cinema.css'

// The shared "cinema" components used by both the list and the stats page:
// the poster-wall hero, the sliding segmented control, the scroll-triggered
// Reveal and the count-up Counter. Styles live in cinema.css; the hooks behind
// them in motion.ts (kept apart so this file only exports components).

export function Counter({ value, active }: { value: number; active: boolean }) {
  return <>{useCountUp(value, active).toLocaleString('fr-FR')}</>
}

// A block that fades and slides up when it enters the viewport. Children
// (bars, columns, cards) key their own entrance off its .is-visible class.
export function Reveal({
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

// Full-bleed header over a tilted, drifting wall of posters.
export function CinemaHero({
  posters,
  heroRef,
  width,
  children,
}: {
  posters: Media[]
  heroRef?: RefObject<HTMLDivElement | null>
  // Max width of the content, to line up with the page body below.
  width?: string
  children: ReactNode
}) {
  return (
    <div className="cine-hero" ref={heroRef}>
      <div className="cine-hero-bg" aria-hidden="true">
        <div className="cine-hero-wall">
          {posters.map((m, i) => (
            <img key={m.id} src={m.thumbnail_url!} alt="" style={{ '--i': i } as CSSProperties} />
          ))}
        </div>
        <div className="cine-hero-shade" />
      </div>
      <div
        className="cine-hero-content"
        style={width ? ({ '--cine-width': width } as CSSProperties) : undefined}
      >
        {children}
      </div>
    </div>
  )
}

export type SegmentOption<T extends string> = { value: T; label: ReactNode; count?: number }

// Segmented control whose highlight slides to the selected option.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  surface,
}: {
  options: SegmentOption<T>[]
  value: T
  onChange: (value: T) => void
  // On the page background rather than over the hero.
  surface?: boolean
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <nav
      className={surface ? 'cine-scope is-surface' : 'cine-scope'}
      style={{ '--index': index, '--count': options.length } as CSSProperties}
    >
      <span className="cine-scope-thumb" aria-hidden="true" />
      {options.map((option) => (
        <button
          key={option.value}
          className={option.value === value ? 'active' : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && (
            <span className="cine-scope-count">{option.count}</span>
          )}
        </button>
      ))}
    </nav>
  )
}

// A round initial badge with a stable hue per name, so each person keeps
// their colour everywhere (stats, admin).
export function Avatar({ name }: { name: string }) {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return (
    <span className="cine-avatar" style={{ '--hue': hash } as CSSProperties} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
