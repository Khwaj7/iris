# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

There is no test suite or test runner configured.

## Environment

Requires a `.env.local` with four Vite-exposed variables (all client-side, prefixed `VITE_`):
- `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — consumed in `src/lib/supabase.ts`; the module throws on import if either is missing.
- `VITE_TMDB_API_KEY` — the short v3 key (32 hex chars, sent as `api_key`), not the long "Read Access Token"; consumed in `src/lib/tmdb.ts`; TMDB calls throw at call time if unset.
- `VITE_ADMIN_CODE` — unlocks the admin panel (`src/lib/admin.ts`); the panel says so if unset. Shipped in the client bundle like every `VITE_` value, so it deters, it doesn't secure.

## Architecture

Iris is a shared watchlist of films **and series** ("À voir" / "Vus") backed by Supabase, enriched with metadata from TMDB. There is no router and no backend of its own — `src/lib` holds the only integration boundaries.

**Data model.** Three Supabase tables: `media` (rows = films and series, shape = `Media` type in `src/lib/supabase.ts`), `profiles` (`name`, `created_at`, and `last_seen_at` — added by hand, see `LAST_SEEN_SQL` in `src/lib/profiles.ts`; the code tolerates its absence), and `seen` (the per-profile join table, `media_id` + `profile_name`). **The schema lives only in the Supabase dashboard** — no migrations, no `supabase/` directory, no `.sql` anywhere in history — so the `Media` type is the only in-repo record of the row shape, and any schema change means hand-written SQL run in the dashboard. Categories are stored as French genre labels; `tmdb_id` may be null on legacy rows.

**`media.seen` is a legacy denormalised boolean** — true once anyone has seen it. `saveSeen` still writes it, but the À voir / Vus split is per-profile and comes from the `seen` table. Never filter on `media.seen`. (A table named `seen` beside a column named `seen` is legal but confusing; that's the one awkward spot in `saveSeen`.)

**TMDB numbers films and series in separate, overlapping id ranges.** Any equality on `tmdb_id` must also compare `media_type`, and so must anything client-side keyed off a TMDB id — hence the `` `${mediaType}:${id}` `` composite key in the search results, and the media-type-aware endpoint fork when resolving genre ids.

**State & realtime.** `App` is the single source of truth: it loads all rows once, then subscribes to a Supabase `postgres_changes` channel and merges INSERT/UPDATE events via `upsertMedia`. Writes are optimistic — local state updates first, then the Supabase call; on error the previous value is restored (see `saveSeen`). Because our own writes echo back over the realtime channel, `upsertMedia` dedupes by `id`. **Renaming a realtime table name or a payload column fails silently** — a listener on a table that doesn't exist simply never fires, and a missed `payload.old.media_id` makes un-marking stop propagating with no error anywhere. `grep` after any such rename.

**Navigation is state, not routes.** `App` conditionally renders one view from local state, in this order: `NamePrompt` (no username, or its profile was deleted), `MediaDetail` (a `selectedId` is set), `AdminView`, `StatsView`, or the list. The list, stats and admin share the "cinema" look from `src/cinema.tsx` / `cinema.css` (hero, segmented control, `Reveal`), with its hooks in `src/motion.ts`. The detail view reads its movie out of the live `movies` array by id so realtime updates stay in sync.

**Identity.** No auth. A username is picked once via `NamePrompt` and persisted in `localStorage` under `iris-username`; it is stored on each row as `added_by`. The `profiles` row is written **only** when a name is typed in (`chooseUsername`), never on start-up: a stored name whose profile no longer exists means it was deleted from the admin panel, and `App` sends that device back to `NamePrompt` (`profileRemoved`) instead of re-creating it.

**Admin panel.** `AdminView` (behind `VITE_ADMIN_CODE`) merges a profile into another or deletes it — with its `seen` rows, and optionally the titles it added. The operations live in `src/lib/admin.ts`; with no transactions over REST they are ordered dependants-first (`seen`, then `media`, then `profiles`), and afterwards `App` re-reads all three tables (`loadAll`).

**TMDB layer (`src/lib/tmdb.ts`).** Wraps the TMDB v3 REST API, always requesting `language=fr-FR`. Key conventions:
- Everything is **normalised at the boundary**: films carry `title`/`release_date` and series `name`/`first_air_date`, so `searchMedia`/`getMediaDetails` return `MediaSearchResult`/`MediaDetails` and nothing upstream ever narrows between the two shapes.
- `primaryCategory` picks a single category from `genre_ids` — TMDB returns genres by relevance, so the first known id wins.
- **`CATEGORY_NAMES` and `CATEGORY_COLORS` are one table in two halves**: `genreThemes` requires an id in *both*, so an id present in only one silently disappears from the UI. They cover both of TMDB's genre lists (films and series use different, partly overlapping id sets).
- **Category labels must stay unique per concept**, because `categoryColor` reverse-looks-up label → colour and the list groups by label. Four series ids are *deliberately* aliased onto existing film labels (10759→Action, 10762→Familial, 10765→Science-Fiction, 10768→Guerre) so the category vocabulary and colours match across the Films and Séries lists instead of gaining near-duplicates like "Action" vs "Action & Aventure". These labels are persisted in the `category` column, so changing them would strand existing rows. Where ids share a label, `categoryColor` resolves to the lower one (JS iterates integer-like keys in ascending numeric order).
- **`language=fr-FR` does not translate TMDB's series genre names or a series' `status`** — we supply our own French for both (`src/lib/media.ts`), and an unmapped status renders as nothing rather than English.
- `findTmdbId` is a fallback that resolves a `tmdb_id` by title/year search for rows saved before `tmdb_id` was stored; it needs the media type so it searches the right endpoint.

## Conventions

- **UI language is French** — all user-facing strings are in French. Match this when adding UI.
- Search inputs are debounced (300 ms) with a `cancelled` flag to drop stale/out-of-order responses; reuse this pattern (see `AddMediaForm`) for any new async-on-input feature.
- The genre-id cache in `localStorage` is keyed by Supabase row id and **never invalidated**, so a wrong write persists per device — bump `GENRES_STORAGE_KEY` whenever the resolution logic changes.
- Renaming a CSS class is invisible to `tsc`, oxlint and the browser alike. `grep` across `src/` after any class rename.
- Prefer keeping integration logic in `src/lib`.
