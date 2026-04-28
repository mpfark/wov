## Refactor: admin-users → use shared HP/CP/MP helpers

### Goal
Replace all three inlined resource-cap formulas (HP, CP, MP) in `supabase/functions/admin-users/index.ts` with the canonical helpers from `supabase/functions/_shared/formulas/resources.ts`. Eliminates drift risk if any cap formula changes.

### Changes (one file)

**`supabase/functions/admin-users/index.ts`**

1. Add import at top:
   ```ts
   import { getMaxHp, getMaxCp, getMaxMp } from "../_shared/formulas/resources.ts";
   ```
   (Helpers already exist and are the canonical owners; SQL `sync_character_resources()` mirrors them.)

2. **Set-level path (around lines 240–252)** — replace the inlined HP/CP/MP block:
   ```ts
   const conMod = Math.floor((updates.con - 10) / 2);
   const newMaxHp = baseHP + conMod + (new_level - 1) * 5;
   updates.max_hp = newMaxHp;
   updates.hp = newMaxHp;
   const wisMod = Math.max(Math.floor((updates.wis - 10) / 2), 0);
   updates.max_cp = 30 + (new_level - 1) * 3 + wisMod * 6;
   updates.cp = updates.max_cp;
   const dexMod = Math.max(Math.floor((updates.dex - 10) / 2), 0);
   updates.max_mp = 100 + dexMod * 10 + Math.floor((new_level - 1) * 2);
   updates.mp = updates.max_mp;
   ```
   with:
   ```ts
   updates.max_hp = getMaxHp(char.class, updates.con, new_level);
   updates.hp = updates.max_hp;
   updates.max_cp = getMaxCp(new_level, updates.wis);
   updates.cp = updates.max_cp;
   updates.max_mp = getMaxMp(new_level, updates.dex);
   updates.mp = updates.max_mp;
   ```
   (Drops the now-unused local `baseHP`/`conMod`/`wisMod`/`dexMod`. The existing `char.class` lookup that fed `baseHP` is what `getMaxHp` reads via `CLASS_BASE_HP`.)

3. **Grant-XP path (around lines 380–391)** — replace the `grantFinal*` / `grant*Mod` / `grantMaxCp` / `grantMaxMp` inlines (and the matching HP block just above) with:
   ```ts
   const grantFinalCon = (char as any).con + (statIncreases.con || 0);
   const grantFinalWis = (char as any).wis + (statIncreases.wis || 0);
   const grantFinalDex = (char as any).dex + (statIncreases.dex || 0);
   const grantMaxHp = getMaxHp((char as any).class, grantFinalCon, newLevel);
   const grantMaxCp = getMaxCp(newLevel, grantFinalWis);
   const grantMaxMp = getMaxMp(newLevel, grantFinalDex);
   const updates: Record<string, any> = {
     xp: newXp, level: newLevel,
     max_hp: grantMaxHp, hp: grantMaxHp,
     max_cp: grantMaxCp, cp: grantMaxCp,
     max_mp: grantMaxMp, mp: grantMaxMp,
     unspent_stat_points: (char as any).unspent_stat_points + statPoints,
   };
   ```

4. **Reset/respec path (around lines 480–488)** — replace the inlined `resetWisMod` / `newMaxCp` (plus any sibling HP/MP recompute on this path) with:
   ```ts
   const newMaxHp = getMaxHp(char.class, baseStats.con ?? 10, char.level);
   const newMaxCp = getMaxCp(char.level, baseStats.wis ?? 10);
   const newMaxMp = getMaxMp(char.level, baseStats.dex ?? 10);
   const { error } = await adminClient.from("characters").update({
     ...baseStats,
     unspent_stat_points: newUnspent,
     max_hp: newMaxHp, hp: newMaxHp,
     max_cp: newMaxCp, cp: newMaxCp,
     max_mp: newMaxMp, mp: newMaxMp,
   }).eq("id", character_id);
   ```
   (If reset currently only touches CP, I'll keep it CP-only to avoid scope creep — confirmed during implementation by re-reading the surrounding block.)

### Behavior change
None. The shared helpers are numerically identical to the inlined math today. This is a pure de-duplication so the next formula change touches one file (+ SQL mirror) instead of four.

### Out of scope
- No DB migration.
- No UI / client changes.
- HP/MP/CP regen logic (separate path, lives in combat-tick / useGameLoop).

### Verification
- Edge function auto-deploys.
- Spot-check at L10 / WIS 14 / DEX 14 / CON 14: `max_cp = 69`, `max_mp = 138`, `max_hp = base + 2 + 45` — same as before.
