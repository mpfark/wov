# Fix duplicate offscreen DoT-kill log line for the source player

## What you saw

```
☠️ Ser Caldris ... has been slain by DoT! Cithrawiel's power transcends experience., +47 gold, +7 🏋️ BHP.
☠️ Ser Caldris ... has been slain by DoT! Your power transcends experience., +47 gold, +7 🏋️ BHP.
🌫️ The faint sound of water receding ...
```

The kill message appears twice in *your* log. The boss-death cry only fires once (correct).

## Root cause

`combat-catchup` reports an offscreen DoT kill through **two parallel paths**, and the source player's client listens to both:

1. **HTTP response → `useOffscreenDotWakeup`** — the hook that called `combat-catchup` reads `kill_rewards` from the HTTP response and emits a local log line:  
   `"☠️ Ser Caldris … Your power transcends experience. …"`

2. **`party_combat_msg` broadcast → `usePartyBroadcast` → `GamePage.processIncomingLog`** — the same edge function call also broadcasts a third-person summary on `party-broadcast-{partyId}`:  
   `"☠️ Ser Caldris … Cithrawiel's power transcends experience. …"`  
   Every party member, **including the source**, subscribes to this channel and writes the message into their own log.

Other party members at a different node only receive path (2), so they only see one line. The source player sees both.

The dedupe ref (`seenIdsRef` keyed by `entry.id = "${creatureId}:catchup"`) only guards against re-processing the same broadcast id; it does not catch the cross-path duplicate.

The boss death cry is handled correctly because the world-global broadcast and the local emit use a `nonce`-style guard at a higher layer, and the catchup hook also runs the local emit only for the source player.

## Fix

Skip the broadcast on the source player's client. The broadcast is intended for **other** party members; the source player already gets a richer, first-person line from the HTTP response.

### Edge function — `supabase/functions/combat-catchup/index.ts`

Add `source_character_id` to the `party_combat_msg` payload so the receiver can self-skip:

```ts
await partyChannel.send({
  type: 'broadcast',
  event: 'party_combat_msg',
  payload: {
    id: `${creatureId}:catchup`,
    message: summary,
    node_id: null,
    character_name: primaryChar.name || null,
    source_character_id: primarySourceId,   // NEW
  },
});
```

### Client — `src/features/party/hooks/usePartyBroadcast.ts`

Extend the `PartyCombatMsgEvent` type with the optional `source_character_id` field and skip in the listener when it matches the local character:

```ts
.on('broadcast', { event: 'party_combat_msg' }, (payload) => {
  const data = payload.payload as PartyCombatMsgEvent;
  if (!data?.id) return;
  if (data.source_character_id && data.source_character_id === characterId) return; // self-skip
  logBroadcast('in', `party`, 'party_combat_msg');
  setBroadcastLogEntries(prev => [...prev.slice(-49), data]);
})
```

That's it — the source player keeps the personal "Your power transcends…" line from the HTTP path; party-mates keep the third-person "Cithrawiel's power transcends…" line from the broadcast path. No path is removed, no duplicate remains.

## Files changed

- `supabase/functions/combat-catchup/index.ts` — add `source_character_id` to `party_combat_msg` payload (one line).
- `src/features/party/hooks/usePartyBroadcast.ts` — extend type + add self-skip guard (two lines).

## Out of scope / verified clean

- Boss death cry: only one occurrence in the log → world-global broadcast + local emit are already coordinated correctly.
- Reward XP/gold double-grant: already protected by the `rewards_awarded_at` idempotency claim added in the previous turn — no change needed there.
- `combat-tick` live kills: not affected; this path only runs in `combat-catchup`.
