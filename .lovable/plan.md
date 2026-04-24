

## Refine Marketplace: No Cancellation, 12h Listings, Items Return to Pool

The user wants the marketplace economy to be harsher and more decisive: once a unique is listed, it leaves the seller's hands permanently. If it doesn't sell within 12 hours, it returns to the world drop pool — not the seller's inventory.

### Behavior Changes

| Aspect | Before | After |
|---|---|---|
| Listing duration | 48 hours | **12 hours** |
| Seller cancel | Allowed (item returned) | **Forbidden** |
| Admin cancel | Returns item to seller | **Returns nothing** (item back to world pool) |
| Listing expiry | Returns item to seller | **Item not returned** (back to world pool) |
| Offline-seller sync (6h rule) | Plan to expire stale listings | Same outcome — item simply not returned, naturally re-enters pool |

Because unique items are gated by `try_acquire_unique_item` (advisory lock + "no one currently holds it"), simply **not** re-inserting the item into any inventory is enough for it to become eligible to drop again from creatures. No explicit "return to pool" table or state is needed.

### Database Changes (single migration)

**1. Default listing duration → 12 hours**
```sql
ALTER TABLE public.marketplace_listings
  ALTER COLUMN expires_at SET DEFAULT (now() + interval '12 hours');
```
Existing active listings keep their original `expires_at`; only new listings use 12h.

**2. `expire_marketplace_listings` — never return item**
Replace the body so expired listings are simply marked `expired`. No insert into `character_inventory`. The unique becomes droppable again automatically.

**3. `cancel_unique_listing` — disabled**
Replace the body to always raise:
```sql
RAISE EXCEPTION 'Listings cannot be cancelled. They expire automatically after 12 hours.';
```
Keep the function (it's referenced in code) so we get a clean, user-facing error rather than a 404.

**4. `admin_cancel_listing` — never return item**
Admins can still force-close a stuck/abusive listing for moderation, but the item is **not** returned to the seller. It simply re-enters the world pool. (No insert into `character_inventory`.)

### Frontend Changes

**`src/features/marketplace/hooks/useMarketplace.ts`**
- Remove the exported `cancel` function (or keep it as a stub that returns an "unsupported" error). Since `MarketplacePanel` uses it, simplest is to keep the function but have it return a hard "Listings cannot be cancelled" error without calling the RPC.

**`src/features/marketplace/components/MarketplacePanel.tsx`**
- Remove the **"My Listings → Cancel"** button entirely.
- Replace the My Listings tab content's per-row action area with a read-only display showing:
  - `Expires in <countdown>` (using existing `formatTimeLeft`)
  - A small notice: *"Listings are final and cannot be cancelled."*
- In the "Create Listing" tab, add a clear warning above the price input:
  > *"⚠️ Listings are final. Items cannot be recovered. Unsold items after 12 hours return to the world."*
- Update the listing-duration label everywhere it says "48 hours" → "12 hours".

**`src/components/admin/MarketplaceManager.tsx`**
- Keep the **Admin Cancel** action but rename it to **"Force Close"** with a confirmation dialog explaining the item will not be returned to the seller — it goes back to the world pool.
- Remove or relabel the "Resolve Stuck" action: with the new rules, "stuck" (item somehow still in inventory while listed) is purely a data-integrity issue — keep it as an admin-only escape hatch but rename to **"Mark Resolved"** and document it doesn't move items.
- Update the timeline / inspect dialog to show **12h** as the default expiry window.

### Files Changed

| File | Change |
|---|---|
| `supabase/migrations/<ts>_marketplace_harsh_rules.sql` | New — default 12h, rewrite `expire_marketplace_listings`, `cancel_unique_listing`, `admin_cancel_listing` to never return items |
| `src/features/marketplace/hooks/useMarketplace.ts` | `cancel()` returns hard "not supported" error; no RPC call |
| `src/features/marketplace/components/MarketplacePanel.tsx` | Remove cancel button, add "final sale" warnings, update durations to 12h |
| `src/components/admin/MarketplaceManager.tsx` | Rename Admin Cancel → Force Close (no item return), update copy/timeline to 12h |

### Not Changed

- `list_unique_item`, `buy_unique_listing` — purchase flow unaffected
- Tax math, escrow snapshot, durability preservation
- Realtime subscription, optimistic updates
- Unique-item exclusivity / drop-pool eligibility logic (already handled by `try_acquire_unique_item`)
- 6-hour offline return rule — becomes a non-issue: if a seller goes offline, the listing still expires after 12h and the item re-enters the pool either way

### Success Criteria

- New listings show `expires_at = now() + 12 hours`.
- Player UI has no Cancel button on My Listings.
- Calling `cancel_unique_listing` (e.g. via stale UI or API) returns a clear error and does nothing.
- Listing reaching `expires_at` is marked `expired`; the unique does **not** appear in any inventory and becomes eligible to drop again from creatures.
- Admin "Force Close" marks the listing `cancelled` and does **not** restore the item to the seller.
- Existing 48h-window active listings continue to expire on their original schedule (only the default changes); they also will not return items to sellers.

