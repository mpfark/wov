

## Fix Marketplace Listings Not Refreshing After Purchase

### Root Cause

`marketplace_listings` is missing from the `supabase_realtime` publication, so the `postgres_changes` subscription in `useMarketplace.ts` never fires when a listing transitions from `active` → `sold`. The buyer's UI keeps showing the listing until they manually refresh.

The verification query confirmed only `characters` is published; `marketplace_listings` is not.

### Fix

Two small, complementary changes:

**1. Database migration — enable realtime for the table**
```sql
ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_listings;
ALTER TABLE public.marketplace_listings REPLICA IDENTITY FULL;
```
`REPLICA IDENTITY FULL` ensures UPDATE payloads include the full row so subscribers can see status transitions cleanly. After this, every other open client (sellers watching, other buyers browsing) will also see listings disappear in real time.

**2. Optimistic local removal in `useMarketplace.buy`**

Even with realtime enabled, there's a small window between the RPC returning success and the realtime event arriving. To make the buyer's own UI feel instant, optimistically drop the bought listing from local state inside the `buy` callback on success:

```ts
// in useMarketplace.ts buy()
if (!error) {
  setListings(prev => prev.filter(l => l.id !== listingId));
}
```

This pattern matches the project's existing optimistic-update conventions (see `useCharacter` optimistic updates) and keeps the buyer's view snappy regardless of realtime latency.

### Why This Is Sufficient

- Existing `postgres_changes` subscription will now actually receive events → all clients update without page refresh.
- Optimistic removal handles the local-buyer case immediately.
- `MarketplaceManager` (admin) also benefits — its escrow audit / status transitions update live.
- No RLS, RPC, or schema changes needed beyond publication membership.

### Files Changed

| File | Change |
|------|--------|
| `supabase/migrations/<ts>_marketplace_realtime.sql` | New — add table to `supabase_realtime` publication and set `REPLICA IDENTITY FULL` |
| `src/features/marketplace/hooks/useMarketplace.ts` | Optimistically remove listing from local state on successful `buy` (and on successful `cancel`, for symmetry) |

### Not Changed

- `buy_unique_listing` RPC, escrow logic, tax math
- `MarketplacePanel.tsx`, admin manager UI
- Any other realtime subscriptions

### Success Criteria

- Buying a listing makes it disappear from the buyer's Browse tab without a page refresh.
- Other players browsing the marketplace also see the listing disappear within ~1s.
- Cancelling your own listing removes it from My Listings instantly.

