## Marketplace Sale Escrow — Go Collect Your Gold

Right now `buy_unique_listing` immediately credits the seller's gold the moment a buyer purchases. That works, but it's invisible — the seller may not even notice. This plan changes sales to use an **escrow + manual collection** flow: when an item sells, the gold is held by the marketplace, and the seller must travel to a marketplace node to collect it.

### Behavior Changes

| Aspect | Before | After |
|---|---|---|
| Buyer pays | Gold deducted immediately | Same |
| Seller credited | Gold added to seller instantly (anywhere) | Gold held in escrow on the listing |
| Seller notification | Global broadcast only | Global broadcast + persistent "uncollected" state |
| Collecting payout | Automatic | Seller visits any marketplace node, opens marketplace, clicks "Collect" |
| Expired/cancelled listings | No payout (already correct) | Unchanged |

### Database Changes

**New columns on `marketplace_listings`:**
- `payout_amount integer` — frozen at sale time = `price - tax_amount`
- `payout_collected_at timestamptz NULL` — set when seller collects
- (Existing `status` flow stays: `active → sold → (sold + collected)` — collection is a separate flag, not a new status, so analytics & filters keep working.)

**Modify `buy_unique_listing` RPC:**
- Remove the `UPDATE characters SET gold = gold + _payout WHERE id = seller` line.
- Store `_payout` into the new `payout_amount` column on the listing row.
- Everything else (buyer gold deduction, item transfer, status='sold', global broadcast payload) stays.

**New RPC `collect_marketplace_payouts(p_character_id uuid)`:**
- Auth: `owns_character(p_character_id)`
- Verify caller is currently at a node where `is_marketplace = true` (same check as buying).
- Lock all `marketplace_listings` rows with `seller_character_id = p_character_id AND status = 'sold' AND payout_collected_at IS NULL FOR UPDATE`.
- Sum `payout_amount`, mark each `payout_collected_at = now()`.
- Use the trusted-RPC bypass (`set_config('app.trusted_rpc','true',true)`) and credit the sum to the seller's gold.
- Return `{ collected_count, total_gold, items: [{name, payout}, …] }`.

**Backfill migration**: for existing `status='sold'` rows with no `payout_amount`, set `payout_amount = price - tax_amount` and `payout_collected_at = sold_at` (treat as already paid out — they were credited under the old model).

### Frontend Changes

**`useMarketplace` hook**
- Extend `MarketplaceListing` type with `payout_amount`, `payout_collected_at`.
- Listings query: keep current "active only" for browse, but add a separate `myUncollected` derivation that fetches `seller_character_id = me AND status='sold' AND payout_collected_at IS NULL` (one extra select, refreshed on the same channel).
- New `collect()` function calling `collect_marketplace_payouts`.

**`MarketplacePanel.tsx`**
- "My Listings" tab gains two sub-sections:
  1. **Active** — current 12h listings (unchanged).
  2. **Uncollected sales** — table of sold items awaiting pickup, each row showing item name, sold_at relative time ("2h ago"), and payout. A single prominent **"Collect X gold"** button at the top of the section sums all uncollected payouts. Disabled (with tooltip) when not at a marketplace node.
- The "My Listings" tab label gets a numeric badge when uncollected sales exist (visual nudge).
- After successful collect: toast `"+1,234 gold collected from 2 sales"`, append a local log line `💰 You collect 1,234 gold from your sales.`, refresh inventory & character via `onTransacted()`.

**Sale-side broadcast / log (immersion polish)**
- Seller no longer gets the gold instantly, so the existing sold-event handling needs a clear message. When the seller is online and their listing sells (detected via the realtime `marketplace_listings` UPDATE → `status='sold'`), show a local toast + log line: `📜 Your <ItemName> sold for <price> gold — collect your earnings at any marketplace.` Already-online sellers see this immediately; offline sellers see the uncollected badge next time they open the panel.
- Global broadcast text stays the same so other players still see the sale.

### Security & Edge Cases

- Collection RPC is `SECURITY DEFINER`, validates ownership and current-node marketplace flag, and uses `FOR UPDATE` to prevent double-collection races.
- A seller deleted between sale and collection: payout stays in escrow on the listing. No automatic forfeit; listing simply remains uncollected (acceptable — character deletion is rare).
- Tax behavior is unchanged: tax is "burned" the same way (price − payout never enters anyone's gold).
- Admin force-close (`admin_cancel_listing`) only fires on `active` listings, so it doesn't interact with payouts.
- The `mine` filter currently uses the `listings` array (active only). Uncollected sales are **not** active listings, so we fetch them with a separate small query keyed off the same realtime channel.

### Files Touched

- New migration: add columns to `marketplace_listings`, modify `buy_unique_listing`, add `collect_marketplace_payouts`, backfill existing sold rows.
- `src/features/marketplace/hooks/useMarketplace.ts` — add type fields, uncollected sales fetch, `collect()`.
- `src/features/marketplace/components/MarketplacePanel.tsx` — uncollected sales section + Collect button + sold-toast handler.
- `src/integrations/supabase/types.ts` — auto-regenerated.

### Acceptance Criteria

- Buying a listing transfers the item and deducts buyer gold immediately, but does **not** credit the seller's gold.
- The sold listing shows up under "My Listings → Uncollected sales" for the seller, with the correct payout amount.
- Online seller sees a toast + log line `📜 Your <Item> sold for <price> gold — collect your earnings at any marketplace.` within a second or two of the sale.
- Clicking **Collect** at any marketplace node credits the seller the full sum of uncollected payouts, marks them collected, and removes them from the section.
- Trying to collect away from a marketplace node returns a clear error and does nothing.
- Existing sold listings (pre-migration) are treated as already collected and never appear in the uncollected section.
