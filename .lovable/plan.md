## Goal

Make world entry immersive with a typed welcome, drop the overlay whispers (blacksmith + soulforge), and replace the soulforge nag with an event-log whisper that fires only when the ring is actually acquired/upgraded.

I'll do this in three phases — small, independent, easy to ship one at a time.

---

## Phase 1 — Immersive entry text

**Detect first entry per character** with a `localStorage` flag `entry.first-welcome.${characterId}.v1` (same pattern as our other onboarding flags; no DB change).

In `src/pages/GamePage.tsx`, replace the static `['Welcome, Wayfarer!']` initial event-log seed with logic that runs once on mount per character:

- **First time** (flag missing): push the long welcome as a sequence of separate event-log lines, then set the flag. Each line lands as its own log entry so it reads like the world telling the story:
  1. *You awaken from a wandering daydream, as though your mind had drifted far beyond the waking world. The thought that held your attention is gone now, lost like mist in the morning sun.*
  2. *As your senses return, you find yourself standing in Hearthvale Square. Familiar voices mingle with the scent of fresh bread and woodsmoke. In your pockets are a few gems and bits of salvaged material gathered from your recent travels.*
  3. *From somewhere to the northeast comes the rhythmic song of hammer against anvil.*
  4. *Clang... clang... clang...*
  5. *Ah, of course.*
  6. *You were on your way to see the blacksmith.*
  7. *What happens next is up to you. Welcome to Wayfarers of Varneth.*

  Lines are pushed with a small stagger (~600 ms between lines) using `setTimeout` chained off the existing event bus, so the player visibly sees them appear one at a time — the closest thing to "typed out" without building a new typewriter component.

- **Returning** (flag present): seed with the single line *Welcome back, Wayfarer!*

Implementation lives in a tiny new hook `useFirstEntryWelcome(character, bus)` in `src/features/world/hooks/` so `GamePage.tsx` stays clean. The hook fires once per character per device.

**Also in Phase 1:** delete the blacksmith overlay.
- Remove the `<BlacksmithIntroWhisper …>` mount from `GamePage.tsx` and its import.
- Delete `src/features/inventory/components/BlacksmithIntroWhisper.tsx`.
- The "crafted" / "visited" localStorage flags the whisper wrote remain harmless; no cleanup needed. The `craftedKey` export is unused elsewhere (only the deleted file referenced it via the import the panels never used).

---

## Phase 2 — Soulforge whisper moves to the event log

Remove the floating overlay and replace it with an in-log whisper that only fires when the player actually **gains or upgrades** a Soulforged Ring tier.

**Detection:** watch `character.soulring_tier`. Keep the last-seen tier in a `useRef` (seeded on first render so we don't fire a fake "upgrade" at login). When it increases:
- Emit one styled event-log line via the existing `bus.emit('log', { message })`:
  *"💍 You feel a warmth at your hand — your Soulforged Ring hums with new power. Return to the Soulforge when you are ready."*
- The ring item already exists in inventory; for the "soft glow" feedback, add a brief CSS pulse on the equipped ring slot in the paper-doll (or the inventory tile) for ~6 s, triggered by the same tier-change effect. This reuses the existing `soulforge-whisper` keyframes in `index.css` — just toggle a class via state.

**Remove the overlay:**
- Delete the `<SoulforgeWhisper …>` mount in `GamePage.tsx` and its import.
- Delete `src/features/inventory/components/SoulforgeWhisper.tsx`.

**Where the ring-glow lives:** the equipped paper-doll slot in `CharacterPanel.tsx`'s Equipment tab (slot `ring`/`ring_2`). The effect is purely visual — a temporary `ring-soulforge-pulse` class added by a small `useSoulringGlow(character)` hook that returns whether the pulse is active. The hook owns the timer.

**Edge case:** if a player levels through a threshold offline and `soulring_tier` is still behind (re-forge isn't auto), the whisper won't fire — that's correct under the new "only when acquired" rule. The old overlay's role of nagging at the threshold is intentionally gone.

---

## Phase 3 — Polish / cleanup

- Audit the two deleted whisper components for any stray imports (`rg`). Remove the now-orphaned `soulforge-whisper` CSS class if nothing else uses it (the new ring-glow gets its own class to keep concerns separate).
- Verify the new entry text renders correctly on mobile (each line is short enough; the event log already wraps).
- Confirm `useFirstEntryWelcome` doesn't double-fire under React Strict Mode (guard with a `ref` in addition to the localStorage check).

---

## Files touched

**Phase 1**
- New: `src/features/world/hooks/useFirstEntryWelcome.ts`
- Edited: `src/pages/GamePage.tsx` (replace seed, mount hook, remove `BlacksmithIntroWhisper`)
- Deleted: `src/features/inventory/components/BlacksmithIntroWhisper.tsx`

**Phase 2**
- New: `src/features/inventory/hooks/useSoulringGlow.ts` (tier-change watcher → log whisper + transient glow flag)
- Edited: `src/pages/GamePage.tsx` (mount the hook, remove `SoulforgeWhisper`)
- Edited: `src/features/character/components/CharacterPanel.tsx` (apply pulse class to ring slots when glow active)
- Edited: `src/index.css` (add `ring-soulforge-pulse` keyframes/class; optionally drop the now-unused overlay class)
- Deleted: `src/features/inventory/components/SoulforgeWhisper.tsx`

**Phase 3**
- Cleanup-only edits as discovered.

---

## Out of scope

- No DB schema changes (entry flag stays in localStorage).
- No change to soulforge/blacksmith crafting mechanics or XP rewards.
- No new typewriter animation engine — the per-line stagger is enough to feel paced without new infrastructure.
