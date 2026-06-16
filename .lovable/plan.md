## Goal

Add a new NPC dialogue topic kind, `hunt_dir`, that works like `class_hall_dir` but points the player toward an **area whose level range matches their character's level**. Admins can attach it to any NPC (innkeeper, guard, hunter) so wandering players always have an in-world hint about where to grind next.

## Behavior

When the player clicks the topic, the NPC responds with one sentence like:

> "If it's prey near your measure, try the **Whispering Fens** — head south, two days' walk, here in Hearthvale Reach."

Selection rules (resolver, in order):
1. Filter areas where `min_level ≤ char.level ≤ max_level`.
2. Prefer areas in the player's **current region**; if none, fall back to any region.
3. Pick the area whose midpoint `(min+max)/2` is closest to the player's level (ties → lowest min_level → alphabetical).
4. Pick a representative node inside that area (first node by name) to anchor the direction sentence — reusing the existing `describeDirection` / `directionSentence` helpers.
5. Edge cases: no character level available → generic line; no matching area → "I know no fitting hunting ground for one of your measure."

The topic is a **single entry** (not a menu) since the answer is dynamic per player. Admins add it once and it auto-tailors.

## Technical changes

**`src/features/creatures/utils/dialogue-topics.ts`**
- Extend `TopicKind` with `'hunt_dir'`.
- Add `characterLevel?: number` to `ResolverContext`.
- New `huntResponse(ctx)` helper implementing the selection rules above.
- Wire `resolveTopic` switch case. `expandTopics` passes it through unchanged.

**`src/features/creatures/components/NPCDialogPanel.tsx`** and **`src/features/character/components/OrderRecruiterDialog.tsx`**
- Pull `character.level` from `useGameContext()` and include it in the `worldContext` passed down (or accept it as a prop from the existing caller that builds `worldContext` — whichever matches current wiring). No UI changes.

**`src/components/admin/NPCManager.tsx`** (topics editor)
- Add a third option in the topic-kind selector: `Hunting grounds (auto)`. No params required — selecting the kind is enough.

## Out of scope

- No DB migration (uses existing `npcs.l` JSONB column and existing area `min_level`/`max_level`).
- No creature-by-creature targeting; we direct to areas, not specific mob spawns.
- No party-aware level averaging — uses the asking character's level only.
- No "scaling" hints (under/over-leveled). The XP penalty system already discourages over-leveling.

## Verification

1. Create/edit an NPC in admin, add a `Hunting grounds` topic, save.
2. As a level-N character, open the NPC: confirm the response names an area whose level range covers N and gives a sensible direction sentence from the current node.
3. As a much higher-level character with no fitting area in-region, confirm fallback line or cross-region pick.
