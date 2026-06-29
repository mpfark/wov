# Rename Rogue → Assassin

The class key `rogue` is used as a Postgres enum value (`character_class`) and as a string literal across formulas, abilities, UI labels, AI prompts, and tests. The rename touches both the database and the code in lockstep — they must ship together so existing characters keep working.

## 1. Database migration

Single migration that:

- `ALTER TYPE public.character_class RENAME VALUE 'rogue' TO 'assassin'`
  - This automatically rewrites all rows storing the value (3 existing `characters`, plus any `character_class_bonds`, `class_starting_gear`, and `nodes.class_hall` rows that referenced `rogue`). No data loss, no row updates needed.
- Sanity check: re-run any `CHECK` constraints / RLS policies that hardcoded `'rogue'` (none expected — they reference the enum type) and any view definitions.

After the migration the regenerated `types.ts` will replace `"rogue"` with `"assassin"` in the union for `character_class`, which is what forces the rest of the code rename.

## 2. Code rename (key + label)

Replace the **key** `rogue` → `assassin` and the **label** `Rogue` → `Assassin` everywhere it appears. The key change is mechanical; the label change is just user-facing text.

Files touched (key + label):

- `src/shared/formulas/classes.ts` and its mirror `supabase/functions/_shared/formulas/classes.ts`
  - `CLASS_BASE_HP`, `CLASS_BASE_AC`, `CLASS_LEVEL_BONUSES`, `CLASS_LABELS`, `CLASS_WEAPON_AFFINITY`, `CLASS_COMBAT_PROFILES`, `CLASS_CRIT_RANGE`
- `src/shared/formulas/abilities.ts` + `supabase/functions/_shared/formulas/abilities.ts` — rogue ability table key
- `src/shared/formulas/combat.ts` + mirror — any `'rogue'` branches
- `src/lib/game-data.ts` — `CLASS_STATS.rogue`, `CLASS_DESCRIPTIONS.rogue`, labels
- `src/features/combat/utils/class-abilities.ts` — ability bar entries
- `src/features/combat/utils/combat-text.ts`
- `src/features/combat/hooks/useCombatActions.ts`
- `src/features/chat/components/OnlinePanel.tsx` — `CLASS_LABELS` map
- `src/components/admin/users/constants.ts` (if it lists classes)
- `src/components/admin/GameManual.tsx`
- `src/components/admin/tools/ClassBondsInspector.tsx`
- `supabase/functions/combat-tick/index.ts` — any `'rogue'` checks
- `supabase/functions/ai-character-portrait/index.ts` and other AI prompts that mention "rogue" in flavor text → "assassin"
- `supabase/functions/admin-users/index.ts`
- `supabase/functions/seed-archetype-items/index.ts`
- Tests: `src/shared/formulas/__tests__/formula-parity.test.ts`, `src/lib/__tests__/effective-caps.test.ts`

Mechanical rule: any string literal `'rogue'`/`"rogue"` becomes `'assassin'`, any object key `rogue:` becomes `assassin:`, any UI string `Rogue` becomes `Assassin`. Comments mentioning "rogue" updated where it would be misleading (e.g. "rogue 19 crit edge" → "assassin 19 crit edge").

## 3. Old migration files

The historical SQL migrations under `supabase/migrations/*.sql` that reference `'rogue'` are **left untouched**. They represent past state and the new `RENAME VALUE` migration brings the database to the new name. Rewriting old migrations would break their checksums/history.

## 4. Order / class-hall naming

`nodes.class_hall` uses the same enum, so any "Rogue's Den" style node will automatically point at the renamed enum value. The node's **display name** (its `name` text) is authored content — I'll leave existing node names alone unless you want me to rename them too (see question).

## 5. Verification

- `bunx tsgo --noEmit` to confirm the new `types.ts` union matches every literal.
- `rg -w rogue src supabase` should return zero matches after the rename (excluding old migration files).
- Spot-check: load an existing rogue character (now `assassin`) — class label, ability bar, bond row should all read "Assassin".

## Question before I build

Do you also want me to rename any **node names** like "Rogue's Den" / "Rogues' Hall" in the world data (text rewrite of `nodes.name`), or only the class key + label and leave authored node names alone?
