# Phase 1 — Pre-Launch Hardening

Focused on the critical/high items that protect player data, prevent exploits, and keep the game from crashing for new users. Each fix is scoped so existing play (combat, parties, chat, marketplace, movement) keeps working unchanged.

---

## 1. Gate AI edge functions behind admin role

**Files:** `supabase/functions/ai-item-forge/index.ts`, `ai-suggest-character-name/index.ts`, `ai-name-suggest/index.ts`, `ai-generate-service-npc/index.ts`

Add the same `is_steward_or_overlord()` check that `ai-item-illustration` and `ai-item-rebalance` already use. Return 403 for non-admins.

**Player-impact check:** these endpoints are admin tools — confirmed by reading existing call sites before edit. If `ai-suggest-character-name` is actually called from the player-facing onboarding flow, we leave it open to authenticated users but keep the admin gate off (will verify during implementation by grepping call sites).

**Note on rate limits:** the platform doesn't have a standard rate-limiting primitive, so I will **not** add ad-hoc per-function DB counters in Phase 1. Role-gating is the durable protection. If you later want a custom rate-limit table we can add it as a separate, opt-in change.

## 2. Harden `grant_searched_item` RPC

**Migration:** modify the existing function so it validates the item is in `nodes.search_loot_pool` for the character's current node. Caller no longer needs to pass a trustworthy item ID — but we keep the signature so `useMovementActions.ts` doesn't break.

```sql
-- inside the function, after owns_character check:
SELECT current_node_id INTO _node_id FROM characters WHERE id = p_character_id;
IF NOT EXISTS (
  SELECT 1 FROM nodes
  WHERE id = _node_id
    AND p_item_id::text = ANY(
      ARRAY(SELECT jsonb_array_elements_text(search_loot_pool))
    )
) THEN
  RAISE EXCEPTION 'Item not available at this node';
END IF;
```

**Player-impact check:** legitimate searches already pass an item from the node's pool, so they continue to succeed. Only fabricated calls fail.

## 3. Harden `move_follower` RPC adjacency

**Migration:** add a check that `_node_id` is in the follower's current node's `connections` array. Preserves the existing party-leader auth check.

**Player-impact check:** normal party movement uses one of the connected directions, so it still passes. Teleporting followers to arbitrary nodes (the exploit) is blocked. We'll verify by reading the current RPC and confirming `connections` is the right column.

## 4. Add top-level React Error Boundary

**Files:** new `src/components/ErrorBoundary.tsx`; wrap `<Outlet />` (or the game tree) inside `src/pages/GameRoute.tsx`.

Fallback UI: short apology, "Reload" button, "Sign out" button. Logs the error to console + `activity_log` (best-effort) so we can see crashes from real players.

**Player-impact check:** boundary only activates on uncaught render errors — no behavior change in the happy path.

## 5. Consolidate `profiles` SELECT policy

**Migration:** drop the older permissive policy, keep only `auth.uid() = user_id OR is_steward_or_overlord()`. Before writing the migration I'll `supabase--read_query` `pg_policies` to enumerate exactly what's there.

**Player-impact check:** `useMarketplace` already reads seller names from `characters`, not `profiles`. Other reads of `profiles` are scoped to `auth.uid()` in `GameContext` — both still work under the consolidated policy.

## 6. Email verification gate

**Change:** in `src/pages/GameRoute.tsx` (or `OnboardingGatePage`), check `user.email_confirmed_at`. If null, show a "Confirm your email to enter the game" screen with a "Resend email" button (`supabase.auth.resend({ type: 'signup', email })`).

Also call `supabase--configure_auth` to ensure email confirmations are enabled at the project level.

**Player-impact check:** existing confirmed accounts (everyone currently playing) are unaffected. New signups must click the link before reaching the game.

## 7. `.env` hygiene

Verify `.env` is gitignored. The Supabase URL + publishable key are not secrets, but I'll confirm before sharing the repo more broadly. No code change needed if `.gitignore` already covers it. (No key rotation — anon keys are designed to be public.)

---

## Out of scope for Phase 1 (will revisit after approval)

- Marketplace pagination + incremental realtime updates (item 5/12 of the audit)
- Password complexity, onboarding name validation (items 11, 16)
- `as any` cleanup, console error sanitization (items 17, 18)
- Hook hygiene, version footer, reset-password UX (items 13–15, 19–21)

---

## Order of execution

1. Read each target file/RPC to confirm exact current contents.
2. Migrations first (RPCs + policy), in one approval round each so you can review the SQL.
3. Edge function role gates (parallel writes).
4. Error boundary + email-verification gate (frontend, parallel writes).
5. Quick smoke check via preview: log in, move, fight, chat, list/buy marketplace item, party movement.

Approve and I'll start with reading the target files and drafting the first migration.