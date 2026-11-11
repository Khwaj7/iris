import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { Media } from './lib/supabase'

// Animation hooks and helpers behind the components in cinema.tsx.

export const reducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

// True once the element has scrolled into view, and stays true: every reveal
// animation plays once. Without IntersectionObserver, or with reduced motion,
// everything is simply visible from the start.
export function useInView<T extends Element>(): [RefObject<T | null>, boolean] {
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
export function useCountUp(target: number, active: boolean, duration = 1100) {
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

const WALL_SIZE = 24

// The latest posters, for a hero backdrop.
export function posterWall(media: Media[]): Media[] {
  return [...media]
    .filter((m) => m.thumbnail_url)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, WALL_SIZE)
}

