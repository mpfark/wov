

# Fix: Tank Assignment Not Working in Party Combat

## Root Cause

There's a mismatch between client and server tank logic:

- **Client** (`useParty.ts` line 248): `effectiveTankId = party.tank_id ?? party.leader_id` — defaults to the leader when no tank is explicitly set
- **Server** (`combat-tick` line 127-128): `tankId = party.tank_id || null` — when `tank_id` is null, `tankAtNode` becomes false, so creatures randomly target ANY alive member instead of focusing the leader

This means the UI shows the leader as the "tank" (green shield icon), but the server ignores this and hits random members. With 2 party members, Dwarlin gets hit ~50% of the time, making it appear like Dwarlin is always tanking.

When Dwarlin is leader instead, the same client-side fallback makes Dwarlin the "effective tank" — and since Dwarlin is getting randomly targeted anyway, it looks correct by coincidence.

Additionally, there may be a secondary issue: when the user explicitly clicks "Set as Tank" on a member, the `setTank` call may silently fail if the party state has gone stale, though the primary issue is the server fallback logic.

## Fix

**One-line change in `supabase/functions/combat-tick/index.ts`** (line 127-128):

Apply the same fallback the client uses — when `tank_id` is null, default to the party leader:

```typescript
// Before:
tankId = party.tank_id || null;
tankAtNode = tankId ? members.some(m => m.id === tankId) : false;

// After:
tankId = party.tank_id || party.leader_id;
tankAtNode = members.some(m => m.id === tankId);
```

This ensures that when no explicit tank is set, the leader absorbs all creature attacks (matching the UI's display), and when a tank IS explicitly set, that member takes the hits.

## Files touched

| File | Change |
|------|--------|
| `supabase/functions/combat-tick/index.ts` | Default `tankId` to `party.leader_id` when `tank_id` is null |

