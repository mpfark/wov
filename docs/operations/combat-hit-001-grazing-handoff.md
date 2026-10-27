# ENG-COMBAT-HIT-001 — Creature grazing implementation handoff

## Reviewed source and scope

- Starting/fetched `origin/main`: `4024409e5845c006d173d3b8a48778f592b58b8f`; unchanged from the audit baseline. Branch `codex/creature-grazing`. The previously inspected local `4f7ec400` has the same tree; implementation starts from actual main.
- Project-state basis `ec36640d85f2d375543a352b04482c411aa42855` is an ancestor of main (`git merge-base --is-ancestor` passed).
- Intentionally changes only the approved creature grazing/contact rule in specification sections **Combat resolution** and **Effects and stances**, roadmap **ENG-COMBAT-HIT-001**. No player mechanics, balance formula, movement/opportunity generation, schema, catalogue or Frost Armor implementation changes.
- Localized `applyCreatureDamage` change: natural 1 misses; non-natural-20 margins below -5 miss; -5..-1 graze; other hits retain existing full magnitude and critical rules. Floor 25% after existing outgoing reduction, before mitigation; no cap or new floor. Natural 20 remains full magnitude even with suppressed critical. Existing RNG streams and draws for previously landed attacks are unchanged.
- All existing direct attack call sites share the change. Landed grazing passes existing evasion, mitigation, block, absorb, persistent ward and reactive paths. Holy Shield can react to fully prevented contact with existing once-per-attacker restriction; evasion prevents reactions. Future Frost Armor contact rule is documented only.
- Minimal presentation adds “grazes” and retains defense breakdowns. Generated Edge resolver mirror updated with the established generator; no other generated mirror changed.
- Exact final commit is provided in the conversation handoff. Commit is local; no push or PR requested. Unrelated build-generated `supabase/functions/mcp/index.ts` output was restored. No pre-existing working changes or stash.

## Artifacts and local checks

Changed files: source/generated resolver; resolver tests; event formatter/presentation tests; engine specification/roadmap; project-state JSON/generated Markdown; this handoff. Artifact hashes below refer to canonical staged Git bytes, not Windows checkout line endings.

| Artifact | SHA-256 |
|---|---|
| `src/shared/combat2/resolver.ts` | 8e1bdcff225a391c6ccf4158e5e96327162760590bac44d207511ddca3316e36 |
| `supabase/functions/_shared/combat2/resolver.ts` | 56aaccb01661557cf5e1e0309fc6f2791d4b27ea38117fe97659553ea6f66d61 |
| `src/features/combat2/event-message.ts` | e9e9fae20ca1b656c10db16834a50543e441561ac76e54ac18fda189f901f0a9 |

| Command | Result |
|---|---|
| `node scripts/generate-combat2-edge-mirror.mjs` | Only required resolver mirror differs. |
| `npx vitest run src/shared/combat2 src/features/combat2/presentation.test.ts --maxWorkers=2` | 18 files / 317 tests pass. |
| `npx vitest run src/shared/combat2 src/shared/formulas/__tests__ src/server/combat2 src/features/combat2/presentation.test.ts --maxWorkers=2` | 94 files: 90 pass, 4 fail; 984 tests pass, 4 fail. All four failures reproduced at untouched baseline; no introduced regression. |
| `npx tsc --noEmit -p tsconfig.app.json` and `npm run typecheck` | Pass. |
| `npm run build` | Pass; existing chunk-size warning. Generated MCP build output excluded. |
| `npm run project-state:generate`, `npm run project-state:check`, `git diff --check` | Pass. |

New coverage includes -6/-5/-1/0 margins, no margin-based strong quality, natural 1/20 and suppressed critical, 1.25x crit, uncapped damage and integer rounding, outgoing/percent/flat order, evasion/Disengage, shield+authored block, zero HP damage, absorb, persistent ward partial/depletion, Holy Shield once-per-attacker contact, opportunities, instant/pending primary/secondary casts, replay/RNG and attributed single death/reward proposals. Existing player-quality and server commit/transport regressions are included. Resolver replay produces identical proposals; database commit remains the existing exactly-once authority, not newly proven hosted concurrency.

Baseline failures independently reproduced in a detached worktree at the starting SHA with the same dependency runtime, node environment and no DOM setup (the affected tests only read source/state):

- `character-location-authority-migration.test.ts`: stale create-character source assertion.
- `legacy-browser-privileges-migration.test.ts`: stale project-state `blocked` expectation.
- `special-transition-fences-migration.test.ts`: stale `specialTravelPending.current` source expectation.
- `shared-mirror-identity.test.ts`: `spawnSync bash ENOENT` on Windows. Remaining mirror identity and Edge packaging tests pass.

Local ignored logs: `combat-hit-001-focused.log`, `combat-hit-001-tests.log`, `combat-hit-001-baseline.log`, `combat-hit-001-build.log`. These are local evidence, not Cloud verification.

## Delivery and remaining risks

- SQL, migration, schema, privilege and generated Cloud types: N/A; none required or executed.
- Future separately authorized Edge delivery must use matching source for both `combat2-tick-once` and `combat2-dispatch-once`, which import the generated process/resolver chain. Existing RPC/auth/configuration contracts are unchanged. No deployment authorized here.
- Matching frontend grazing wording is ready in source; Mik alone manually publishes after backend compatibility is confirmed. No publication performed.
- Later bounded live acceptance should cover ordinary/opportunity/boss grazing, defense text, persistent ward state, contact retaliation and retry/death rewards. Local tests do not establish installed bundle identity, hosted concurrency or live balance.
- Expected balance effect: previously missed attacks can now drain wards and trigger retaliation; low magnitude grazes can round to zero. Both are approved. No unresolved design question remains within this task; Frost Armor stays unimplemented.
- Stop future delivery on source/mirror drift or a failed relevant check; do not broaden into unrelated legacy failures. No Cloud access, deployment, migration, publication, controls or gameplay operations occurred.
