---
name: Evasion Consolidation
description: Cloak of Shadows + Disengage share one evasion_buff base; dodge certainty, next-hit window and source are config
type: feature
---
Consolidation Group E — evasion buffs run ONE reusable `evasion_buff` base.

- Retired mechanic: `disengage_buff` (still matched in client type/branch so archived assignments resolve).
- `effect_config` knobs:
  - `evasion_source`: `'cloak' | 'disengage'` — tags the local evasion buff.
  - `dodge_chance`: configured certainty (Disengage = 1.0). When present the calc `amount` is the NEXT-HIT damage multiplier; when absent the calc `amount` IS the dodge chance (Cloak).
  - `next_hit_window_ms`: grants the disengage next-hit bonus window (15000ms).
- Wording is authored in `combat_text.activate_text` with placeholders `{dodge_pct}`, `{seconds}`, `{bonus_pct}`.
- Scaling identity: Cloak = CHA dodge magnitude / DEX duration; Disengage = WIS next-hit bonus / DEX dodge duration.
- Guard test: `src/shared/config/__tests__/evasion-consolidation.test.ts`.
