# Admin: Grant Gold like Grant Salvage

Today, admins change a character's gold only by entering the edit panel and overwriting the absolute value through `update-character`. The user wants the same one-click additive flow that already exists for salvage: type an amount, press a button, gold is added on top of current.

## Changes

### 1. Edge function — `supabase/functions/admin-users/index.ts`
Add a new action `grant-gold` modeled after `grant-salvage`:
- Validate `character_id` and positive integer `amount` (cap at 1,000,000 to match existing gold validation).
- Fetch current `gold`, update to `gold + amount` using the admin client (service role bypasses the leader-restriction trigger, so the `app.trusted_rpc` flag is not needed).
- Return `{ success: true, new_total }`.

### 2. UI state — `src/components/admin/users/UserManager.tsx`
- Add `grantGoldAmount` state (default `100`) and setter.
- Add `handleGrantGold(characterId)` mirroring `handleGrantSalvage`: calls `callAdmin('grant-gold', 'POST', { character_id, amount })`, toasts `Granted N gold (total: X)`, then `loadUsers()`.
- Pass both into `CharacterActionsColumn`.

### 3. UI row — `src/components/admin/users/CharacterActionsColumn.tsx`
- Add `grantGoldAmount`, `setGrantGoldAmount`, `onGrantGold` to props.
- Add a row in the **Progression** section (right above or below Salvage) with a number input and a "Grant Gold" button using a coin/gold icon (e.g. the existing `🪙` glyph or `Coins` lucide icon for consistency with salvage's emoji style).

No DB migration needed; the existing leader-restriction trigger already permits service-role updates.

## Out of scope
- The absolute-value `gold` field in the character edit form stays as-is (still useful for setting exact values).
- No change to starting gold or other gold flows.
