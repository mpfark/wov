# ENG-LEGACY-001B2 — stance commit target scope

Local source checkpoint: `6d108344d5988bbaef0a7e45fd0ffa2f47ab9172`. Narrow follow-up to [B5](legacy-001B-combat2-writer-chain.md), using the [approved evidence format](legacy-001A-authority-writer-map-scope.md). No engine rules, runtime code or authority changed.

## Decision

**TRUSTED CALLER ONLY — source-level classification.** Normal worker targets originate in the claimed encounter. The outer database authority does not enforce that scope for the supplied stance updates or clears. Current installed body/ACL parity is unverified. No browser exploit, live unauthorized mutation or confirmed authority conflict is demonstrated.

## Producer-to-commit chain and validation

| Stage | Exact source identity and evidence | Scope guarantee |
|---|---|---|
| Claimed fighters | `supabase/migrations/20260829135558_f0037825-ccff-4b35-b0b2-aa6566be826c.sql:80–117` selects fighters using `nf.encounter_id = e.id`. October claim wrapper in `supabase/migrations/20261001130000_combat2_character_persistent_stances.sql:390–415` adds stance rows joined to present fighters of the snapshot encounter, and pending stance requests filtered by encounter. | Database-produced snapshot is encounter-scoped; requests are distinct from the later update/clear arrays. |
| Decode / worker | `supabase/functions/_shared/combat2/decode.ts:283–307,480–485` decodes stance fields and transition actions; does not cross-bind each stance to a fighter. `process-node-tick-once.ts:165–213` checks claim envelope, decode errors, required boss configuration, encounter/tick/state identity agreement and catalog rejection before resolving. | Shape and authority-envelope checks, not independent stance membership validation. Other decoder fighter/catalog checks do not bind the eventual stance arrays. |
| Resolver materialization | `supabase/functions/_shared/combat2/resolver.ts:125–155` requires a matching present snapshot fighter, known stance ability and matching reserve percentage; creates synthetic stance effects and version fence. Working characters originate only from snapshot fighters (`172–193`). | Ordinary persistent-stance effects are bound to claimed fighters. No independently supplied arbitrary target list in production resolver. |
| Resolver output | Same resolver `1716–1735`: changed synthetic absorb effects look up the matching snapshot stance and emit state/version updates; death emits that working fighter's character UUID into clears. Death flag is initially false, set by damage (`636,1516`). Mirrored `src/shared/combat2/resolver.ts` has the same output sites. | Clears derive from deaths of claimed working characters; update IDs derive from snapshot stance effects. This depends on the trusted snapshot/effect namespace and resolver, not a database ownership check. |
| Transport | `process-node-tick-once.ts:71–109,199–223`: proposal is forwarded whole; JSON serialization and required top-level fields are checked. Stance arrays are not in `PROPOSAL_FIELDS`, and this list does not reject extra keys. `combat2-dispatch-once/handler.ts:35–70,145–158` authenticates the worker secret, creates service transport and calls claim/commit RPCs. | Service-authenticated worker; no second membership filter before commit. Browser-submitted proposal transport is not established. |
| Database commit | October stance migration `418–444`: version-lock supplied fence rows; delegate inner commit; mutate stance rows only for `ok=true, kind=committed`. Updates require matching character/ability/version and raise on missing update; clears delete all stances for supplied UUIDs. Request acknowledgement is independently encounter/intent-scoped. | Version freshness and transaction rollback, but no encounter, fighter, participation, presence or death check on update/clear targets. Empty/omitted fence is accepted; clear has no version check. Exact already-committed retry skips these mutations. |

The current source inner commit in `drizzle/migrations/0002_progression_001d_canonical_xp_cutover.sql:90–619` validates claim token/ticks/state and enumerated character, creature, effect, fighter, intent, reward, equipment and departure references. It does not inspect `stance_updates`, `stance_clear_character_ids` or `stance_fence`; its other foreign-reference guards therefore do not cover these arrays. Its ACL block (`622–633`) restricts enumerated predecessors and grants the outer commit to service_role, with browser/PUBLIC access removed.

## Constraints and privileged-caller boundary

`character_stance` has a character FK, character/ability primary key, allowed ability, reserve, JSON-object and positive-version checks (October migration `173–185`). It has no encounter identity column or membership constraint. Private/service ACLs and RLS restrict who can write, not which encounter a definer proposal may target. Request FKs do not bind the separate arrays.

The C2 child fence (`drizzle/migrations/0013_progression_001g_c2_reset_and_cutover.sql:725–766`) locks referenced characters and rejects soft-deleted targets outside authorized purge. It does not enforce encounter membership for an active character. These restrictions preserve lifecycle protection but cannot prevent cross-encounter active-character stance writes.

A privileged caller capable of obtaining a valid claim/commit could theoretically append an unrelated active character's existing stance with its correct version, or append that character UUID to clears without a stance fence. Inner commit validation can still succeed because these keys are separate from its checked references. This is a source-level capability argument, not an executed mutation, proof of browser access, or proof that the ordinary worker does so.

## Smallest next step

If correction is authorized, bind **all** stance fence/update/clear targets to the committed encounter at the outer authority, before any stance mutation, and reject the whole transaction on foreign targets. Validate eligible claimed participation before inner commit changes presence; preserve death clears after resolution and the existing version/retry guards. Do not rely on requiring targets to remain present after a death/departure commit. No broader privilege or combat-mechanics redesign is needed.

Local implementation preparation can start from this evidence without a new hosted audit. Before installation, obtain only current `pg_get_functiondef`, owner/security/search_path and effective EXECUTE metadata for the outer commit and its direct predecessor, plus relevant stance fence trigger definitions, to guard against installed drift. No gameplay probe is necessary to establish source absence of membership validation; hosted parity is necessary before claiming live containment or installing a body patch.

## Retained limitations and validation

No hosted verification, SQL execution, runtime probe, migration, implementation, commit or push. Existing progression closures, recovery stash, four open F limitations and v3→v2 uncertainty remain unchanged. Administrative XP grants remain paused; normal gameplay XP policy is unchanged. Validation is documentation links, project-state consistency and whitespace only; it does not prove runtime behavior.
