# Plan: Blacksmith Onboarding Whisper + Crafting XP

Two small, independent additions.

## 1. "Visit the Blacksmith" whisper (new player nudge)

New component `BlacksmithIntroWhisper.tsx`, modeled directly on the existing `SoulforgeWhisper` (same fixed bottom-center fade style — feels consistent, no new visual language).

Behavior:
- Shows for a character only if **all** of these are true:
  - Character `level <= 3` (i.e. truly new — won't pester a returning veteran on a fresh alt forever).
  - Character has never crafted (see below) AND has never visited a blacksmith node.
  - Currently NOT standing at a blacksmith node.
  - Not dismissed.
- Copy: *"💍 A gruff voice whispers: 'When you've a coin to spare, come see me at the forge in Hearthvale — north-east of the square.'"*
- Dismissal persists in `localStorage` under `onboarding.blacksmith-intro.${characterId}.dismissed.v1` (same pattern as `OnboardingCoachmark`). Click to dismiss; auto-hides permanently the first time the character stands on any `is_blacksmith` node.

Mounted from `GamePage.tsx` next to the existing `SoulforgeWhisper`, fed `character`, current node's `is_blacksmith` flag, and a `hasCrafted` boolean (see §2 — same flag the XP code touches).

No DB schema change — the "has visited blacksmith" + "has crafted" signals are stored in `localStorage` keyed per character. This matches how the keyboard-shortcuts coachmark and Soulforge whisper already work (pure client-side onboarding state). If we later want this cross-device, we can promote the flag to `characters` in a follow-up.

## 2. Small static crafting XP

Award a flat **25 XP** every successful craft, in these edge functions:
- `blacksmith-forge` (forge mode)
- `jewelcrafter-forge` (forge mode)
- `stonebinder-fuse` (successful fusion)

Rationale: 25 XP is ~2.5 kills at L1 (meaningful nudge for a first-time crafter), and by L10+ it's a rounding error — exactly the shape you asked for. Static, no level scaling.

Rules:
- Skipped silently when `character.level >= 42` (level cap — matches existing XP-grant pattern).
- Added to `characters.xp` in the same update that already writes gold/inventory, so it's atomic with the craft.
- Returned in the function response as `xp_awarded: 25` so the client can show a small log line: *"🔩 The blacksmith forged: X! (+25 XP)"*.
- Does **not** trigger level-up math here — XP threshold/level-up is already handled centrally on next character refresh. (Confirm during build by checking how `xp_boost` / kill rewards currently grant XP; reuse that path so a craft that crosses a level boundary still levels the player up properly.)

No new tables, no schema migration, no formula module changes.

## Files touched

- **New:** `src/features/inventory/components/BlacksmithIntroWhisper.tsx`
- **Edited:** `src/pages/GamePage.tsx` (mount the whisper, pass `is_blacksmith` for current node)
- **Edited:** `supabase/functions/blacksmith-forge/index.ts`, `supabase/functions/jewelcrafter-forge/index.ts`, `supabase/functions/stonebinder-fuse/index.ts` (add 25 XP grant on success, return `xp_awarded`)
- **Edited:** `BlacksmithPanel.tsx`, `JewelcrafterPanel.tsx`, `StonebinderPanel.tsx` (append `(+25 XP)` to the success log, and set the `crafted` localStorage flag the whisper reads)

## Out of scope

- No promotion of the onboarding flag to the database.
- No XP for `ai-item-forge` (admin tool) or vendor/marketplace flows.
- No change to crafting costs or item stats.
