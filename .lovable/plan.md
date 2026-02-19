

## Fix Party Synchronization: HP, XP/Gold, and Loot Distribution

### Problems Identified

1. **HP changes not visible between party members**: The realtime subscription triggers a full `fetchParty()` which does 3-4 sequential database queries. This is slow and can miss rapid updates. Additionally, the `fetchParty` function replaces all member data at once, which can cause visual flickering.

2. **XP/Gold not shared**: The fresh query fix from the previous change should work, but there may be a timing issue -- the `award_party_member` RPC requires the caller to be an accepted party mate, and the RPC checks use `auth.uid()`. This should be fine. However, the DB logs show an error: **"invalid input syntax for type uuid: undefined"**, meaning somewhere a value of `undefined` is being passed as a UUID. This could be corrupting the award flow.

3. **Loot not always distributed by leader**: Currently, the loot dialog only appears on the **killer's** screen (whoever lands the killing blow). Any party member can kill a creature, so any member can get the loot dialog -- not just the leader. This is a design issue.

### Plan

#### 1. Add polling fallback for party member data (src/hooks/useParty.ts)
- Keep the realtime subscriptions as the primary mechanism
- Add a lightweight polling fallback (every 3 seconds) that re-fetches party member HP/level/node data
- Use exponential backoff when no changes are detected (up to 10s)
- This ensures HP/XP/gold updates are always visible within a few seconds, even if realtime misses events

#### 2. Optimize fetchParty to do targeted member updates (src/hooks/useParty.ts)
- Add a separate `fetchMemberStats()` function that only queries party member character data (HP, level, XP, gold, node)
- Use this lighter function for the polling and character update subscriptions instead of the full `fetchParty()` which also re-queries party structure and pending invites
- This reduces DB load and makes updates faster

#### 3. Guard against undefined UUIDs in combat (src/hooks/useCombat.ts)
- Add a guard check before calling `award_party_member` to ensure `character_id` is a valid string
- Add a guard on the fresh party members query to ensure `party.id` is defined
- This prevents the "invalid input syntax for type uuid: undefined" database error

#### 4. Restrict loot dialog to party leader (src/pages/GamePage.tsx)
- When a creature is killed and there are party members at the same node, only show the loot distribution dialog if the killer is the party leader
- If a non-leader kills a creature, use the existing round-robin distribution automatically instead of showing the dialog
- This ensures the leader always controls equipment distribution

### Technical Details

**Polling fallback in useParty.ts:**
```text
// New lightweight function that only refreshes member character data
const fetchMemberStats = async () => {
  if (!party) return;
  const { data } = await supabase
    .from('party_members')
    .select('id, character_id, status, is_following, character:characters(id, name, race, class, level, hp, max_hp, current_node_id)')
    .eq('party_id', party.id)
    .eq('status', 'accepted');
  if (data) setMembers(data as unknown as PartyMember[]);
};

// Polling effect with backoff
useEffect(() => {
  if (!party) return;
  let interval = 3000;
  let timeoutId: ReturnType<typeof setTimeout>;
  let active = true;
  const poll = () => {
    fetchMemberStats();
    if (active) timeoutId = setTimeout(poll, interval);
  };
  timeoutId = setTimeout(poll, interval);
  return () => { active = false; clearTimeout(timeoutId); };
}, [party?.id]);
```

**UUID guard in useCombat.ts:**
```text
if (_party?.id) {
  // ... fresh query
}
// And before each award:
if (m.character_id && m.character_id !== 'undefined') {
  // ... call RPC
}
```

**Loot leader restriction in GamePage.tsx:**
```text
// Only show loot dialog for leader; non-leaders auto-distribute via round-robin
if (equipmentDrops.length > 0 && hasPartyAtNode) {
  if (isLeader) {
    setPendingLoot({ loot: equipmentDrops, creatureName });
  } else {
    // Auto round-robin for non-leaders
    for (let i = 0; i < equipmentDrops.length; i++) {
      const drop = equipmentDrops[i];
      const recipient = sameNodeMembers[i % sameNodeMembers.length];
      // ... insert logic
    }
  }
}
```

### Files to Modify
- **src/hooks/useParty.ts** -- Add polling fallback, optimize member refresh
- **src/hooks/useCombat.ts** -- Guard against undefined UUIDs
- **src/pages/GamePage.tsx** -- Restrict loot dialog to party leader

