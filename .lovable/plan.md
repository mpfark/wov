

## Marketplace for Unique Items (v1)

A global, fixed-price marketplace for unique items, accessed at marketplace nodes, with escrow, durability preservation, sale tax, global announcements, and an admin moderation page.

### Database Schema

**New table `marketplace_listings`** (migration):
- `id` uuid pk
- `seller_character_id` uuid
- `inventory_item_id` uuid (nullable — set null when item leaves escrow)
- `item_id` uuid (snapshot reference)
- `item_snapshot` jsonb (name, rarity, slot, stats, value, hands, illustration_url at list time)
- `current_durability` int (preserved exactly through sale)
- `price` int
- `tax_rate` numeric (default 0.10)
- `status` text: `active` | `sold` | `cancelled` | `expired`
- `buyer_character_id` uuid nullable
- `created_at`, `expires_at` (default `now() + 48h`), `sold_at` nullable

RLS:
- SELECT: any authenticated user (global browse)
- INSERT/UPDATE/DELETE: service role only (all writes via RPC/edge)
- Admin SELECT/UPDATE: stewards/overlords

**Marketplace tax sink**: tax simply removed from economy (no destination table). Recorded via `tax_amount` column for admin auditing.

**New nodes column**: `is_marketplace boolean default false` — added alongside existing `is_vendor`, `is_inn`, etc.

### Server-Side RPCs (security definer, SECURITY DEFINER pattern)

1. **`list_unique_item(p_character_id, p_inventory_id, p_price)`**
   - Verify ownership, item rarity is `'unique'`, not equipped, not soulbound
   - Snapshot item data + durability
   - DELETE from `character_inventory` (escrow)
   - INSERT into `marketplace_listings` status=active
   - Returns listing id + snapshot for broadcast

2. **`buy_unique_listing(p_character_id, p_listing_id)`**
   - Lock listing FOR UPDATE, verify status=active and not expired
   - Verify buyer at a node where `is_marketplace = true`
   - Verify buyer has gold ≥ price
   - For unique exclusivity: `pg_advisory_xact_lock(hashtext('unique_item_'||item_id))`, ensure no character currently holds it (escrow already removed it from inventory, so this is a sanity check)
   - Deduct gold from buyer, set `app.trusted_rpc=true`, credit seller `floor(price * (1 - tax_rate))`
   - INSERT item into buyer's `character_inventory` with snapshot's `current_durability`
   - UPDATE listing status=sold, set buyer_character_id, sold_at
   - Returns payload for broadcast

3. **`cancel_unique_listing(p_character_id, p_listing_id)`**
   - Verify caller owns seller, status=active
   - Return item to seller inventory with original durability
   - UPDATE status=cancelled

4. **`expire_marketplace_listings()`** (called periodically client-side like `cleanup_ground_loot`)
   - For each active listing past `expires_at`: return item to seller, mark expired

5. **`admin_cancel_listing(p_listing_id)`** — stewards/overlords
   - Same as cancel but bypasses ownership; returns item to seller (or destroys if seller deleted)

### Frontend — Player UI

**Node feature**: When `currentNode.is_marketplace`, show new toolbar button (🏛️ Marketplace) in `MapPanel` alongside vendor/blacksmith/teleport buttons.

**New `MarketplacePanel.tsx`** (`src/features/marketplace/components/MarketplacePanel.tsx`):
- Two tabs: **Browse** and **My Listings**
- Browse: search by name, sortable table (Name, Stats, Durability, Price, Seller, Time Left), Buy button per row
- My Listings: shows seller's active listings with Cancel button
- Create Listing: a "+ List Unique Item" action that opens an inline picker filtered to inventory items with `rarity=unique` and not equipped/soulbound
   - Price input → shows tax breakdown ("Price: 10,000 · Tax (10%): 1,000 · You receive: 9,000")
   - Confirm → calls `list_unique_item` RPC

**New `useMarketplace` hook** (`src/features/marketplace/hooks/useMarketplace.ts`):
- Fetches active listings (global)
- Subscribes to `marketplace_listings` postgres_changes for live updates
- Exposes `list`, `buy`, `cancel` actions + listings array

**Global announcements**:
- Subscribe to a new global broadcast channel `marketplace-global`
- After successful `list_unique_item`, the client sends `{event: 'listed', payload: {seller, item_name, price}}`
- All players receive it and append to event log: `📜 Market: {seller} lists {item_name} for {price} gold.`
- Subscription lives in `GamePage` (alongside other global events) so all players hear it regardless of route

### Admin UI

**New sidebar entry** in `AdminSidebar` under "Operations": `Marketplace` (icon: `Store` from lucide-react)

**New `MarketplaceManager.tsx`** (`src/components/admin/MarketplaceManager.tsx`):
- Mirrors `IssueReportManager` patterns (shared admin styling)
- Status filter: All / Active / Sold / Cancelled / Expired
- Search by seller name + item name
- Table columns: Created, Seller, Item Name, Rarity, Durability, Price, Tax, Status, Actions
- Inspect listing → modal showing full snapshot + stats
- Action: Cancel listing (calls `admin_cancel_listing`)
- Action: Delete listing row (hard delete, for stuck/broken states)

**Wire into `AdminPage.tsx`**: add `case 'marketplace': return <MarketplaceManager />;`

### Node Editor Integration

In `NodeEditorPanel.tsx`, add `is_marketplace` checkbox to the existing "Node Services" section (next to vendor/inn/blacksmith/teleport). Update `WorldBuilderPanel` types and `PlayerGraphView` icon overlay (🏛️ marker).

### Files Created

| File | Purpose |
|------|---------|
| `supabase/migrations/<ts>_marketplace.sql` | Table + nodes column + RLS + RPCs |
| `src/features/marketplace/index.ts` | Public exports |
| `src/features/marketplace/hooks/useMarketplace.ts` | Listings query/sub + actions |
| `src/features/marketplace/components/MarketplacePanel.tsx` | Browse / list / cancel UI |
| `src/components/admin/MarketplaceManager.tsx` | Admin moderation page |

### Files Modified

| File | Change |
|------|--------|
| `src/components/admin/AdminSidebar.tsx` | Add Marketplace nav item |
| `src/pages/AdminPage.tsx` | Route Marketplace tab |
| `src/components/admin/NodeEditorPanel.tsx` | Add `is_marketplace` checkbox |
| `src/features/world/components/PlayerGraphView.tsx` | 🏛️ icon for marketplace nodes |
| `src/features/world/components/MapPanel.tsx` | Marketplace toolbar button + prop |
| `src/pages/GamePage.tsx` | Wire `MarketplacePanel`, global listing broadcast subscription |
| `src/integrations/supabase/types.ts` | Auto-regen after migration |

### Tax / Economy

- Default `tax_rate = 0.10`, stored per-listing (allows future per-node rates)
- Seller payout: `floor(price * (1 - tax_rate))`
- Tax amount removed from economy (sink), stored in listing for audit

### Expiration

- Listings expire after 48h default (`expires_at` column)
- Client calls `expire_marketplace_listings()` RPC on `MarketplacePanel` open + every 5min, mirroring `cleanup_ground_loot` pattern

### Not Changed

- Combat, durability rules, loot system, command system, class balance, equip rules
- `is_vendor`/`is_blacksmith`/`is_inn`/`is_teleport` behavior (marketplace is additive)
- `try_acquire_unique_item` and existing unique-item exclusivity flow remain untouched

### Success Criteria

- Only `rarity='unique'` items can be listed (RPC validation)
- Listings global, browseable from any marketplace node
- Item escrowed (removed from `character_inventory`) on list
- Durability preserved exactly through sale
- Tax applied; seller payout = `price - tax`
- Global event log message on each new listing
- Admin can view all listings and cancel/delete from a dedicated page

