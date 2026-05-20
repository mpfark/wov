## Goal

When a character dings level 40 or 42, automatically grant a unique soulbound material to their pouch and surface a flavor line in the event log that hints at the Deep-Core Forge in Kharak-Dum. Each material is consumed when the player forges its matching item at the Soulforge.

## Materials to add

Both inserted into the `materials` catalog so they show up in `MaterialsSection` like any other pouch entry.

| key | name | category | rarity | tradeable | value | icon | sort_order |
|---|---|---|---|---|---|---|---|
| `soulmarked_ember` | Soulmarked Ember | `forge_token` | `unique` | `false` | `0` | 🔥 | 500 |
| `corebound_fragment` | Corebound Fragment | `forge_token` | `soulforged` | `false` | `0` | 🩸 | 510 |

`tradeable=false` already blocks selling via the existing `sell-material` edge function (line 53). Materials have no drop UI today, so "cannot be dropped" is already true by construction — no extra guard needed.

### Descriptions (stored in `materials.description`)

- **Soulmarked Ember** — "A dark fragment of mineral and ash, warm despite its cold appearance. Thin lines of ember-red glow faintly beneath its surface, pulsing slowly like a distant heartbeat. Holding it for too long leaves an uneasy sensation — not pain, but recognition. The fragment seems subtly drawn toward something far below the world above."
- **Corebound Fragment** — "A dense shard of blackened metal veined with slow-moving heat. Unlike the Soulmarked Ember, this fragment feels impossibly heavy for its size. The Deep-Core Forge no longer calls to you. It expects you."

## Where the grant fires

Single source of truth for level-ups is `supabase/functions/combat-tick/index.ts` around lines 1449–1485 (the `newLevel = c.level + 1` block, alongside the existing respec-point milestones for L10/20/30/40). Offscreen catchup defers leveling to the next online tick, so this single insertion covers all paths.

Inside that block, after the existing milestone events, add:

```ts
if (newLevel === 40) {
  materialAddPromises.push(
    db.rpc('add_material', { _character_id: m.id, _key: 'soulmarked_ember', _delta: 1 })
  );
  events.push({
    type: 'milestone_ember',
    character_id: m.id,
    message: '✨ As your strength settles into something greater, you feel a distant pull deep beneath the mountains — ancient, patient, and waiting.',
  });
}
if (newLevel === 42) {
  materialAddPromises.push(
    db.rpc('add_material', { _character_id: m.id, _key: 'corebound_fragment', _delta: 1 })
  );
  events.push({
    type: 'milestone_ember',
    character_id: m.id,
    message: '🌋 The distant pull beneath the mountains returns — heavier now, no longer waiting, but expecting.',
  });
}
```

`materialAddPromises` and `db` are already in scope in this block (used by the existing salvage grant a few lines below).

## Event log styling

Register the new `milestone_ember` type in `src/features/combat/utils/event-log-styles.ts` so the line gets a distinct color (suggest the existing `level_up` / `respec` palette — gold/magenta tone). No changes to `interpretCombatTickResult.ts` are required: it forwards `ev.message` verbatim for unknown structured events, and the line will appear in the combat/event log just like the current `🎉 Level Up!` and `🔄 respec` messages.

## Material consumption at the forge

Update `supabase/functions/soulforge-item/index.ts` to consume the matching token immediately before each successful forge:

- Crown branch (`isCrown === true`, line ~148): after the existing level/`crown_item_created` checks, call `consume_material({ _key: 'soulmarked_ember', _delta: 1 })`. If it fails, return `403 "You lack a Soulmarked Ember — return when the forge has claimed you."`
- Soulforge branch (`isCrown === false`, line ~155): same pattern with `corebound_fragment`. Error: `"You lack a Corebound Fragment."`

Both consumes happen BEFORE the `items` insert, so a missing token blocks the forge cleanly with no rollback needed.

## Backfill (one-shot data fix)

Existing characters who are already ≥40 / ≥42 should also receive their tokens once. After the migration is approved, run via the insert tool:

```sql
-- Grant Soulmarked Ember to every L40+ character that hasn't forged a Crown yet
INSERT INTO character_materials (character_id, material_key, count)
SELECT id, 'soulmarked_ember', 1
FROM characters
WHERE level >= 40 AND crown_item_created = false
ON CONFLICT (character_id, material_key)
DO UPDATE SET count = character_materials.count + 1;

-- Grant Corebound Fragment to every L42 character that hasn't forged a Soulforged item yet
INSERT INTO character_materials (character_id, material_key, count)
SELECT id, 'corebound_fragment', 1
FROM characters
WHERE level >= 42 AND soulforged_item_created = false
ON CONFLICT (character_id, material_key)
DO UPDATE SET count = character_materials.count + 1;
```

## Files touched

- **Migration** — insert two rows into `materials` (new `forge_token` category is just a string label; no enum change needed).
- `supabase/functions/combat-tick/index.ts` — milestone grants + event lines.
- `supabase/functions/soulforge-item/index.ts` — consume token in both forge branches.
- `src/features/combat/utils/event-log-styles.ts` — color/category for `milestone_ember`.
- Data backfill via the insert tool (one-time).

## Out of scope

- No new whisper / chat broadcast (replaces the earlier whisper plan).
- No new UI for the materials — they render automatically through `MaterialsSection` (`useMaterials` reads the catalog, `category !== 'gem'` includes them).
- No NPC quest hooks, map markers, or tutorial overlays — discovery is intentionally implicit per the design intent.
- No expansion tiers (future embers) — scaffolded only conceptually.

## Verification

1. Ding a test character 39→40 and 41→42 via combat; confirm the flavor line appears in the event log and the matching material lands in the pouch with a tooltip description.
2. Attempt to sell either token at a vendor — `sell-material` should return "not tradeable".
3. Forge a Crown without an Ember (manually `consume_material` first) — should fail; with the Ember present, forge succeeds and the Ember count drops by 1. Repeat for the L42 fragment.
4. Confirm backfill grants tokens to existing eligible characters exactly once.
