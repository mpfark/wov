

# Boss Crit Flavor Events — Updated Plan (with Validation Add-On)

This merges the original approved plan with the validation/sanitization add-on into a single implementation pass.

## Database Migration

Add `boss_crit_flavors` JSONB column to `creatures`:
```sql
ALTER TABLE public.creatures
ADD COLUMN boss_crit_flavors jsonb NOT NULL DEFAULT '[]'::jsonb;
```

## Admin UI — CreatureManager.tsx

Add a collapsible "Boss Crit Flavors" section in the creature editor (after stats, before loot).

- Helper text: *"Optional. Write the flavor text as a continuation after the creature's name (e.g., 'unleashes a searing breath of fire')."*
- Each row: name, text, emoji, weight, damage_type, remove button
- "Add Flavor" button
- **On save**, sanitize before persisting:

```typescript
const sanitizedFlavors = form.boss_crit_flavors
  .map(f => ({
    name: f.name?.trim() || '',
    text: f.text?.trim() || '',
    emoji: f.emoji?.trim() || '',
    weight: Number.isFinite(f.weight) && f.weight > 0 ? f.weight : 1,
    damage_type: f.damage_type?.trim() || undefined,
  }))
  .filter(f => f.text.length > 0);
```

Update `defaultForm`, `openEdit`, and `handleSave` to include `boss_crit_flavors`.

## Server — combat-tick/index.ts

On creature crit events, validate and pick a flavor:

```typescript
const validFlavors = (creature.boss_crit_flavors || [])
  .filter(f => typeof f.text === 'string' && f.text.trim().length > 0)
  .map(f => ({
    name: (f.name || '').trim(),
    text: f.text.trim(),
    emoji: (f.emoji || '').trim(),
    weight: Number.isFinite(f.weight) && f.weight > 0 ? f.weight : 1,
    damage_type: (f.damage_type || '').trim() || undefined,
  }));

// Weighted random selection from validFlavors
// If empty, fall back to standard crit event
```

Attach `boss_flavor: { name, text, emoji, damage_type }` to the `creature_crit` event. Existing fields (message, damage, is_crit, etc.) remain unchanged.

## Client — combat-text.ts

- Add optional `boss_flavor` field to `StructuredAttackEvent`
- In `formatCreatureAttack`, if `event.is_crit && event.boss_flavor`:
  - **words**: `${emoji} ${attacker} ${text}!` (with "you" or target name)
  - **both**: `${emoji} ${attacker} ${text} [${damage}]!`
  - **numbers**: fall through to existing `event.message`
- `damage_type` is passed through but not used for any combat logic:
```typescript
// `damage_type` is stored for future extensibility (e.g., resistances or UI),
// but has no effect on combat mechanics in the current implementation.
```

## Files Changed

| File | Change |
|------|--------|
| Migration SQL | Add `boss_crit_flavors` JSONB column |
| `src/components/admin/CreatureManager.tsx` | Flavor editor UI + sanitization on save |
| `supabase/functions/combat-tick/index.ts` | Validate flavors, weighted pick, enrich crit event |
| `src/features/combat/utils/combat-text.ts` | Format boss-flavored crits in display modes |

## Not Changed

- Crit chance, crit damage, hit quality, combat formulas
- Server authority, tick rate, loot, boss balance
- No new tables, no schema redesign beyond the one column

