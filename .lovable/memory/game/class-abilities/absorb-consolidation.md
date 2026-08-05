---
name: Absorb Shield Consolidation
description: Force Shield + Divine Aegis share one absorb_buff base; target_type drives ally targeting, identity-aware stance resolution
type: feature
---
Phase 6 of ability consolidation (Group C — absorb shields).

- `force_shield` (Wizard, stance, self) and `divine_aegis` (Healer, instant, ally) both run the single `absorb_buff` mechanic. The legacy `ally_absorb` mechanic remains resolvable for archived rows only.
- Ally targeting is configuration, not code: `abilities.target_type = 'ally'` drives the target selector (`NodeView`, `GamePage`) and whether the client stores a capped shield pool. No mechanic-name checks.
- Scaling is role-tagged: `amount_calc.terms[0].role = 'primary'` (shield pool), `duration_calc.terms[0].role = 'secondary'` (duration), so Class Config can substitute attributes. Force Shield = WIS pool / INT duration; Divine Aegis = WIS×2 pool / CON duration (60s cap).
- Wording comes from authored `combat_text.self_text` / `ally_text` with `{target}` and `{seconds}` placeholders.
- Because mechanics are now shared, "is this a stance" must be decided by ability identity: `resolveStanceForAbility()` matches the canonical ability key first, never falls back to the mechanic for ally/party-targeted rows. `INSTANT_WHEN_NOT_STANCE` routes the non-stance `absorb_buff` variant as an instant buff.
- Curves preserved exactly: Force Shield duration term is NOT clamped at zero; Divine Aegis pool has no floor (parity tests in `ability-calc-parity.test.ts` enforce this).
