
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

## Server-Side Party Combat (Hybrid Architecture) ✅ COMPLETE

### Overview

Party combat resolution runs on a server-authoritative edge function (`combat-tick`) to eliminate race conditions, double-awards, and inconsistent state. Solo combat remains client-driven for zero-latency feel.

### Final Architecture

| Aspect | Solo (unchanged) | Party (server-authoritative) |
|---|---|---|
| Tick driver | Client `setInterval` (DEX-based speed) | Leader client calls `combat-tick` edge function every **3s** |
| Attack speed | Faster ticks = faster attacks | Fixed heartbeat; DEX mod → multi-attack per tick |
| Authority | Client resolves all damage/rewards | Edge function resolves all damage/rewards atomically |
| UI sync | Direct state updates + local overrides | Leader broadcasts tick results to party via Supabase Broadcast |
| Buff/debuff state | Client-managed (useGameLoop) | Client-managed; **all members** broadcast buff state every 2.5s; leader aggregates into `member_buffs` payload |
| DoT state | Client ticks DoTs locally | **All members** broadcast DoT state every 2.5s; leader aggregates into `member_dots` payload; server resolves DoT damage |

---

### What the Edge Function Handles (Server-Side)

1. **Auto-attack resolution** — d20 rolls, damage calc, crit logic, DEX multi-attack
2. **Offensive buffs** — Stealth (×2), Arcane Surge (×1.5), Focus Strike (flat bonus), Disengage (bonus mult), Sunder (AC reduction), Poison/Ignite procs (40% chance)
3. **Defensive buffs** — AC buffs (Battle Cry), Evasion (dodge chance), Absorb shields (Force Shield/Divine Aegis), WIS Awareness (25% damage reduction)
4. **Creature counterattacks** — Target selection (tank priority), damage, Root debuff reduction
5. **Kill detection** — Atomic; only one tick can kill a creature
6. **Reward calculation & distribution** — XP/gold split via `award_party_member` RPC, level-up stat grants
7. **Loot rolling** — Weighted loot table selection, unique item checks via `try_acquire_unique_item`, ground loot insertion
8. **Equipment degradation** — 25% chance per counterattack hit via `degrade_party_member_equipment` RPC
9. **DoT ticking** — Bleed, Poison, Ignite damage per tick; DoT kills award rewards and clear client-side stacks via `cleared_dots` response
10. **One-shot buff consumption** — Returns `consumed_buffs` so clients clear stealth, focus_strike, disengage locally

### What Stays Client-Side

1. **Buff/Debuff lifecycle** (`useGameLoop`): Regen, buff expiration, death detection
2. **Ability activation** (`useActions.handleUseAbility`): Client applies ability effect locally, reports state to server next tick
3. **DoT state management**: Client maintains DoT stacks locally; non-leaders broadcast state to leader; server resolves damage
4. **Movement, searching, consumables**: Unchanged
5. **Solo combat**: Unchanged (`useCombat` with variable DEX-based interval)

---

### Communication Flow

```
Non-leader clients ──(broadcast: member_buff_state every 2.5s)──► Leader client
Non-leader clients ──(broadcast: member_dot_state every 2.5s)───► Leader client
                                                                       │
Leader client ──(POST /combat-tick with member_buffs + member_dots)──► Edge Function
                                                                       │
Edge Function ──(response: events, creature_states, member_states)──► Leader client
                                                                       │
Leader client ──(broadcast: combat_tick_result)──► All party members
                                                       │
All members: update local HP, XP, gold, creature HP, clear consumed buffs/dots
```

---

### Implementation Phases — All Complete

#### Phase 1: Edge Function + Leader Driver ✅
- Created `combat-tick` edge function with full auto-attack resolution, counterattacks, kill detection, XP/gold/loot
- Created `usePartyCombat` hook with 3s leader heartbeat and broadcast distribution
- Wired `GamePage` to use `usePartyCombat` when in party, `useCombat` when solo

#### Phase 2: Full Buff Integration ✅
- All members report `member_buffs` via `gatherBuffs` callback; non-leaders broadcast every 2.5s, leader aggregates
- Edge function applies all offensive buffs (stealth, arcane surge, disengage, focus strike, sunder, poison/ignite procs)
- Edge function applies all defensive buffs (AC buff, evasion, absorb shields, WIS awareness)
- Returns `consumed_buffs` for one-shot buff cleanup on all clients (leader + non-leaders)

#### Phase 3: Loot & Level-Up ✅
- Loot rolling with weighted tables and unique item checks implemented in Phase 1
- Level-up logic with stat bonuses and respec points implemented in Phase 1
- Equipment degradation (25% chance per hit) implemented in Phase 1

#### Phase 4: Server-Side DoT Ticking ✅
- All members broadcast DoT state (bleed, poison, ignite) every 2.5s via `member_dot_state` broadcast
- Leader aggregates all members' DoT stacks into `member_dots` payload
- Edge function resolves DoT damage, handles DoT kills with reward splitting
- Returns `cleared_dots` so all clients remove stale DoT timers
- `useGameLoop` suppresses local DoT ticking when `inParty` is true

---

### Files Created/Modified

#### New Files
- `supabase/functions/combat-tick/index.ts` — Server-authoritative combat edge function
- `src/hooks/usePartyCombat.ts` — Client hook for party combat (leader tick driver + non-leader listener + DoT broadcast)

#### Modified Files
- `src/pages/GamePage.tsx` — Conditional: `usePartyCombat` when in party, `useCombat` when solo; `gatherBuffs`/`gatherDotStacks` callbacks; `onConsumedBuffs`/`onClearedDots` handlers
- `src/hooks/useGameLoop.ts` — Added `inParty` flag to suppress local DoT ticking during party combat
