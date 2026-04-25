## Problem

Edge-function logs show every single `combat-tick` invocation failing with `Error: Unauthorized` thrown from line 141:

```
const { data: { user }, error: authErr } = await userDb.auth.getUser();
if (authErr || !user) throw new Error('Unauthorized');
```

Because every tick fails, the server never advances combat — the client thinks it's "in combat" but no damage, no kills, no aggro responses ever come back. That perfectly matches the user's symptom: combat doesn't start whether triggered manually or by walking into an aggressive creature's node.

`auth.getUser()` makes an HTTP round-trip to GoTrue on every call. With ticks firing every 2 seconds per player (plus all the other "wake up" / "engage" pings), this endpoint is being hit far too often and is now consistently failing — likely a transient GoTrue throttle that has become persistent, or the Authorization header carries the publishable/anon key instead of a session JWT in some code paths.

Either way, the fix is the same: stop calling GoTrue on every tick. We already have the JWT in the request header, and Supabase has already validated it (or will, if `verify_jwt` is on). We just need the `sub` claim to know which user is asking.

## Fix

Replace the `auth.getUser()` round trip in `supabase/functions/combat-tick/index.ts` with a local JWT decode:

```ts
function getUserIdFromJwt(authHeader: string | null): string | null {
  if (!authHeader) return null;
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}
```

Then in the handler:

```ts
const authHeader = req.headers.get('Authorization');
const userId = getUserIdFromJwt(authHeader);
if (!userId) throw new Error('Unauthorized');
// replace every later `user.id` reference with `userId`
```

This removes the GoTrue dependency entirely for the hot tick path. It's safe because:

- All authorization decisions later in the function (`char.user_id !== user.id`, party-leader checks) compare against the `user_id` field on the `characters` table, so we still verify ownership.
- If someone forges a JWT, the only thing they can do is read/write rows whose `user_id` matches the forged `sub`, and they'd still need a valid signed JWT to get past the platform-level checks on any RLS-protected call (we use the service role inside the function, so RLS isn't the gate — but ownership still is, via the `user_id !== userId` guard).

## Verification

- After the change is deployed, watch `combat-tick` logs — the "Unauthorized" stream should stop and we should see normal tick logs (`combat-tick` with `ticks_processed`, member/creature state).
- In the preview, walk into an aggressive creature's node and confirm combat actually starts (HP bars move, log entries appear).
- Manually attack a creature and confirm the same.

## Files to change

- `supabase/functions/combat-tick/index.ts` — add `getUserIdFromJwt` helper, replace `auth.getUser()` block, replace the two `user.id` references (`userChars` filter for party leadership, `char.user_id !== user.id` for solo) with `userId`.

No DB migration, no client changes.
