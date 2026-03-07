
## Cross-Stat & Combat System ✅ IMPLEMENTED

### Cross-Stat Bonuses (Diminishing Returns via sqrt curves)

1. **INT → Hit Bonus**: `+floor(sqrt(INT_mod))`, capped at +3. Improves attack rolls.
2. **DEX → Critical Hit Chance**: `+floor(sqrt(DEX_mod))`, capped at +4. Crit on 16-20 max.
3. **WIS → Awareness (Damage Reduction Chance)**: `sqrt(WIS_mod) × 3%`, capped at 15%. Chance to reduce incoming damage by 25%.
4. **CHA → Better Vendor Prices & Humanoid Gold**: Sell multiplier = `0.5 + sqrt(CHA_mod) × 0.03` (cap 0.8). Buy discount = `sqrt(CHA_mod) × 2%` (cap 10%). Humanoid gold = `+sqrt(CHA_mod) × 5%` (cap 25%).
5. **STR → Minimum Damage Floor**: `+floor(sqrt(STR_mod))`, capped at +3. All attacks deal at least this much.

### Attack Speed

- **Solo play**: Formula: `max(3.0 − DEX_mod × 0.25, 1.0)` seconds per attack (unchanged)
- **Party play**: Fixed 3s heartbeat tick; DEX grants multi-attack (see Server-Side Party Combat below)

### Character Panel Display

- All cross-stat bonus rows always visible; shows "–" when modifier too low
- Tooltips explain unlock thresholds (e.g. "STR 14+", "WIS 12+", "CHA 12+")

### Files Changed

- `src/lib/game-data.ts` — Helper functions: `getIntHitBonus`, `getDexCritBonus`, `getWisDodgeChance`, `getChaSellMultiplier`, `getChaBuyDiscount`, `getChaGoldMultiplier`, `getStrDamageFloor`
- `src/hooks/useCombat.ts` — Applied INT hit bonus, DEX crit range, STR damage floor, WIS awareness, CHA humanoid gold bonus, DEX attack speed
- `src/hooks/useActions.ts` — CHA humanoid gold bonus in `awardKillRewards`
- `src/components/game/VendorPanel.tsx` — CHA-based buy/sell price modifiers with UI indicators
- `src/components/game/CharacterPanel.tsx` — Shows all cross-stat bonuses in Attributes tab (always visible, "–" when inactive), attack speed display
- `src/components/admin/GameManual.tsx` — Documented all cross-stat bonuses and attack speed formula

---

## Server-Side Party Combat (Hybrid Architecture) 🔜 PLANNED

### Overview

**Goal**: Move party combat resolution to a server-authoritative edge function to eliminate race conditions, double-awards, and inconsistent state. Solo combat remains client-driven for zero-latency feel.

### Architecture Summary

| Aspect | Solo (unchanged) | Party (new) |
|---|---|---|
| Tick driver | Client `setInterval` (DEX-based speed) | Leader client calls `combat-tick` edge function every **3s** |
| Attack speed | Faster ticks = faster attacks | Fixed heartbeat; DEX mod → multi-attack per tick |
| Authority | Client resolves all damage/rewards | Edge function resolves all damage/rewards atomically |
| UI sync | Direct state updates + local overrides | Leader broadcasts tick results to party via Supabase Broadcast |
| Buff/debuff state | Client-managed (useGameLoop) | Client-managed, **reported** to server each tick via payload |

---

### DEX Multi-Attack (Party Mode)

In party mode, all members attack on the same 3s heartbeat. DEX determines attacks per tick:

| DEX Modifier | Attacks per tick |
|---|---|
| 0–2 | 1 |
| 3–4 | 2 |
| 5+ | 3 |

This replaces the solo variable-speed interval. The edge function processes N attack rolls per member based on their DEX.

---

### Edge Function: `combat-tick`

**Endpoint**: `POST /combat-tick`  
**Auth**: Bearer token (verified via `getClaims()`, must be party leader)

#### Request Payload

```typescript
interface CombatTickRequest {
  party_id: string;
  node_id: string;
  // Each member reports their current buff/debuff state
  member_buffs: Record<string, MemberBuffState>;
}

interface MemberBuffState {
  // Active buffs (client reports what's currently active)
  crit_buff?: { bonus: number };        // Eagle Eye
  stealth_buff?: boolean;                // Shadowstep (ambush bonus)
  damage_buff?: boolean;                 // Arcane Surge
  root_debuff_target?: string;           // creature_id affected by root
  root_debuff_reduction?: number;        // damage reduction %
  ac_buff?: number;                      // Battle Cry AC bonus
  poison_buff?: boolean;                 // Envenom active
  evasion_buff?: { dodge_chance: number }; // Cloak of Shadows
  ignite_buff?: boolean;                 // Ignite active
  absorb_buff?: { shield_hp: number };   // Force Shield / Divine Aegis
  sunder_target?: string;               // creature_id
  sunder_reduction?: number;            // AC reduction
  disengage_next_hit?: { bonus_mult: number }; // Disengage bonus
  focus_strike?: { bonus_dmg: number };  // Focus Strike
}
```

#### Server Logic (Pseudocode)

```
1. Verify auth → must be party leader
2. Fetch party members at node (from DB, not client)
3. Fetch alive creatures at node (from DB)
4. Determine effective tank (party.tank_id ?? party.leader_id)
5. Verify tank is at node; if not, each member takes own hits

FOR EACH alive creature at node:
  FOR EACH party member at node:
    a. Calculate attacks_this_tick = dex_multi_attack(member.dex)
    b. FOR EACH attack:
       - Roll d20 + stat_mod + INT_hit_bonus
       - Apply sunder to creature AC
       - If hit: roll damage, apply buffs (stealth ×2, arcane surge ×1.5, 
         disengage bonus, focus strike bonus, STR floor, crit ×2)
       - If hit + poison_buff: 40% chance → add poison event
       - If hit + ignite_buff: 40% chance → add ignite event
       - Apply damage to creature HP
       - If creature dies: calculate XP/gold, split among members at node,
         roll loot, insert ground loot

  CREATURE COUNTERATTACK:
    c. Target = tank (if present at node), else each member
    d. Roll d20 + creature STR mod vs target AC (+ AC buff)
    e. Apply evasion dodge chance, WIS awareness, absorb shield
    f. If hit: damage tank/member, degrade equipment
    g. If member HP ≤ 0: mark as dead in response

6. Write all state changes atomically:
   - UPDATE creatures SET hp = ... (batch)
   - UPDATE characters SET hp = ... (batch for all damaged members)
   - RPC award_party_member for each member on kills
   - INSERT node_ground_loot for drops
   
7. Return combat events array
```

#### Response Schema

```typescript
interface CombatTickResponse {
  events: CombatEvent[];
  // Final state after tick
  creature_states: { id: string; hp: number; alive: boolean }[];
  member_states: { character_id: string; hp: number; xp: number; gold: number }[];
}

type CombatEvent =
  | { type: 'attack_hit'; attacker: string; target_creature: string; damage: number; is_crit: boolean; roll: number; vs_ac: number; message: string }
  | { type: 'attack_miss'; attacker: string; target_creature: string; roll: number; vs_ac: number; message: string }
  | { type: 'creature_hit'; creature: string; target_member: string; damage: number; roll: number; vs_ac: number; message: string }
  | { type: 'creature_miss'; creature: string; target_member: string; roll: number; vs_ac: number; message: string }
  | { type: 'creature_kill'; creature: string; creature_name: string; xp_each: number; gold_each: number; killer: string }
  | { type: 'loot_drop'; item_name: string; creature_name: string }
  | { type: 'member_death'; character_id: string; character_name: string }
  | { type: 'level_up'; character_id: string; new_level: number }
  | { type: 'poison_proc'; attacker: string; creature: string }
  | { type: 'ignite_proc'; attacker: string; creature: string }
  | { type: 'absorb'; character_id: string; absorbed: number; remaining: number }
  | { type: 'evasion_dodge'; character_id: string; creature: string }
  | { type: 'wis_awareness'; character_id: string; creature: string; reduced_damage: number }
  | { type: 'buff_consumed'; character_id: string; buff: string }; // stealth, disengage, focus_strike
```

---

### Client Integration

#### Leader's Client (Tick Driver)

```typescript
// In usePartyCombat.ts (new hook, replaces useCombat for party mode)
useEffect(() => {
  if (!party || !isLeader || !inCombat) return;
  
  const tick = async () => {
    const result = await supabase.functions.invoke('combat-tick', {
      body: { party_id: party.id, node_id: currentNodeId, member_buffs: gatherBuffStates() }
    });
    
    // Broadcast results to all party members
    broadcastChannel.send({
      type: 'broadcast',
      event: 'combat_tick_result',
      payload: result.data
    });
    
    // Process events locally too
    processTickEvents(result.data.events);
  };
  
  const interval = setInterval(tick, 3000);
  tick(); // immediate first tick
  return () => clearInterval(interval);
}, [party, isLeader, inCombat]);
```

#### Non-Leader Clients (Passive Listeners)

```typescript
// Listen for tick results via broadcast
channel.on('broadcast', { event: 'combat_tick_result' }, (payload) => {
  const data = payload.payload as CombatTickResponse;
  
  // Update local creature HP from server state
  for (const cs of data.creature_states) {
    updateCreatureHp(cs.id, cs.hp);
  }
  
  // Update own character state if changed
  const myState = data.member_states.find(m => m.character_id === myCharId);
  if (myState) {
    updateCharacter({ hp: myState.hp, xp: myState.xp, gold: myState.gold });
  }
  
  // Process events for log display
  processTickEvents(data.events);
});
```

#### Broadcast Event: `combat_tick_result`

Channel: `party-broadcast-{party_id}` (existing channel from `usePartyBroadcast`)  
Event name: `combat_tick_result`  
Payload: `CombatTickResponse` (full tick result)

This replaces the current per-event broadcasts (`party_hp`, `creature_damage`, `party_reward`) during party combat. Those individual broadcasts remain for non-combat party events (regen, ability heals, etc.).

---

### What Stays Client-Side

These systems continue to run on each client independently:

1. **Buff/Debuff lifecycle** (`useGameLoop`): Regen, DoT ticking, buff expiration, death detection
2. **Ability activation** (`useActions.handleUseAbility`): Client applies the ability effect locally, updates `member_buffs` state for next tick
3. **DoT damage** (Rend, Poison, Ignite): Still client-driven ticks; the damage is applied via existing `damage_creature` RPC. The server tick only handles auto-attack damage.
4. **Movement, searching, consumables**: Unchanged
5. **Solo combat**: Unchanged (`useCombat` with variable DEX-based interval)

### What Moves Server-Side

1. **Auto-attack resolution** (rolls, damage calc, crit logic)
2. **Creature counterattacks** (target selection, damage, tank mechanics)
3. **Kill detection** (atomic — only one tick can kill a creature)
4. **Reward calculation & distribution** (XP/gold split, level-up stat grants)
5. **Loot rolling** (ground loot insertion)
6. **Equipment degradation** (on counterattack hits)

---

### Migration Path

#### Phase 1: Edge Function + Leader Driver
1. Create `combat-tick` edge function with basic auto-attack resolution
2. Create `usePartyCombat` hook that calls it on a 3s interval when in party
3. Wire up broadcast distribution of tick results
4. Keep `useCombat` for solo play — no changes needed
5. **Test**: 2-player party, verify synchronized combat, no double rewards

#### Phase 2: Full Buff Integration
1. Add buff state reporting in tick payload (`member_buffs`)
2. Edge function applies stealth, arcane surge, disengage, focus strike bonuses
3. Edge function handles absorb shields, evasion, WIS awareness
4. Edge function handles sunder debuff on creatures
5. **Test**: All class abilities work correctly in party combat

#### Phase 3: Loot & Level-Up
1. Edge function rolls loot tables, inserts ground loot
2. Edge function handles level-up logic (stat bonuses, milestone titles)
3. Edge function handles equipment degradation
4. **Test**: Full party combat lifecycle including kills, loot, level-ups

#### Phase 4: DoT Convergence (Optional)
1. Move DoT ticking server-side for consistency
2. Report active DoT stacks in tick payload
3. Edge function ticks DoTs and applies damage
4. **Decision point**: May not be worth the complexity if client DoTs work fine

---

### Risk Mitigation

| Risk | Mitigation |
|---|---|
| Edge function latency (>500ms) | Optimistic UI: show "attacking..." immediately, reconcile on response |
| Leader disconnects mid-combat | Any member can detect stale ticks (>6s gap) and promote themselves to tick driver |
| Race between DoT kill and tick kill | `damage_creature` RPC already handles `_killed` flag; advisory lock on creature_id prevents double-kill |
| Buff state desync | Server reads equipment bonuses from DB each tick; client-reported buffs are validated (expiry checked server-side) |
| Edge function cold start | First tick may be slow (~1s); subsequent ticks will be fast (~10ms) |

---

### Database Changes Required

None for Phase 1. The existing RPCs (`damage_creature`, `award_party_member`, `damage_party_member`, `degrade_party_member_equipment`) are sufficient. The edge function calls them with the service role key.

---

### Files to Create/Modify

#### New Files
- `supabase/functions/combat-tick/index.ts` — Edge function
- `src/hooks/usePartyCombat.ts` — Client hook for party combat tick driving + listening

#### Modified Files
- `supabase/config.toml` — Add `[functions.combat-tick]` with `verify_jwt = false`
- `src/pages/GamePage.tsx` — Conditional: use `usePartyCombat` when in party, `useCombat` when solo
- `src/hooks/usePartyBroadcast.ts` — Add `combat_tick_result` broadcast event type
- `src/components/admin/GameManual.tsx` — Document party vs solo combat differences
