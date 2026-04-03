

# Combat Text Formatting System (Revised)

## Revisions Applied

1. **Player attack style priority** reordered: explicit attack style → equipped weapon type → class fallback → generic
2. **Creature verb mapping** clarified as lightweight fallback only, not an archetype system
3. **Impact tier words** cleaned to avoid overlap with attack-style verbs

## Files

| File | Action | Owns |
|------|--------|------|
| `supabase/functions/combat-tick/index.ts` | Modify | Add structured fields to attack/creature hit events |
| `src/features/combat/utils/combat-text.ts` | Create | Attack style resolution, damage tier naming, MUD text generation |
| `src/features/combat/utils/interpretCombatTickResult.ts` | Modify | Call combat-text formatter for structured events |
| `src/features/combat/components/EventLogPanel.tsx` | Modify | Add display mode toggle UI |

## Key Design Details

### Player Attack Style Resolution (revised priority)

1. **Explicit attack/autoattack style** — e.g. wizard autoattack = fireball verbs ("scorch", "hurl a fireball at"). Overrides everything.
2. **Equipped weapon type** — server includes `weapon_tag` in event. Mapping: bow → "shoot" / "loose an arrow at"; sword → "slash" / "cut"; dagger → "stab" / "pierce"; mace/hammer → "smash" / "crush"; staff → "strike"; unarmed → "punch" / "strike".
3. **Class fallback** — `CLASS_COMBAT` verb sets used only when no attack style or weapon info available.
4. **Generic fallback** — "strike", "attack".

Server event enrichment adds `weapon_tag` (already available from equipment query) alongside `attacker_class` so the client has both.

### Creature Verb Mapping (clarified)

Lightweight name-keyword map, NOT a creature archetype system:
- Name match: wolf → "bites"; troll → "smashes"; spider → "stings"
- `is_humanoid` fallback: "slashes", "strikes"
- Generic fallback: "attacks", "strikes"

No expansion into classification taxonomy.

### Impact Tier Words (revised — no verb overlap)

| Range | Tier |
|-------|------|
| 0 | miss |
| 1-5 | graze |
| 6-15 | nick |
| 16-30 | hit |
| 31-50 | wound |
| 51-80 | maul |
| 81-120 | crush |
| 121-180 | devastate |
| 181-250 | annihilate |
| 251+ | obliterate |

These describe **impact strength only** — no overlap with attack-style verbs like slash/stab/shoot.

### Display Modes

- **Numbers**: existing `message` string unchanged
- **Words**: `"⚔️ You slash the wolf."` (no numbers)
- **Both** (default): `"⚔️ You devastate the wolf [154]."`

Toggle in EventLogPanel header, stored in `localStorage`.

### Server Event Enrichment (`combat-tick/index.ts`)

Add optional structured fields to auto-attack hit/miss/crit events:
- `attacker_name`, `target_name`, `attacker_class`, `weapon_tag`, `damage`, `is_crit`, `character_id`
- Creature hits add: `is_humanoid`, `creature_id`
- Existing `message` kept as fallback. Non-attack events (abilities, DoTs, buffs, kills) unchanged.

### Client Integration (`interpretCombatTickResult.ts`)

In log formatting loop: if event has structured combat data, call `formatCombatEvent()` instead of raw `message`. Display mode passed as parameter from `localStorage`. Name→"You" substitution still applies after formatting.

## What Does NOT Change

- Combat formulas, damage values, tick rate, server authority
- Prediction/reconciliation rules, combat architecture
- Equipment systems, creature data model
- Log color mapping, non-attack event messages

