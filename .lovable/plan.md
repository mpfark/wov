

## Salvage & Blacksmith Crafting System

### Overview
Non-humanoid creatures drop "Salvage" — a character currency (like gold). Players visit a blacksmith, choose an equipment slot, pay Salvage + Gold, and receive a randomly generated item for that slot scaled to their level.

### Database Changes

**`characters` table** — add column:
- `salvage integer NOT NULL DEFAULT 0`

**Security**: Update `restrict_party_leader_updates` trigger to lock `salvage` in the party leader path (same as `gold`), and prevent client-side increases in the owner path.

### Salvage Drop Logic

**`useActions.ts`** (`awardKillRewards`) and **`combat-tick/index.ts`**:
- After gold calc, if `!creature.is_humanoid`, roll salvage:
  - Base: `1 + floor(creature.level / 5)`
  - Rare creatures: x2, Bosses: x4
  - Split among party members (same as gold)
- Log: `🔩 You salvaged 3 materials.`

### Blacksmith Crafting UI

**`BlacksmithPanel.tsx`** — add a "Forge" tab:
- Slot picker (all equipment slots)
- Cost: `5 + level * 2` salvage, `level * 5` gold
- Rarity chances: **Common 65%, Uncommon 35%** (no Unique — unique items are world-drops only)
- "Forge" button calls `blacksmith-forge` edge function

### Edge Function: `blacksmith-forge`

1. Authenticate user, verify character ownership
2. Verify character is at a blacksmith node
3. Check salvage + gold balance
4. Deduct salvage + gold
5. Roll rarity (Common 65%, Uncommon 35%)
6. Call Lovable AI to generate item name, description, and stats for the rolled rarity/level/slot (reuse patterns from `ai-item-forge`)
7. Insert item into `items` table, then into `character_inventory`
8. Return the created item

### Props & Wiring

- Pass `salvage` into `BlacksmithPanel`, add `onSalvageChange` callback
- Add `salvage` to `Character` interface in `useCharacter.ts`
- Update `restrict_party_leader_updates` trigger for salvage security

### Files to Change

1. **Migration SQL** — add `salvage` column, update trigger
2. **`src/hooks/useCharacter.ts`** — add `salvage` to Character interface
3. **`src/hooks/useActions.ts`** — salvage drops in `awardKillRewards`
4. **`supabase/functions/combat-tick/index.ts`** — salvage drops in server combat
5. **`src/components/game/BlacksmithPanel.tsx`** — add Forge tab UI
6. **`supabase/functions/blacksmith-forge/index.ts`** — new edge function
7. **`src/pages/GamePage.tsx`** — pass salvage prop to BlacksmithPanel
8. **`src/components/game/StatusBarsStrip.tsx`** — show salvage count

