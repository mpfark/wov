

# Refactor Combat Text to Tier + Flavor Sentence Structure (Revised)

## Revisions Applied

1. **Flavor text tables** revised to avoid echoing the tier word (e.g. "wound… wound" → "wound… drawing blood")
2. **Conjugation helper** added for third-person subjects instead of naive `+ "s"`

## Changes

### 1. `src/features/combat/utils/combat-text.ts`

**Add** refined flavor text tables:

```typescript
const DAMAGE_FLAVOR: Record<string, string[]> = {
  graze: ["barely scratching it", "just nicking it"],
  nick: ["leaving a small mark", "scratching its surface"],
  hit: ["landing a solid blow", "striking firmly"],
  wound: ["drawing blood", "opening a clear wound"],
  maul: ["tearing into it", "ripping through its defenses"],
  crush: ["hitting with great force", "battering it"],
  devastate: ["leaving it reeling", "dealing devastating damage"],
  annihilate: ["leaving it shattered", "nearly destroying it"],
  obliterate: ["utterly overwhelming it", "almost destroying it"],
};

const DAMAGE_FLAVOR_YOU: Record<string, string[]> = {
  graze: ["barely scratching you", "just nicking you"],
  nick: ["leaving a small mark on you", "scratching you"],
  hit: ["landing a solid blow on you", "striking you firmly"],
  wound: ["drawing blood", "opening a clear wound"],
  maul: ["tearing into you", "ripping through your defenses"],
  crush: ["hitting you with great force", "battering you"],
  devastate: ["leaving you reeling", "dealing devastating damage"],
  annihilate: ["leaving you shattered", "nearly breaking you"],
  obliterate: ["utterly overwhelming you", "almost destroying you"],
};
```

**Add** conjugation helper:

```typescript
function conjugateTierWord(word: string): string {
  if (word.endsWith('e')) return word + 's';       // graze→grazes, annihilate→annihilates, obliterate→obliterates
  if (word.endsWith('sh') || word.endsWith('ch'))   // crush→crushes
    return word + 'es';
  return word + 's';                                // hit→hits, maul→mauls, wound→wounds, nick→nicks
}
```

Used in `formatCreatureAttack` and other-player paths instead of `tierWord + "s"`.

**Rewrite `formatPlayerAttack`** — new pattern:

- Miss: `{emoji} You miss {target}.`
- Hit: `{emoji} You {tierWord} {target}, {flavor} [dmg].`
- Crit: same but `!` punctuation, pick from stronger flavor variants

**Rewrite `formatCreatureAttack`** — same tier + flavor pattern:

- Miss: `{creature} misses you.`
- Hit: `{creature} {conjugated tierWord} you, {flavor_you} [dmg].`
- Crit: `!` punctuation

**Remove from sentence construction** (keep exports for future use):
- `resolvePlayerAttackVerb` — no longer called in formatting
- `resolveCreatureAttackVerb` — no longer called in formatting
- `CRITICAL!` prefix logic — removed entirely

**Keep unchanged**: `getDamageTierWord`, `DAMAGE_TIERS`, display mode logic, `getEventEmoji`, `StructuredAttackEvent` interface.

### 2. `src/features/combat/utils/interpretCombatTickResult.ts`

Remove the `(?:CRITICAL!\s*)?` portion from the name→"You" regex since that prefix no longer exists.

### 3. No other files change

## Sentence Construction Rules

| Case | Pattern |
|------|---------|
| Player hit | `{emoji} You {tierWord} {target}, {flavor_it} [dmg].` |
| Player crit | `{emoji} You {tierWord} {target}, {flavor_it} [dmg]!` |
| Player miss | `{emoji} You miss {target}.` |
| Creature hit | `{creature} {conjugated} you, {flavor_you} [dmg].` |
| Creature crit | `{creature} {conjugated} you, {flavor_you} [dmg]!` |
| Creature miss | `{creature} misses you.` |
| Other player hit | `{name} {conjugated} {target}, {flavor_it} [dmg].` |

## What Does NOT Change

- Combat math, damage values, tick rate, server authority
- Prediction/reconciliation
- Non-attack events (abilities, DoTs, buffs, kills, level-ups)
- Display mode toggle logic, event emoji prefixes, log color mapping

