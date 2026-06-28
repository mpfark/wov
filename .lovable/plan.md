# Strip dead creature stats — code cleanup

The DB-side cleanup already ran: every `creatures.stats` row now contains only `str` and `dex`. This plan covers the remaining code changes so generation, admin UI, and the AI world builder stop producing the unused four attributes.

## Why

Live combat (`combat-tick` + `_shared/formulas/combat.ts`) only reads `stats.str` (to-hit + damage modifier) and `stats.dex` (crit threshold). CON/INT/WIS/CHA were generated, stored, displayed in admin panels, and asked of the AI — but never consumed by any mechanic. AC and HP come from their own columns, not from CON.

## Changes

1. **Formula owner** — `src/shared/formulas/creatures.ts`: `generateCreatureStats` returns `{ str, dex }` only (HP/AC unchanged). Mirror byte-for-byte to `supabase/functions/_shared/formulas/creatures.ts`.
2. **Admin previews** — drop CON/INT/WIS/CHA chips in `CreatureManager.tsx`, `NodeEditorDialog.tsx`, and the inline list in `NodeEditorPanel.tsx` (now shows STR/DEX only).
3. **AI world builder schema** — `supabase/functions/ai-world-builder/index.ts`: trim the `stats` JSON schema to `{ str, dex }` and add a one-line description so Gemini stops emitting dead fields.
4. **Tests** — existing parity snapshot in `formula-parity.test.ts` already only asserts `r.stats.str`; no change needed.

## Not touching

- Combat math (already STR/DEX only; `|| 10` fallbacks remain as belt-and-suspenders).
- HP/AC formulas.
- `creatures.stats` jsonb column shape (stays jsonb for forward compatibility).
- Player stat usage.
