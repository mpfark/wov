# Verdict: yes, this is a real vulnerability

The Codex finding is correct, and it's high severity.

## What's actually broken

`supabase/functions/combat-tick/index.ts` (lines 140–175) does this:

```ts
function getUserIdFromJwt(authHeader) {
  const token = authHeader.replace(/^Bearer\s+/i, '');
  const payload = JSON.parse(atob(parts[1]...));   // unsigned base64 decode
  return payload.sub ?? null;                       // trusted as-is
}
...
const userId = getUserIdFromJwt(authHeader);
if (!userId) throw new Error('Unauthorized');
```

That `userId` is then used with the **service-role** client to authorize character access:

- L203: `db.from('characters').select('id').eq('user_id', userId)` — picks the party-leader's characters
- L224: `if (!char || char.user_id !== userId) throw new Error('Not authorized')`

Because `verify_jwt = false` in `supabase/config.toml` AND the function only base64-decodes the payload (no signature check), an attacker can hand-craft `{"sub":"<victim-uuid>"}`, base64 it, and call `combat-tick` posing as that user. The service-role client bypasses RLS entirely, so the spoofed `userId` is the only gate. They can drive any character's combat, spend their CP/MP, fire abilities, and trigger reward writes.

The original code comment justifies skipping verification because `getUser()` was returning intermittent 401s under load. That's a real concern, but the safe replacement is **local signature verification**, not "trust the payload". `getClaims(token)` (used in `combat-catchup/index.ts`) does exactly this — it validates the JWT signature locally against Supabase's signing keys without a GoTrue round-trip.

## Fix plan

### 1. `supabase/functions/combat-tick/index.ts`

Replace `getUserIdFromJwt` with the same pattern `combat-catchup` already uses:

```ts
const authHeader = req.headers.get('Authorization');
if (!authHeader?.startsWith('Bearer ')) return json401();

const userDb = createClient(url, anonKey, {
  global: { headers: { Authorization: authHeader } },
});
const token = authHeader.replace('Bearer ', '');
const { data: claimsData, error } = await userDb.auth.getClaims(token);
if (error || !claimsData?.claims?.sub) return json401();
const userId = claimsData.claims.sub as string;
```

`getClaims` verifies signature + expiry locally using cached JWKS — no per-tick network hop, so the original performance concern doesn't reappear. Keep `verify_jwt = false` in `config.toml` (signing-keys system requires in-code validation anyway, per project conventions).

### 2. Audit other functions with `verify_jwt = false`

From `supabase/config.toml`, these have `verify_jwt = false`. Confirm each either (a) validates with `getClaims()`/`getUser()` before trusting `sub`, or (b) is a legitimately public endpoint:

- `ai-item-forge`, `ai-generate-service-npc`, `ai-item-illustration`, `ai-name-suggest`, `ai-world-builder`, `ai-suggest-character-name` — admin/AI tools, must check role
- `blacksmith-forge`, `jewelcrafter-forge`, `soulforge-item`, `seed-archetype-items` — write to player inventories, must verify caller
- `admin-users` — must verify overlord/steward
- `combat-tick` — the one above
- `combat-catchup` — already correct (reference implementation)
- `auth-email-hook` — public webhook, validates by hook secret instead

Any function that does the same "base64-decode `sub`" pattern gets the same `getClaims` fix. Any function that doesn't verify the user at all and writes to user-scoped tables needs the verification added.

### 3. Verification

- Manually craft a token with someone else's `sub` (locally signed with junk key) and confirm `combat-tick` now returns 401 instead of acting on the victim's character.
- Confirm a normal authenticated combat tick from the app still succeeds (no perf regression from `getClaims`).

## Notes / scope

- This plan is security-only; no gameplay behavior changes.
- No database migration needed.
- No client-side change needed — the real Supabase JWT clients already send is accepted as before.
