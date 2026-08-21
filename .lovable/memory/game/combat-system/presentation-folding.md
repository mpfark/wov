---
name: Combat Log Presentation Folding
description: groupId correlation, full-mitigation folding rules, perspective markers, and numberText token ownership in the combat log
type: feature
---

The committed batch NEVER merges events. Folding is presentation-only.

**Correlation (`groupId`)** — stamped by the pure resolver:
- stance pulse + the stack it landed: `pulse|<tick>|<abilityKey>|<attacker>|<creature>`
- one creature swing + its mitigation: `swing|<tick>|<creature>|<target>|<swingCounter>`
  (per-swing counter so two blows in one tick never cross-match)

Mitigation triple on both members: `attemptedAmount`, `mitigatedAmount`, `appliedAmount`, plus `mitigationSource`.

**Fold rules** (`src/features/combat/events/fold-groups.ts`):
- pulse + stack fold only when pulse damage > 0; a stack with no damaging pulse keeps its own line.
- a landed creature hit folds into its mitigation only when `appliedAmount === 0` and `mitigatedAmount >= attemptedAmount > 0`. Misses, dodges, partial mitigation and natural zero damage are never folded.

**Number ownership** — a folded line renders one `numberText` token (`[7, Ignite 3/5]`, `[18 blocked]`) which REPLACES `amount`. A template that writes `{damage}` itself owns the number and no token is added.

**Perspective** (`src/features/combat/events/perspective.ts`) — the local name becomes a positional marker; case is decided by position (sentence start → `You`/`Your`, elsewhere → `you`/`your`) and the subject verb is conjugated. No global capitalisation pass.

Ability identity precedence for cast flavor: authored text → ability key table → mechanic table. Ability keys (e.g. `fireball`) always live in `ABILITY_FLAVOR`, never the mechanic table.
