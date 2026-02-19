

## Fix Party XP/Gold Sharing and HP Sync

### Problem
XP and gold from kills are not being shared with party members. The root cause is that the combat tick uses a `partyMembersRef` that can have stale `current_node_id` data for party members. When the node IDs don't match (due to stale data), the code thinks nobody else is at the same location, so it skips sharing entirely.

Additionally, party member HP updates are not reliably visible in real-time because the party hook does expensive full re-fetches.

### Changes

#### 1. Fix XP/Gold Sharing (src/hooks/useCombat.ts)
- Add a **fresh query** to fetch party members at the same node right when a creature dies, instead of relying on the potentially stale `partyMembersRef`
- This ensures we always get up-to-date `current_node_id` data for party members at the moment rewards are distributed
- Wrap the `award_party_member` RPC calls in try/catch to prevent one failed award from blocking others

#### 2. Add Error Handling for Award RPCs (src/hooks/useCombat.ts)
- Each `award_party_member` call will be wrapped in its own try/catch
- Log errors to console but continue distributing to remaining members
- This prevents a single RPC failure from blocking all other party members' rewards

#### 3. Improve Party Member HP Visibility (src/hooks/useParty.ts)
- Instead of doing a full re-fetch on every single `characters` UPDATE event, narrow the realtime filter to only listen for characters that are actually in the party
- This reduces unnecessary queries and ensures HP changes propagate more reliably

### Technical Details

The key fix in `useCombat.ts` creature death handler (around line 340):

```text
// BEFORE (uses potentially stale ref data):
const membersHere = _party
  ? _partyMembers.filter(m => m.character?.current_node_id === char.current_node_id)
  : [];

// AFTER (fresh query at kill time):
let membersHere: { character_id: string }[] = [];
if (_party) {
  const { data: freshMembers } = await supabase
    .from('party_members')
    .select('character_id, character:characters(current_node_id)')
    .eq('party_id', _party.id)
    .eq('status', 'accepted');
  
  membersHere = (freshMembers || []).filter(
    m => (m.character as any)?.current_node_id === char.current_node_id
  );
}
```

And each award call wrapped individually:

```text
for (const m of membersHere) {
  if (m.character_id === char.id) continue;
  try {
    await supabase.rpc('award_party_member', {
      _character_id: m.character_id,
      _xp: xpShare,
      _gold: goldShare,
    });
  } catch (e) {
    console.error('Failed to award party member:', m.character_id, e);
  }
}
```

### Files to Modify
- **src/hooks/useCombat.ts** -- Fresh query for party members at kill time; error handling on RPCs
- **src/hooks/useParty.ts** -- Optimize realtime subscription to reduce stale data

