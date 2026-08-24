# Combat log: grammar, Judgment identity, ability highlighting

Presentation-only correction. No change to combat math, accuracy, damage, mitigation, cadence, resolver authority, rewards or ability behavior.

## Root causes (confirmed by reading the code)

1. **"You rais a shield and turns …"** — two separate faults.
   - `secondPersonVerb` in `src/features/combat/events/perspective.ts` treats any `…ses$` as a sibilant `-es` ending, so `raises` loses two letters and becomes `rais`. Only real sibilant clusters (`sh/ch/ss/x/z/o` + `es`) should lose `-es`.
   - The folded full-block line is produced by mutating server prose with regexes in `tick-event-builder.ts` (`blocks` → `raises a shield and turns`, `blow.` → `blow aside!`). The conjugator only touches the verb directly after `You`, so the coordinated verb `turns` is never converted, and `a shield` should read `your shield`.

2. **"You hits … with judgment for 48."** — the resolver emits `ability_crit` for a critical ability hit (`src/shared/combat/pure/resolver.ts`), but `ability_crit` is **not** in `SERVER_EVENT_TYPES` / `SERVER_EVENT_TYPE_MAP` (`log-event.ts`) nor in `STAGE5_TYPES` (`tick-event-builder.ts`). `buildTickLogEvent` returns null, so the line falls into the legacy prose fallback in `interpretCombatTickResult.ts`: raw name→You substitution (no conjugation), raw `judgment` key, damage left inline, and neutral/ambient styling. `ability_hit` is registered but has no authored flavor slot, so it also keeps the generic resolver sentence and inline number.

3. **No ability identity in styling** — `presentation.ts` maps `ability` to `bySource` → the same `action` family as ordinary autoattacks, so casts/hits/misses have no distinct visual identity.

## Corrections

### A. Perspective grammar (structured, not more prose regex)
- Fix `secondPersonVerb` so `-es` is stripped only after `sh`, `ch`, `ss`, `x`, `z`, `o`; otherwise drop the single `-s`. `raises → raise`, `blocks → block`, `has → have` unchanged.
- Replace the full-block prose mutation with an authored **template pair** for the fold: self and observer forms rendered from structured facts (attacker marker, creature name), so no verb has to be guessed:
  - self: `You raise your shield and turn <Creature>'s blow aside!`
  - observer: `<Name> raises their shield and turns <Creature>'s blow aside!`
  Rendered through the existing `SELF_MARKER` / `resolveSelfMarkers` path; no new broad regex over prose.
- **Shield template is scoped to real shield/block mitigation only.** The fold template is selected by `mitigationSource`: `block` / `shield_block` get the shield line; absorb (Force Shield), immunity, dodge-style and any future defensive source keep their own ability/effect identity and their own authored mitigation text (authored slot first, then their existing prose). No generic "zero damage grouped attack" is described as a shield block; an unrecognised mitigation source falls back to its own unmodified prose plus the `[N blocked]`-equivalent token for its kind.
- Folding rules in `fold-groups.ts` stay exactly as they are (same `groupId`, mitigation covers the whole attempted amount, applied damage genuinely zero). Partial mitigation, misses, dodges, immunity, natural zero damage and unrelated attacks remain unfolded. The token still renders once from `numberText`.

### B. Judgment (and every ability outcome) identity + amount
- Register `ability_crit` in `SERVER_EVENT_TYPES` / `SERVER_EVENT_TYPE_MAP` (structured type `ability`) and in `STAGE5_TYPES`, carrying **`crit: true`** all the way through decoding, event creation, presentation and styling. A critical ability hit stays visually and semantically distinct from an ordinary hit (existing `strong` / crit emphasis), while the amount still renders exactly once.
- **Canonical flavor contract preserved.** The canonical runtime slots stay `cast`, `hit`, `miss`, `activate`, `pulse`, `apply`, `tick`, `mitigate`, `retaliate`. `hit_text`, `miss_text`, `hit_verb`, `miss_verb` and any other historical keys are read as **compatibility aliases only**; new writes (seed, admin save, migration) use the canonical `hit` / `miss` keys. No second canonical contract is introduced, and unknown existing `combat_text` keys are never dropped on an admin save or a migration.
- Resolution order for `ability_hit` / `ability_crit` / `ability_miss`: exact ability-key authored flavor → ability-identity fallback table → label-based generic line **written without an inline amount**. The structured amount is then rendered once as `[N]`.
- **No prose amount parsing for registered events.** The resolver's generic sentence is not regex-stripped of `for N`; the body is rebuilt from the chain above. Legacy prose parsing remains only for genuinely legacy/unregistered events, and `ability_hit` / `ability_crit` can never reach it (enforced by the coverage test below).
- Judgment authored text: canonical `hit` / `miss` values so cast, hit and miss all read as "Judgment". Fallback when nothing is authored: `You pass divine judgment upon <Creature>!` + `[48]` token.
- Raw keys never reach the log: identity goes through `getAbilityLabel`.

### B2. Production data migration for Judgment (prepared, not applied)
- Idempotent, replayable SQL that merges canonical keys into the existing `abilities.combat_text` row for exactly `ability_key = 'judgment'` using a JSONB merge, so unrelated and unknown keys survive.
- Before/after of the row's `combat_text` value will be reported with the implementation (read-only query for the current value, plus the exact merged result).
- Created in the repo/migration draft but **not applied** in the implementation turn.


### C. Ability highlighting
- Add an `ability` family to `EventLogFamily` / `FAMILY_STYLE` (`event-log-styles.ts`) and a `.log-edge-ability` rule in `src/index.css` using the existing gold/accent token: slightly stronger gold left border, medium-weight brighter ability text, ordinary structured amount token. No emoji, badge, container or animation.
- `presentation.ts`: `ability` type with a **player** source resolves to the `ability` family; creature-sourced lines keep `threat`. Damage-type and perspective styling are untouched. A successful Judgment hit can no longer render neutral grey.

## Tests
New/extended deterministic tests (no wording asserted that the server owns):
- `raises → raise`, never `rais`; both coordinated verbs conjugated for self (`You raise … and turn …`); observer stays third person (`raises … and turns …`).
- Full mitigation still yields exactly one rendered line with one `[N blocked]` token; partial mitigation keeps both lines.
- Judgment cast resolves via exact ability key; hit uses authored flavor; miss keeps ability identity; damage renders exactly once as `[N]`; cast/hit/miss all classify as the `ability` presentation family.
- Player, party-observer and unrelated-observer perspectives stay grammatical.
- Regression guards: Holy Shield, Ignite pulse folding, ordinary autoattacks, creature attacks.

## Verification
Focused suites, full test suite, typecheck and production build. Report root cause, files changed, exact before/after rendered lines and test results. No deploy and no publish in the implementation turn.

## Files expected to change
`src/features/combat/events/perspective.ts`, `tick-event-builder.ts`, `ability-flavor.ts`, `log-event.ts`, `presentation.ts`, `src/features/combat/utils/event-log-styles.ts`, `src/features/combat/utils/ability-text.ts` (authored Judgment text via `src/shared/config/ability-seed.ts`), `src/index.css`, plus tests under `src/test/combat/` and `src/features/combat/events/__tests__/`.
