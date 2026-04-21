

## On-Hit Proc System for Unique Items

Add a generic proc-on-hit system stored as item data, processed in combat-tick, and authored in the admin Item Editor. Unique items only.

### Data Model

Add a `procs` jsonb column to the `items` table. Default `'[]'::jsonb`. Each entry is a self-describing effect:

```json
[
  {
    "type": "lifesteal",
    "chance": 0.10,
    "value": 5,
    "emoji": "💚",
    "text": "drains life from"
  }
]
```

**Supported proc types at launch:**

| Type | Effect | Value meaning |
|---|---|---|
| `lifesteal` | Heal attacker for flat HP on hit | HP restored |
| `fire_damage` | Bonus fire damage on hit | Extra damage |
| `frost_damage` | Bonus frost damage on hit | Extra damage |
| `lightning_damage` | Bonus lightning damage on hit | Extra damage |
| `weaken` | Reduce target's next attack damage by % | Reduction % (e.g. 0.25 = 25%) |
| `heal_pulse` | Small self-heal on hit | HP restored |

Each proc has a `chance` (0.0–1.0), a `value`, and cosmetic fields (`emoji`, `text`) for the combat log message.

### Schema Migration

```sql
ALTER TABLE items ADD COLUMN procs jsonb NOT NULL DEFAULT '[]'::jsonb;
```

### Combat-Tick Changes

**File:** `supabase/functions/combat-tick/index.ts`

After a successful player hit (main-hand and off-hand), iterate the equipped weapon's `procs` array. For each entry, roll `Math.random() < proc.chance`. On success, apply the effect based on `type`:

- `lifesteal` / `heal_pulse`: `mHp[memberId] = Math.min(mHp[memberId] + proc.value, member.c.max_hp)`
- `fire_damage` / `frost_damage` / `lightning_damage`: `cHp[target.id] = Math.max(cHp[target.id] - proc.value, 0)` (with kill check)
- `weaken`: push a combat event (visual only for now; a full debuff system can be added later)

Emit a log event: `{proc.emoji} {charName}'s weapon {proc.text} {targetName}! ({proc.value} {label})`

**Equipment loading** (line ~238): extend the equipment query to include `procs` alongside `stats, weapon_tag, hands`. Store procs per character in a `memberProcs` map.

### Admin UI: Proc Editor

**File:** `src/components/admin/ItemManager.tsx`

Add a "Procs" section in the item editor, visible only when `rarity === 'unique'`. UI:

- List of current procs with type dropdown, chance slider (0–100%), value input, emoji input, text input
- Add/remove buttons
- Saved as part of the normal item save flow

### Item Interface Update

**File:** `src/components/admin/ItemManager.tsx` (Item interface, line 14)

Add `procs: { type: string; chance: number; value: number; emoji: string; text: string }[]` to the interface. Update `defaultForm` to include `procs: []`.

### Client-Side Display

No immediate client UI changes needed beyond the combat log messages. The proc effects will show up as combat log events with their custom emoji and text, making each unique weapon feel distinct.

### Files Changed

1. **Migration** — add `procs` column to `items`
2. **`supabase/functions/combat-tick/index.ts`** — load procs from equipment, roll after hits, apply effects
3. **`src/components/admin/ItemManager.tsx`** — add proc editor UI for unique items, update Item interface
4. **`src/integrations/supabase/types.ts`** — auto-updated after migration

### Out of Scope

- Common/uncommon/soulforged items (unique only per your choice)
- Proc effects on creature attacks (only player weapons)
- Persistent debuffs from procs (weaken is log-only initially; can wire into `active_effects` later)
- AI Forge auto-generating procs (manual admin authoring only for now)

