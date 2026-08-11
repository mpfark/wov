# The Wayfarer's Guide — player-facing in-game manual (revised)

## Summary

Add a permanent, character-carried **Wayfarer's Guide**: a toolbar button in the Map panel header that opens a reader with grouped navigation (all initial entries listed at once, opening on Getting Started). Content lives in two new tables (`guide_categories`, `guide_entries`) edited through a guide-specific admin editor, so text is maintainable without code changes. Per-character read state lives in a third table keyed by entry **ID**. The existing admin `GameManual` stays as the developer/design reference — it is formula-derived and not suitable for players.

MVP ships four written entries, an attention dot driven only by Getting Started, a deep-link mechanism (`?guide=<slug>`), and one adjusted line in the intro event log pointing at the guide.

## What already exists and can be reused

- `src/components/admin/GameManual.tsx` — admin-only, section list + `AdminPageShell`, content hardcoded and derived from `src/lib/game-data.ts` formulas. Design reference only. Recommendation: **separate system**, no shared data.
- `src/components/admin/RoadmapManager.tsx` + `roadmap_items` — existing pattern for admin-edited DB content (title/description/category/sort_order). The guide editor mirrors it.
- `src/features/world/components/MapPanel.tsx` — existing icon toolbar row (Keyboard, Admin, Switch Character, Report Issue, Gallery) using `Button variant="ghost" size="icon" h-8 w-8` + `Tooltip`. The Guide button drops in as the first item.
- `src/pages/GamePage.tsx` — right panel is a `Sheet` (`side="right"`, `w-[400px]`) on mobile/tablet, fixed panel on desktop; `isMobile` / `isTablet` already computed; `mapPanelOpen` state already exists and can be closed programmatically.
- `src/components/OnboardingCoachmark.tsx` — portal callout targeting `[data-onboarding="<id>"]`. Its storage key is `onboarding.<targetId>.dismissed.v1` — **global, not per character**; needs a scoping change (below).
- `src/features/world/hooks/useFirstEntryWelcome.ts` — intro text is **hardcoded** in `FIRST_LINES` (client-side, staggered 900ms). Its localStorage key is `entry.first-welcome.<characterId>.v1` and the module-level `handledThisPageLoad` set is keyed by character id — **already correctly per character**. Confirmed: a second character replays the intro.
- UI primitives available: `Dialog`, `Sheet`, `ScrollArea`, `Accordion`, `Tabs`, `Badge`, `Tooltip`, `Card`. No markdown or sanitiser dependency exists.

### Crafting facts confirmed in code

From `supabase/functions/forge-craft-base/index.ts`:
- Blacksmith crafts `main_hand, off_hand, head, chest, gloves, pants`. Jeweller crafts `ring, trinket`. Requires standing on a node with `is_blacksmith` / `is_jewelcrafter` respectively.
- Only **common plain bases** are craftable; uncommon ("Fine") gear is drop-only.
- Base tier gates on character level via `GEAR_TIERS[].unlockLevel` — stronger bases unlock as you level. **No class restriction anywhere in the craft path.**
- Cost: `salvage = 5 + craftedLevel * 2` and `gold = craftedLevel * 5`. Cost scales with **tier/level**, not weight. Characters start with 200 gold (column default), so the first craft is affordable.
- `forge-apply-gem`: one primary gem grants +1 to one attribute on that specific inventory instance (`applied_gems`), so gems belong to the item.
- Gem→attribute mapping (`_shared/formulas/gems.ts`, 6 primaries): Garnet STR, Topaz DEX, Emerald CON, Sapphire INT, Pearl WIS, Amethyst CHA.
- `jewelcrafter-gemcutter` also lets a player buy a chosen primary gem for salvage (`GEM_SALVAGE_COST_PRIMARY`) at a jewelcrafter node.
- Starting materials come from the `grant_starting_materials` trigger. The guide will **not** quote the amounts.

Data note: Hearthvale's blacksmith is `Hammer-Fall Smithy` at (1,-1), north-east of Hearthvale Square (0,0) — the intro direction is correct. There is exactly **one** jewelcrafter node in the world and **its `name` is an empty string**. The guide should therefore say jewellery is crafted at a jeweller elsewhere in the world without naming a location, and the empty node name is flagged as a separate content bug to fix outside this plan.

## Player experience, first login to blacksmith

1. Character arrives at Hearthvale Square; the existing staggered intro plays, final line naming the guide.
2. A one-time, **per-character** coachmark points at the Guide button.
3. The Guide button shows an attention dot because Getting Started is unread.
4. Opening the guide lands on **Getting Started**: where you are, blacksmith north-east, what salvage and gems are for, how to move.
5. Reading Getting Started clears the toolbar dot. Other entries may still show small unread markers inside the reader.
6. Player moves north-east and crafts. Travelling, Combat, Equipment and Crafting entries stay one click away.

## MVP scope

- Three new tables + RLS + grants.
- Seed 2 categories / 5 entries (grouping below), all published.
- `GuideDialog` reader with grouped navigation, opening on Getting Started.
- Toolbar attention dot driven by Getting Started only; per-entry unread markers inside the reader.
- Deep links: `openGuide(slug)` helper + `?guide=<slug>` param, only ever triggered by a deliberate click.
- Per-character coachmark on the Guide button.
- Admin editor for categories and entries with player preview.
- Intro event-log final line adjusted.

No level gating, no locked states, no unlock triggers in MVP.

## Later expansion

- Remaining entries: Health/Death/Recovery, Classes and Orders, Abilities, Parties, Status Effects, Bosses and Telegraphed Casts.
- Search box (justified past ~12 entries).
- Additive migration later for `min_level` and/or `unlock_trigger` plus an `attention` flag so newly published or important entries can raise the toolbar dot.
- Contextual highlighting (Combat while in combat, Parties while grouped) — presentation only.

## Data model and RLS

```sql
guide_categories(id UUID PK, key TEXT UNIQUE, title TEXT, subtitle TEXT,
                 sort_order INT, is_published BOOL DEFAULT true,
                 created_at, updated_at)

guide_entries(id UUID PK, category_id UUID REFERENCES guide_categories(id) ON DELETE CASCADE,
              slug TEXT UNIQUE, title TEXT, summary TEXT, body TEXT,
              sort_order INT, is_published BOOL DEFAULT false,
              created_at, updated_at)

character_guide_reads(
  character_id UUID REFERENCES characters(id) ON DELETE CASCADE,
  entry_id UUID REFERENCES guide_entries(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, entry_id)
)
```

Slug is the public deep-link address only; relational identity is `entry_id`, so a slug can be corrected later without losing read state. No `min_level`.

Grants and policies (create → grant → enable RLS → policy):
- `guide_categories`, `guide_entries`: `GRANT SELECT` to `anon, authenticated`; insert/update/delete to `authenticated` gated by `is_steward_or_overlord(auth.uid())`; `GRANT ALL` to `service_role`. Read policy `is_published = true`, plus a steward/overlord policy that also sees drafts.
- `character_guide_reads`: `GRANT SELECT, INSERT, DELETE` to `authenticated`; policies scope to characters owned by `auth.uid()` (same pattern as `character_visited_nodes`). No `anon` grant. `GRANT ALL` to `service_role`.
- `updated_at` triggers via the existing `update_updated_at_column()`.

Deletion: the FK cascade covers ordinary row deletion. The project also has a custom `delete_character_cascade` RPC that enumerates tables explicitly; the implementation step is to **read it and add `character_guide_reads` only if it deletes the character row in a way that bypasses the cascade** (e.g. deletes children first then the row). If the RPC deletes `characters` normally, the FK cascade already handles it and the RPC stays untouched.

### Body formatting

No HTML, no markdown dependency. Plain text with a tiny whitelisted line grammar rendered by `GuideBody`:
- blank line = paragraph break
- `## ` = subheading
- `- ` = bullet
- `> ` = flavour aside (italic, muted, rule)
- `[[slug|label]]` = internal guide link

Anything else renders as literal text — safe by construction.

## Component and file changes

New:
- `src/features/guide/hooks/useGuide.ts` — fetch published categories/entries (React Query, long staleTime); read rows for the current character; `markRead(entryId)`.
- `src/features/guide/components/GuideReader.tsx` — the reader (Dialog on desktop, Sheet on mobile).
- `src/features/guide/components/GuideBody.tsx` — line-grammar renderer.
- `src/features/guide/components/GuideButton.tsx` — toolbar button, `data-onboarding="wayfarer-guide"`, attention dot.
- `src/features/guide/index.ts`
- `src/components/admin/GuideManager.tsx`
- Migration + seed SQL.

Modified:
- `MapPanel.tsx` — `GuideButton` first in the toolbar row; new `onOpenGuide` prop.
- `GamePage.tsx` — own `guideOpen` state; mount `GuideReader`; close the map Sheet before opening the guide on mobile; second `OnboardingCoachmark` for `wayfarer-guide`; handle `?guide=`.
- `OnboardingCoachmark.tsx` — add an optional `scopeId` prop; storage key becomes `onboarding.<targetId>.<scopeId>.dismissed.v1` when provided, falling back to the current key otherwise so the existing keyboard hint keeps its dismissal.
- `useFirstEntryWelcome.ts` — adjust `FIRST_LINES` and end with the guide pointer.
- `AdminSidebar.tsx` + `AdminPage.tsx` — add a `guide` entry (icon `BookOpen`) next to `manual`.

## Admin editing workflow

Two-column editor in the existing admin shell: left = categories with their entries and numeric `sort_order` inputs (mirroring `RoadmapManager`); right = form with Title, Slug (locked after create), Summary, Body textarea, Category, Sort order, Published toggle. A **Preview** tab renders the body through the same `GuideBody` players see. Unpublished entries are visible only to steward/overlord and labelled Draft. No level or unlock fields.

## Unread and toolbar attention logic

Two separate concepts:

- **Per-entry unread** — entry id absent from `character_guide_reads` for the current character. Shown as a small dot beside the entry in the reader's navigation. Cleared per entry on open.
- **Toolbar attention dot** — MVP rule: shown only while the `getting-started` entry is unread for this character. Reading Getting Started clears it permanently, regardless of the other entries. The dot never returns just because some entry has not been opened.

Implementation: `useGuide` exposes `unreadEntryIds: Set<string>` and a separate `needsAttention: boolean` computed solely from the Getting Started entry's read state. The attention rule lives in one place so a later `attention` column can extend it additively.

Marking read: upsert into `character_guide_reads` on entry open, ignore conflict. Idempotent, per character, no gameplay side effects.

## Combat behaviour

- The Guide button looks and behaves identically in and out of combat — no muting, no disabling.
- The guide can be opened during combat; combat continues behind it (ticks are server-driven).
- Opening or closing the guide changes no combat, movement, inventory, progression or world state.
- No deep-link queueing, no auto-open. An interactive guide link in the event log, if added, opens only on a deliberate click.

## Mobile and desktop layout

- **Desktop:** `Dialog`, ~900x620. Left pane (~240px) is a grouped `<nav>`: category heading + its entries listed directly, so no category selection step. Right pane shows the entry with title, italic summary, body inside a `ScrollArea`. Parchment card styling, `font-display` headings, Lucide icons only, no emojis.
- **Mobile/tablet:** the guide opens as a `Sheet` (`side="right"`, full width, matching the map panel's existing feel). Single pane: the grouped list, tapping an entry swaps to the reader with a back button. Because the map panel is itself a Sheet, `GuideButton` calls a handler in `GamePage` that **sets `mapPanelOpen` to false first, then opens the guide on the next tick** — never two Sheets mounted at once. Closing the guide does not reopen the map Sheet automatically; the map button is where it always was.
- **Keyboard/a11y:** Radix gives focus trap and Escape. Navigation is a real `<nav>` of buttons; body subheadings are `<h3>`; button carries `aria-label="The Wayfarer's Guide"` with the attention state reflected in the accessible name.

Motto rendered once as a permanent footer rule in the reader: **DON'T WANDER UNPREPARED.**

## Error handling

Normal loading skeleton and error state — no duplicated content. On fetch failure the reader shows:

> The Guide appears to have misplaced this page. The blacksmith is northeast of Hearthvale Square.

plus a Retry button. The essential onboarding direction survives without maintaining two copies of the entry.

## Initial guide organisation and entries

Categories (kept in the model, but presented as grouped navigation):

**Getting Started**
- *Your First Steps* — where you are, moving north-east to the blacksmith, movement points, crafting and equipping a first base, what gems do, jewellery at the jeweller.
- *Travelling and the Map* — compass keys and map clicking, movement points and regeneration, region level expectations, the local vs world map.

**Surviving Varneth**
- *Combat* — starting and leaving a fight, hit quality bands, HP/CP/MP, wimp auto-flee, what death costs.
- *Equipment* — the nine slots, equipping and durability, why crafted commons beat nothing, that uncommon gear drops rather than being crafted.
- *Crafting, Gems and Salvage* — salvage as the crafting currency, tier unlocks by level, blacksmith versus jeweller, applying gems, buying a specific gem from the jewelcrafter.

## Migration and compatibility

- Purely additive: three new tables, no existing table or RPC signature changes.
- Seed content ships in the same migration so the guide is never empty on first deploy.
- Coachmark key change is backwards compatible via the optional `scopeId` fallback.
- World slumber is irrelevant: guide reads/writes are plain table access and do not consult `world_is_awake()` or wake the world.

## Tests and acceptance criteria

Unit:
- `GuideBody` line grammar: paragraph, subheading, bullet, aside, internal link; raw `<script>`/HTML renders as inert text.
- Attention logic: `needsAttention` true only while Getting Started is unread; stays false when other entries remain unread; per-entry unread set derived correctly.
- Coachmark storage key includes the character id when `scopeId` is passed, and the legacy key is preserved when it is not.
- `src/test/no-emoji.test.ts` passes over new files and seeded content.

Acceptance:
- New character sees the intro ending with the guide pointer; a coachmark points at the Guide button; a second character on the same browser gets both again.
- Toolbar dot present on arrival, gone after reading Getting Started, and it does not return while other entries stay unread.
- Guide opens on Getting Started; entry states Hearthvale Square, blacksmith north-east, all classes can use all bases, jewellery at the jeweller; no starting salvage number appears.
- Opening/closing the guide during combat changes no HP/CP/MP, position or combat session.
- Mobile: pressing Guide from the map Sheet closes the map Sheet before the guide opens; only one overlay is mounted at any time; focus moves into the guide and returns to the Guide button on close; the Android/browser back button closes the guide (single overlay, one history-level dismissal) rather than leaving a stacked overlay; the map panel reopens normally afterwards.
- Admin edits appear for players after refresh; drafts stay invisible to players.
- Deleting a character removes its guide read rows.

## Risks, edge cases, open decisions

- The single jewelcrafter node has an empty name in the data, so the guide cannot name the jeweller's location. Flagged as a separate data fix.
- Content drift: the guide describes mechanics qualitatively (tier unlocks, gem effects) rather than quoting costs, and the admin editor is the correction path.
- `delete_character_cascade` may or may not need the new table added; resolved by reading the function during implementation rather than assumed here.
- Open decision: whether the intro log line should be clickable at all in MVP. Recommendation: ship the toolbar button plus coachmark first and add the clickable line only if the log renderer already supports interactive content cheaply.

## Draft: Getting Started — Your First Steps

> THE WAYFARER'S GUIDE
> An occasionally reliable companion for travellers who have misplaced their purpose, their profession, or their immediate surroundings.

You appear to be standing in Hearthvale Square. This is generally preferable to standing outside it.

The measured hammering from the north-east belongs to the blacksmith. You were, by all appearances, on your way there before existence distracted you.

## Your First Steps

- Move north-east to reach the blacksmith. Travel with the compass keys (Q W E / A D / Z X C) or by clicking a neighbouring location on the local map. Movement spends Movement Points, which return on their own.
- At the forge, craft a plain base item. There are no class restrictions: every class can craft and wear every base. You begin with enough salvage to craft your first piece of equipment.
- As you gain levels, stronger bases become available at the forge. They cost more to make, and a stronger base starts its stats over, so there is no reward for hoarding gems against a future you have not reached yet.
- Rings and trinkets are not forge work. They are crafted by a jeweller, who can also cut you a specific gem in exchange for salvage.
- Equip what you make from your character panel. An unarmed wayfarer strikes for very little, and Varneth notices.

## Gems

Each gem raises one attribute by one point: Garnet strength, Topaz dexterity, Emerald constitution, Sapphire intelligence, Pearl wisdom, Amethyst charisma. The forge and jeweller both show which attribute a gem will add before you commit.

A gem is set into the item, not into you. Choose the item accordingly.

> The Guide advises against placing every gem you own into the first object you forge. The Guide has been ignored on this point before.

## After That

Leave town armed. Creatures near Hearthvale are forgiving; creatures further out are not, and the difference is measured in your own health bar. When something does go wrong, this Guide has entries on combat, equipment, and the several forms of preparation you are currently postponing.
