## Goal

The event log currently lives only in React state in `GamePage.tsx`, capped at the last 100 events (`prev.slice(-99)`) and lost on reload. Server-side logs stay capped for cost reasons. This adds a per-character on-device archive with infinite scrollback in the log panel.

## How it works

- Every structured `GameLogEvent` that reaches the log is also written to IndexedDB, keyed by character.
- The panel keeps rendering the live in-memory window; when the player scrolls up past the top of the loaded range, the next older page (200 events) is loaded from IndexedDB and prepended.
- Retention: 100,000 events per character, oldest pruned in the background. Deleting a character clears its archive.

## Technical details

**New: `src/features/combat/events/log-archive.ts`**
- Thin IndexedDB wrapper (no new dependency): database `wov-log`, store `events`, auto-increment primary key, index on `characterId`.
- `appendEvents(characterId, events[])` — batched writes (flush queued events every ~1s / on unmount) so combat ticks don't thrash the DB.
- `loadPage(characterId, beforeKey, limit)` — reverse cursor read for scrollback paging.
- `pruneCharacter(characterId, max = 100_000)` — runs on session start and every ~5 min; deletes oldest keys beyond the cap.
- `clearCharacter(characterId)` — used on character deletion.
- Graceful no-op fallback if IndexedDB is unavailable (private mode / quota errors) — logging must never break gameplay.

**New: `src/features/combat/hooks/useLogArchive.ts`**
- Subscribes to appended events, queues them for `appendEvents`.
- Exposes `loadOlder()` and `hasMore` for the panel.

**`src/pages/GamePage.tsx`**
- The existing `setEventLog(prev => [...prev.slice(-99), event])` calls funnel through a single `pushEvent` helper (they already share the shape) which both updates state and enqueues the archive write.
- Passes archive paging props into `EventLogPanel`.

**`src/features/combat/components/EventLogPanel.tsx`**
- The list is newest-at-top with `flex-col`, so scrollback means detecting scroll near the *bottom* of the container (older side) and calling `loadOlder()`, preserving scroll offset after prepending.
- Older entries render through the same `EventLogLine` (they are stored as structured events, so styling/flavor mode still work).
- Small "loading older entries…" row, and an end-of-history marker.

**Character deletion**
- `useCharacter.ts`'s delete path calls `clearCharacter(id)` after the cascade RPC so the local archive doesn't outlive the character.

**Tests**
- Unit test for the archive module against `fake-indexeddb` (dev dependency) covering append, paged reads, and pruning at the cap.

## Out of scope

No export-to-file button and no search dialog — the archive module is written so both can be added later.
