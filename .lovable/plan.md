
Three phases, ship-able independently. Decisions baked in from your replies.

---

## Phase 1 — Title overhaul

Cap the ladder at Prince/Princess, add Viscount/Viscountess, widen spacing.

Rewrite `MILESTONE_TITLES` in `src/lib/game-data.ts`:

| Level | Male | Female |
|---|---|---|
| 42 | Prince | Princess |
| 40 | Duke | Duchess |
| 37 | Marquis | Marquise |
| 34 | Viscount | Viscountess |
| 31 | Count | Countess |
| 28 | Baron | Baroness |
| 25 | Lord | Lady |

Then sweep `src/**` for stale "King / Queen / Emperor / Empress / your Majesty" copy in:
- `GameManual.tsx` (titles section)
- `SoulforgeDialog.tsx` / `SoulforgeTabContent.tsx` (gets fully rewritten in Phase 2 anyway)
- Any NPC / inspect / online-players flavour text

The word "King"/"Queen" is reserved exclusively for the Aldric reward (Phase 3).

---

## Phase 2 — Soulforged Ring replaces Crown + Soulforge

The old "forge once" Crown and Soulforge are removed. Every character earns a **Soulforged Ring** at level 30 and re-forges it at L33, L36, L39, L42. Stats are fully re-allocated at each upgrade.

### Item ladder

| Level | Tier | Name |
|---|---|---|
| 30 | 1 | Soulforged Ring |
| 33 | 2 | Tempered Soulforged Ring |
| 36 | 3 | Refined Soulforged Ring |
| 39 | 4 | Masterwork Soulforged Ring |
| 42 | 5 | Ascended Soulforged Ring |

Rarity = `soulforged` (already the top tier in the `item_rarity` enum: common < uncommon < unique < soulforged — magenta glow, 2.0× stat-budget multiplier). Slot = `ring`, soulbound, hands = null. Budget = `getItemStatBudget(level, 'soulforged', 1)` per tier.

**No materials required.** Just hit the milestone level and visit the Soulforge.

### Schema (single migration)

- Add `characters.soulring_tier int NOT NULL DEFAULT 0` (0 = none, 1–5 = current tier).
- Add `characters.soulring_inventory_id uuid NULL` (no FK to keep migrations cheap; the RPC keeps it consistent).
- **Wipe legacy soulforged gear:**
  ```sql
  DELETE FROM character_inventory ci
   USING items i
   WHERE ci.item_id = i.id
     AND i.rarity = 'soulforged';
  DELETE FROM items WHERE rarity = 'soulforged';
  UPDATE characters
     SET crown_item_created = false,
         soulforged_item_created = false;
  ```
  After this, both legacy flags become dead columns — leave them for now, drop in a later cleanup pass.

- New RPC `forge_soulring(p_character_id uuid, p_stats jsonb) returns jsonb`, `SECURITY DEFINER`, `search_path = public`:
  1. `owns_character` check.
  2. `next_tier = soulring_tier + 1`; reject if `> 5` or `level < [30,33,36,39,42][next_tier-1]`.
  3. Recompute budget + per-stat caps server-side (mirror existing soulforge math; reject `potion_slots`; require ≥2 stats).
  4. `pg_advisory_xact_lock(hashtext('soulring_' || character_id))`.
  5. Delete old ring inventory + items row if present.
  6. Insert new `items` row with the tier name above, rarity `soulforged`, level = milestone level, slot `ring`, `is_soulbound = true`, value derived as in the current soulforge function.
  7. Insert into `character_inventory`. Bump `soulring_tier`, set `soulring_inventory_id`.
  8. Return `{ item, tier }`.

### Edge function

Delete `supabase/functions/soulforge-item/` — client calls `forge_soulring` directly via `supabase.rpc`. Keep `soulforge-name` only if you want AI-suggested ring epithets; otherwise delete (the five fixed names are enough). My recommendation: drop it for simplicity.

### Frontend

Rebuild the soulforge surfaces around a single ring flow:
- `SoulforgeDialog.tsx` and `SoulforgeTabContent.tsx`: replace the mode picker with a single panel that always shows the **current** ring (if any) + the **next** upgrade preview.
- Header shows current tier ("Tier 2 · Tempered Soulforged Ring").
- Pre-fill the stat allocator with the existing ring's stats so re-forging tweaks rather than starts from zero. Allow full re-allocation up to the new budget.
- States:
  - `level < 30` → flavour-only empty state.
  - `level >= next milestone && tier < 5` → forge / re-forge form.
  - `tier == 5 && level == 42` → "Your Soulforged Ring is Ascended. The forge has nothing more to give."
  - `tier > 0 && level < next milestone` → "Return at level X to refine your ring."
- Button label: "Forge Soulforged Ring" for tier 1, otherwise "Re-forge as {Next Tier Name}".

### Whisper prompt (new)

When the player crosses a milestone level (30/33/36/39/42) **and** has not yet forged that tier, show a non-blocking tooltip/whisper anchored near the character's HUD:

- Fades in and out on a slow loop (e.g. `animate-pulse` repurposed at 4s, or a custom keyframe `whisper-fade` opacity 0→1→0 over 6s, infinite, ease-in-out).
- Copy: *"The ring is increasing in strength… visit the Soulforge."* (italic, magenta `text-soulforged`.)
- Dismiss conditions: the player visits the Soulforge node (or opens the dialog), or forges the next tier. Auto-dismiss is checked on every `character` refresh.
- Implementation: new small component `SoulforgeWhisper.tsx` mounted in `CharacterPanel` (or `GamePage` for visibility from any tab). Pure derived state from `character.level` + `character.soulring_tier`; no localStorage.

### Backwards compatibility

Existing characters: legacy soulforged items wiped in the migration (per your instruction). Players at L30+ will see the whisper the next time they log in.

---

## Phase 3 — "King" / "Queen" title for slaying King Aldric

Whoever lands the killing blow on King Aldric Vael, the Unbroken (creature `e1789e02-aa86-49a2-af02-148ac53503bc`) gets the title until they've been offline > 30 minutes (mirroring the unique-item return rule).

### Schema

Add to `characters`:
- `king_slayer_at timestamptz NULL`.

Title is "active" iff `king_slayer_at IS NOT NULL AND last_online > now() - interval '30 minutes'`. At most one king at a time.

### Award path

In `supabase/functions/_shared/kill-resolver.ts`, after a kill is resolved:
- If `creature.id === 'e1789e02-aa86-49a2-af02-148ac53503bc'`, surface an `awardKingTitleTo: string` on the `KillOutcome` for the **single killing-blow recipient** (the recipient credited with the actual final blow — for live combat we already have that as the attacker who dropped HP to 0; pass it through the call site).
- Caller (`combat-tick`) runs a new RPC `crown_king_slayer(_character_id uuid)`:
  ```sql
  UPDATE characters SET king_slayer_at = NULL WHERE king_slayer_at IS NOT NULL;
  UPDATE characters SET king_slayer_at = now() WHERE id = _character_id;
  ```
  (Both statements run in the same transaction so the throne is always single-occupant.)
- Broadcast a world event: *"King Aldric Vael has fallen. {name} is now King/Queen of Varneth."* via the existing global broadcast bus.

### Janitor

Extend the existing `return_unique_items()` cron (or add a sibling called from the same schedule):
```sql
UPDATE characters SET king_slayer_at = NULL
WHERE king_slayer_at IS NOT NULL
  AND last_online < now() - interval '30 minutes';
```

### Display

Update `getCharacterTitle(level, gender, isKingSlayer?)`:
- If `isKingSlayer`: return "King" / "Queen" (overrides the milestone title).
- Else: milestone lookup from Phase 1.

Thread `king_slayer_at` (or a derived `isKingSlayer` boolean computed against `last_online`) through:
- `useCharacter` → add to the fetched character shape.
- Inspect / Online Players / Party Panel / NodeView → already call `getCharacterTitle`; pass the new flag.
- Optional polish: gold glow on the title chip while active.

---

## Build order

1. Phase 1 (title rewrite + sweep).
2. Phase 2 (migration + RPC + dialog rebuild + whisper).
3. Phase 3 (migration + kill-resolver hook + janitor + display).

Each phase is independently shippable. Want me to start with Phase 1?
