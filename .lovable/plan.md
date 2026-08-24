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
- Folding rules in `fold-groups.ts` stay exactly as they are (same `groupId`, mitigation covers the whole attempted amount, applied damage genuinely zero). Partial mitigation, misses, dodges, immunity, natural zero damage and unrelated attacks remain unfolded. `[N blocked]` still renders once from `numberText`.

### B. Judgment (and every ability outcome) identity + amount
- Register `ability_crit` in `SERVER_EVENT_TYPES`, map it to the `ability` structured type with `crit: true`, and add it to `STAGE5_TYPES` so it can never fall into the legacy path again. Audit the resolver's emitted type list against `SERVER_EVENT_TYPES` and close any other gap found the same way.
- Extend the flavor contract (`ability-flavor.ts` `FLAVOR_SLOT`, `tick-event-builder.ts` `FLAVOR_SPEC`) with `hit_text` / `miss_text` slots so `ability_hit`, `ability_crit` and `ability_miss` resolve authored text by **exact `abilityKey` first**, then the ability-key identity table, then a label-based generic line — mechanic text last.
- Author Judgment's hit/miss text (seed `combat_text`) so cast, hit and miss share the readable identity "Judgment". Fallback when nothing is authored: `You pass divine judgment upon <Creature>! [48]`.
- Strip the server fallback's inline `for N.` when the structured amount is present, so the number renders exactly once as `[48]` — never both. Templates that write `{damage}` themselves keep owning the number (existing `statesAmount` rule).
- Raw keys never reach the log: identity goes through `getAbilityLabel`.

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
