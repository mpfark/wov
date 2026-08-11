# The Wayfarer's Guide — player-facing in-game manual

## Summary

Add a permanent, character-carried **Wayfarer's Guide**: a toolbar button in the Map panel header that opens a two-pane reader (categories left, entry right). Content lives in two new database tables (`guide_categories`, `guide_entries`) edited through a new guide-specific admin editor, so text is maintainable without code changes. Read-state is per character in a third small table. The existing admin `GameManual` stays as the developer/design reference — it is formula-derived and not suitable for players.

MVP ships four written entries (Getting Started, Travelling and the Map, Combat, Crafting/Gems/Salvage), a subtle unread dot, a deep-link mechanism (`?guide=<slug>`), and one adjusted line in the intro event log pointing at the guide.

## What already exists and can be reused

- `src/components/admin/GameManual.tsx` (1224 lines) — admin-only, section list + `AdminPageShell`, content hardcoded and generated from `src/lib/game-data.ts` formulas (level tables, stat costs). Good as a design reference, wrong tone/shape for players. Recommendation: **separate system**, no shared data.
- `src/components/admin/RoadmapManager.tsx` + `roadmap_items` — the existing pattern for admin-edited, DB-stored content (title/description/category/sort_order). The guide admin editor should mirror this shape and conventions.
- `src/features/world/components/MapPanel.tsx` — already has an icon toolbar row (Keyboard, Admin, Switch Character, Report Issue, Gallery) using `Button variant="ghost" size="icon" h-8 w-8` + `Tooltip`. The Guide button drops straight in here, and this row is what mobile users see inside the right-side `Sheet`.
- `src/pages/GamePage.tsx` — right panel is a `Sheet` (`side="right"`, `w-[400px]`) on mobile/tablet, fixed panel on desktop; `isMobile` / `isTablet` flags already computed.
- `src/components/OnboardingCoachmark.tsx` — portal callout targeting `[data-onboarding="<id>"]`, dismissal in localStorage. Already used for the keyboard button. Reuse verbatim for a one-time "the guide is here" hint.
- `src/features/world/hooks/useFirstEntryWelcome.ts` — the intro text is **hardcoded** in `FIRST_LINES` in that file (client-side, staggered 900ms, gated by a per-character localStorage flag and `level <= 1`). Not seeded, not in the DB, not an edge function. Changing intro text = editing this array.
- Facts confirmed for content accuracy: new characters get 40 salvage + 1 each of garnet/topaz/emerald/sapphire/pearl/amethyst (`grant_starting_materials` trigger); base crafting costs `5 + level*2` salvage (`forge-craft-base`); each primary gem grants +1 to one attribute on one item instance (`forge-apply-gem`).
- UI primitives available: `Dialog`, `Sheet`, `ScrollArea`, `Accordion`, `Tabs`, `Badge`, `Tooltip`, `Popover`, `Card`. No markdown or sanitiser dependency exists.

## Player experience, first login to blacksmith

1. Character created, arrives at Hearthvale Square. Existing staggered intro plays, with the final line changed to name the guide.
2. A one-time coachmark points at the new Guide button in the map toolbar ("The Wayfarer's Guide — start here").
3. The Guide button carries an unread dot because Getting Started is unread.
4. Opening the guide lands directly on **Getting Started** on first open: where you are, that the blacksmith is northeast, what your gems and salvage are for, how to move.
5. Player closes the guide and moves northeast; the dot disappears once the entry is read.
6. Later, `Travelling`, `Combat`, `Crafting` are one click away in the same reader.

## MVP scope

- `guide_categories` + `guide_entries` + `character_guide_reads` tables, RLS, grants.
- Seed 4 categories / 4 entries: Getting Started, Travelling and the Map, Combat, Crafting Gems and Salvage.
- `GuideDialog` reader (categories left / entry right), opened from a Map-panel toolbar button.
- Per-character unread dot; mark-read on entry open.
- Deep links: `openGuide(slug)` helper + `?guide=<slug>` URL param, used by the intro log line's clickable affordance if cheap, otherwise just the button.
- One-time coachmark on the Guide button.
- Admin editor: list + form for categories and entries (title, slug, summary, body, sort order, published), with a player-preview toggle.
- Intro event-log final line adjusted.

Recommendation: **all MVP entries visible from the start.** Unlocking adds trigger plumbing for no benefit at four entries.

## Later expansion

- Remaining entries: Health/Death/Recovery, Equipment and Items, Classes and Orders, Abilities, Parties, Status Effects, Bosses and Telegraphed Casts.
- Search box (justified past ~12 entries).
- Unlockable entries: `unlock_trigger` text key on the entry, recorded server-side by existing events that already write rows (first party join, first boss engage, first death). Only add when there are entries worth gating.
- Contextual highlight: highlight the Combat entry while `inCombat`, Parties while in a party — presentation-only, no new tracking.

## Data model and RLS

```sql
guide_categories(id, key, title, subtitle, sort_order, is_published, created_at, updated_at)
guide_entries(id, category_id -> guide_categories, slug UNIQUE, title, summary,
              body TEXT, sort_order, is_published, min_level INT DEFAULT 1,
              created_at, updated_at)
character_guide_reads(character_id -> characters, entry_slug TEXT, read_at,
                      PRIMARY KEY (character_id, entry_slug))
```

Grants and policies (four-step order per project convention):
- `guide_categories`, `guide_entries`: `GRANT SELECT` to `anon, authenticated`; full CRUD to `authenticated` gated by `is_steward_or_overlord(auth.uid())`; `GRANT ALL` to `service_role`. Read policy: `is_published = true`, plus a steward/overlord policy that sees drafts.
- `character_guide_reads`: `GRANT SELECT, INSERT, DELETE` to `authenticated`; policies scope to characters owned by `auth.uid()` (same pattern as `character_visited_nodes`). No `anon` grant.
- `updated_at` triggers via the existing `update_updated_at_column()`.

Body formatting: **no HTML, no markdown dependency.** Body is plain text with a tiny whitelisted line-grammar rendered by a `GuideBody` component:
- blank line = paragraph break
- line starting `## ` = subheading
- line starting `- ` = bullet
- `> ` = flavour/aside block (italic, muted, parchment rule)
- `[[slug|label]]` = internal guide link

Everything else renders as text. Safe by construction, matches the existing typography, and no new dependency.

## Component and file changes

New:
- `src/features/guide/hooks/useGuide.ts` — fetch published categories/entries (React Query, long staleTime), read-state fetch + `markRead`.
- `src/features/guide/components/GuideDialog.tsx` — the reader.
- `src/features/guide/components/GuideBody.tsx` — line-grammar renderer.
- `src/features/guide/components/GuideButton.tsx` — toolbar button, `data-onboarding="wayfarer-guide"`, unread dot.
- `src/features/guide/index.ts`
- `src/components/admin/GuideManager.tsx` — admin editor.
- Migration + seed SQL.

Modified:
- `MapPanel.tsx` — add `GuideButton` as the first item in the toolbar row (before Keyboard), so it is the most prominent control on both desktop and inside the mobile Sheet.
- `GamePage.tsx` — mount `GuideDialog` alongside the other dialogs; add a second `OnboardingCoachmark` for `wayfarer-guide`; handle the `?guide=` param.
- `useFirstEntryWelcome.ts` — adjust `FIRST_LINES` (condense the current 7 lines slightly and end with the guide pointer).
- `AdminSidebar.tsx` + `AdminPage.tsx` — add a `guide` entry (icon `BookOpen`) next to `manual`.

## Admin editing workflow

Two-column editor in the existing admin shell: left = category list with entry children (drag-free, numeric `sort_order` inputs, matching `RoadmapManager` conventions); right = form with Title, Slug (locked after create), Summary, Body textarea, Category, Sort order, Published toggle, Min level. A **Preview** tab renders the body through the same `GuideBody` the player sees. Unpublished entries are visible only to steward/overlord and are labelled Draft.

## Unread and unlock logic

- Unread = entry slug absent from `character_guide_reads` for the current character. Dot on the button when any published entry is unread; a small dot beside unread entries in the list.
- Marking read: insert on entry open (upsert, ignore conflict). Idempotent, no gameplay side effects.
- Per **character**, not per account, so a new character genuinely gets the intro again.
- No unlock triggers in MVP; the `min_level` column gives a zero-plumbing gate for later advanced entries.

## Layout

- **Desktop:** `Dialog`, ~900x620, two panes: 220px category/entry list (`ScrollArea`), right pane entry with title, italic subtitle, body, `ScrollArea`. Parchment card styling, `font-display` headings, existing rarity-free muted palette. No emojis; Lucide icons only.
- **Mobile/tablet:** the same component renders as a full-height `Sheet` (`side="bottom"`, `h-[85vh]`) with a single pane — category list first, tapping an entry swaps to the reader with a back button.
- **Keyboard/a11y:** Radix `Dialog`/`Sheet` gives focus trap and Escape. Entry list is a real `<nav>` of buttons, arrow-key navigable; body headings are `<h3>`; button has `aria-label="The Wayfarer's Guide"`; unread dot mirrored in the accessible name.
- **Combat:** the guide stays available (it is informational and blocks nothing server-side), but the button gets a muted style while `inCombat` and the dialog does **not** auto-open from deep links during combat — a queued deep link opens when combat ends. Movement keybinds are captured by the dialog's focus trap while open, which is acceptable since the player chose to open it; the existing wimp/auto-flee logic is server-side and unaffected.

Motto, rendered as a small footer rule in the reader: **DON'T WANDER UNPREPARED.**

## Migration and compatibility

- Purely additive: three new tables, no changes to existing tables, no RPC signature changes.
- Seed content ships in the same migration so the guide is never empty on first deploy.
- Empty-state fallback if fetch fails: a hardcoded minimal Getting Started string in the component, so the first-step instruction survives a backend hiccup.
- World slumber is irrelevant: guide reads/writes are plain table access and do not wake the world (no cron gating involved, and `world_is_awake()` is not consulted).

## Tests and acceptance criteria

- Unit: `GuideBody` line grammar (paragraph, subheading, bullet, aside, internal link, and that raw `<script>`/HTML renders as inert text).
- Unit: unread derivation from entries + read rows.
- `src/test/no-emoji.test.ts` must pass over the new files and seeded content.
- Acceptance: new character sees the intro ending with the guide pointer; a coachmark points at the Guide button; button shows an unread dot; opening lands on Getting Started; the entry states Hearthvale Square, blacksmith northeast, and what salvage/gems do; dot clears after reading; entry text edited in admin appears for players after refresh; opening during combat changes no HP/CP/MP/position.

## Risks, edge cases, open decisions

- Deep links from log lines require log events to render interactive content; if the log renderer is text-only, MVP falls back to the toolbar button plus coachmark. Confirmed as a scope-cut fallback rather than a blocker.
- Read-state per character means many characters produce many small rows; bounded by entry count, no cleanup needed (cascade on character delete via `delete_character_cascade` should include the new table).
- Content drift: seeded facts (40 salvage, 6 gems, `5 + level*2` craft cost) will go stale if balance changes; the admin editor is the mitigation, and the entry should describe mechanics qualitatively rather than quoting every number.
- Open decision: whether the temporary onboarding hint should be the coachmark only (recommended, reuses existing component, zero new state) or a small persistent objective chip near the map (rejected for MVP — drifts toward a quest system).

## Draft: Getting Started entry

> THE WAYFARER'S GUIDE
> An occasionally reliable companion for travellers who have misplaced their purpose, their profession, or their immediate surroundings.

You appear to be standing in Hearthvale Square. This is generally preferable to standing outside it.

The measured hammering from the northeast belongs to the blacksmith. You were, by all appearances, on your way there before existence distracted you.

## Your first hour

- Move northeast to reach the blacksmith. Move with the compass keys (Q W E / A D / Z X C) or by clicking a neighbouring location on the local map. Movement costs Movement Points, which refill on their own.
- At the blacksmith, forge a plain base item. Bases cost salvage; heavier and higher-tier bases cost more of it. You begin with enough salvage for a first piece or two.
- Equip what you forge from your character panel. An unarmed wayfarer strikes for very little.
- Your six gems each raise one attribute by one point when set into a single item. Set them deliberately: they belong to the item you place them in, not to you.

> The Guide advises against setting all six gems into the first object you forge. The Guide has been ignored on this point before.

## After that

Leave town only when you are armed. Creatures near Hearthvale are forgiving; creatures further out are not, and the difference is measured in your own health bar. When something does go wrong, this Guide has entries on combat, recovery, and the various forms of preparation you are currently neglecting.

DON'T WANDER UNPREPARED.
