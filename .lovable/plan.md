

## Unified Global Broadcast Channel + Death Cries

### Goal

Replace the one-off `marketplace-global` channel with a single `world-global` channel that any feature can publish to. Add player **death cries** (auto-broadcast on death) and **boss death cries** (admin-authored, broadcast when a boss creature is killed). Every online player sees these in their event log in real time.

### Channel Design

One Supabase Realtime broadcast channel: **`world-global`**.

Event shape (single event type, discriminated by `kind`):
```ts
{
  event: 'world',
  payload: {
    kind: 'market_listed' | 'player_death' | 'boss_death',
    icon: string,        // emoji to prepend (📜, 💀, 👑)
    text: string,        // pre-formatted, ready-to-display
    actor?: string,      // sender's character name (for self-skip)
    nonce?: string,      // dedupe key
  }
}
```

A small helper hook centralizes subscribe/publish so features don't each manage their own channel:

```ts
// src/hooks/useGlobalBroadcast.ts
export function useGlobalBroadcastSender() { … }   // returns send(payload)
export function useGlobalBroadcastListener(onMsg) { … } // subscribes once
```

### Files Changed

| File | Change |
|---|---|
| `src/hooks/useGlobalBroadcast.ts` | **New** — singleton-style channel manager with `useGlobalBroadcastSender` + `useGlobalBroadcastListener`. One channel reused across features. |
| `src/pages/GamePage.tsx` | Replace the marketplace-only effect with `useGlobalBroadcastListener`. Route incoming `kind` to `addLocalLog` (skip self via `actor === character.name`). Add a sender ref and call it from the new player-death effect (see below). |
| `src/features/marketplace/components/MarketplacePanel.tsx` | Replace the inline `supabase.channel('marketplace-global')` send with `useGlobalBroadcastSender().send({ kind: 'market_listed', icon: '📜', text: 'X lists Y for Z gold.', actor: characterName })`. |
| `src/features/combat/hooks/useGameLoop.ts` | In the death-detection effect, after `setIsDead(true)` fire a global broadcast: `📜 Death: <name> has fallen at <region/area>.` Use the existing bus or pass a `broadcastDeath` callback param to keep the hook side-effect-free; emit via `useGameEvent` `'player:death'` is already declared — just wire a listener in `GamePage` that publishes to global. |
| `src/pages/GamePage.tsx` (death wire) | Subscribe `useGameEvent(bus, 'player:death', …)` (already emitted shape compatible) → call `globalSend({ kind: 'player_death', icon: '💀', text: '<name> has fallen.', actor: name })`. Also append the *receiver* path so others see it. |
| `supabase/functions/combat-tick/index.ts` | In `handleCreatureKill`, when `creature.rarity === 'boss'` and `creature.boss_death_cry` is non-empty, push a new event `{ type: 'boss_death_cry', message: <text>, creature_id }` into the `events` array returned to the client. |
| `src/features/combat/utils/interpretCombatTickResult.ts` | Recognize the new `boss_death_cry` event type and surface it as a top-level field `bossDeathCries: { creatureName: string; text: string }[]` in `TickInterpretation`. |
| `src/features/combat/hooks/usePartyCombat.ts` | When processing tick result, forward each `bossDeathCries` entry to a callback prop `onBossDeathCry` (added to `UsePartyCombatParams`). |
| `src/pages/GamePage.tsx` | Pass `onBossDeathCry` that publishes to `world-global` with `kind: 'boss_death'`, icon `'👑'`, and the text. |
| `src/components/admin/CreatureManager.tsx` | New form field `boss_death_cry` (single textarea, `%a` = killer placeholder optional, default empty). Only shown when `rarity === 'boss'`. Persisted to `creatures.boss_death_cry`. |
| `supabase/migrations/<ts>_boss_death_cry.sql` | `ALTER TABLE public.creatures ADD COLUMN boss_death_cry text NOT NULL DEFAULT '';` |

### Event Texts

- **Marketplace listed**: `📜 Market: <seller> lists <item> for <price> gold.`
- **Player death**: `💀 <name> has fallen.` (region/area appended only if cheap to compute; otherwise plain)
- **Boss death**: `👑 <bossName>: "<deathCry>"` — the admin-authored line is the centerpiece. If the cry contains `%a` it's substituted with the killer's name (resolved server-side from the kill context already available in `handleCreatureKill`).

### Self-Echo Handling

The receiver in `GamePage` skips messages where `actor === character.name`. The marketplace already adds a local "You list…" line on success (kept). For player death, the dying player already sees the death overlay + "You have fallen" log, so the global echo is suppressed for the dier. Boss death cries are broadcast by the party leader / solo player; everyone (including the killer) sees them — they are flavor, not actor-attributable.

### Data Flow Diagrams

```text
Marketplace list:
 Player A → list_unique_item RPC → success
        → useGlobalBroadcastSender.send({kind:'market_listed', ...})
            → world-global channel
                → all clients' useGlobalBroadcastListener
                   → addLocalLog("📜 Market: A lists Sword for 500 gold.")

Player death:
 useGameLoop detects hp ≤ 0 → emit bus 'player:death'
   → GamePage listener → globalSend({kind:'player_death', actor:name, ...})
       → world-global → all other players see "💀 A has fallen."

Boss death:
 combat-tick handleCreatureKill (rarity=boss, boss_death_cry!='')
   → events.push({type:'boss_death_cry', message, creature_id})
     → interpretCombatTickResult → bossDeathCries[]
       → usePartyCombat → onBossDeathCry callback
         → GamePage → globalSend({kind:'boss_death', icon:'👑', text})
           → world-global → everyone sees "👑 Bone Tyrant: 'You will join my army!'"
```

### Not Changed

- Existing per-node channel (`useNodeChannel`), party broadcast channel, whisper channels — all stay independent. `world-global` is additive.
- `boss_crit_flavors` column / behavior — death cry is a separate field and a separate trigger (kill, not crit).
- Marketplace RPCs, listing rules, escrow, 12h expiry — unchanged.
- Death respawn / gold-loss logic — unchanged; only adds a broadcast emission.
- No realtime DB publication changes needed (this is broadcast, not `postgres_changes`).

### Success Criteria

- Listing an item produces one `📜 Market: …` line in every other online player's event log within ~1s; the lister sees their existing local "You list…" line only.
- Any player's death produces one `💀 <name> has fallen.` line for every other online player; the dier still sees their local death log + overlay.
- Killing a boss with a non-empty `boss_death_cry` produces one `👑 <bossName>: "<cry>"` line for every online player (including the killer / party). Bosses with empty cry produce nothing.
- Admin can add/edit `boss_death_cry` per boss in the Creature Manager (only visible when rarity is `boss`).
- Removing the old `marketplace-global` channel doesn't drop any messages — the unified channel handles them.

