# Ability publication and numeric semantics

ENG-ABILITY-001 preserves CP costs, unlock levels, resource formulas, percentage stance reservation and the world heartbeat. Source verification is separate from Cloud installation/deployment/publication.

## Publication

Authoring remains in `base_abilities`, configured identity/attributes in `abilities`, class/role/unlock/default/overrides in `class_ability_assignments`, statuses in `applied_statuses` and scaling in `classes`.

The read-only `scripts/dump-active-ability-inventory.ts` captures joined rows/roles/classes/statuses into `src/shared/combat/inventory/ability-publication-source.json`. It does not write the database or deploy. Its old numeric `pick` interpretation is removed.

Run `node scripts/publish-abilities.mjs`. `publishAbilities` uses the browser's `composeAbilityRow` then `applyAssignmentOverrides`: role binding, accuracy, status configuration, supported overrides and class scale. Missing base/role, invalid cost/unlock, invalid overrides, duplicate class identity or rejected Combat2 records fail publication. Cost is independent of unlock.

Both committed JSON outputs are generated from one serialization: `src/shared/combat/inventory/active-abilities.json` and `supabase/functions/_shared/combat2/active-abilities.json`. `node scripts/publish-abilities.mjs --check` verifies both against the source. Records carry schema version and source hash. `scripts/generate-combat2-edge-mirror.mjs` maintains runtime mirrors. Workers load published JSON, never browser state. Class-scoped lookup accepts ability and assignment identities.

**Verified input provenance:** A fresh read-only configured Supabase REST export returned 36 assignments and five statuses. The initial reconstruction was archived outside the repository; every field difference is classified in `docs/operations/ability-configured-diff.json`. Configured INT Dissonance, WIS Nature's Snare, Judgment without the stale ×0.8 rider and actual role/presentation/status data now drive publication. Costs, reservations and unlocks matched. Approved local Battle Cry and presentation edits follow the export; the database has not been changed. See `docs/operations/ability-authority-verification.md` for source-SQL/configured parity and installed-definition limits.

## Numeric semantics and missing consumer

`resolveAmount` preserves `percent` and `multiplier`, including probability ratios; HP/flat/count retain integer settlement. Authored rounding/caps still apply. Fractional offense, stealth, control and evasion reach their consumers.

An evasion mechanic with `next_hit_window_ms` and multiplier above one additionally creates an independent `offense/next_hit_mult` charge. The authored window is converted to ticks. The next landed basic/ability hit applies and consumes it once; misses retain it; evading does not consume it. Multi-attack uses it for the first landed arrow only. This implements Disengage's existing authored contract and preserves its defensive evade-charge behaviour.

## Explicit interval transformation

Existing Combat2 closure tests require party-presence effects every heartbeat. Published `intervalMs` is therefore 2000 for party-target `party_regen`/`regen_buff`, `authoredIntervalMs` retains the configured value and `runtimeTransformations` records `party_presence_interval_is_one_combat2_heartbeat`. No pulse amount/duration rebalance. Other intervals retain whole-tick ceiling conversion.

## Remaining authorities and ambiguities

- Frontend hardcoded lists are bootstrap presentation defaults. `useAbilityRegistry.source` distinguishes configured from bootstrap-fallback.
- `ABILITY_SEED` is default seed/parity and legacy sealed-loader input, not the Combat2 release fallback. It does not enumerate all configured alternatives/statuses. Combat1 execution is retired; its retained compatibility cleanup is separate. The published catalogue preserves Frostbolt and Fireball/Scorched.
- SQL stance/preflight still reads database configuration while workers load a bundle. Publication alone does not align installed SQL/configuration. Release review must compare identities, costs and reservations.
- Force Shield keeps SQL-owned activation/reformation and persistent `ward_remaining`; role-bound preview does not replace the ward formula.
- Battle Cry authors `crit_chance_reduction_pct: 0.10`: subtract ten percentage points from enemy critical-hit chance, clamped at zero. Existing enemy attacks crit on natural 20 (5%); while active this becomes zero. Natural 20 still lands. This parameter is separate from `crit_softening_pct`, which reduces critical bonus damage. Existing damage reduction/shield bonus remain unchanged. Strongest chance reduction applies; no additive stacking is introduced.
- Grand Finale uses its existing burst calculation without a bonus die; stale presentation corrected. Consecrate affects all eligible hostile living node creatures; eligibility/damage/duration/cadence unchanged. Rend retains stackable Bleed without weapon scaling or an initial hit; the weapon-based initial physical hit is deferred to balance design.

The existing activation/reservation, death/class/equipment, movement/reconnect and arena boundaries remain unchanged. Tests cover seven-class composition, DEX, fractional units, statuses/overrides, independent cost/unlock, stance fields/lifetime, Disengage and interval normalization. No generation/check command authorizes deployment. Frontend publication is Mik-only.
