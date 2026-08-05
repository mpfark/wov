---
name: Party Regen Consolidation
description: Purifying Light and Crescendo share one reusable party_regen base; role-tagged attributes and authored cast/tick text carry class identity
type: feature
---
Consolidation Phase 5 (Group B).

- Purifying Light (Healer) and Crescendo (Bard) resolve through ONE `party_regen`
  base ability: same curve shape, same CP cost (40), same 3s interval.
- Heal/tick term is `role: 'primary'`, duration term `role: 'secondary'`, so the
  attributes (Healer WIS/CON, Bard CHA/INT) are substitutable through
  `class_ability_assignments.overrides.scaling`.
- Curves: heal/tick = 2 + primaryMod (floor 1); duration = 15s + secondaryMod × 1s
  (cap 30s). Balance unchanged from before consolidation.
- Identity/presentation comes from authored `combat_text`:
  `cast_text` (placeholders `{who}`, `{seconds}`) and `tick_text`
  (`{who}`, `{amount}`). No consumer branches on class any more.
- `PartyRegenBuff` carries `abilityKey`, `label`, `durationMs`, `tickText`; those
  ride the `party_regen_buff` party broadcast so observers read the caster's own
  ability name. `source` ('healer' | 'bard') is retained for compatibility only.
- Guard test: `src/shared/config/__tests__/party-regen-consolidation.test.ts`.
