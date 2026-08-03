## Goal

Remove emoji from Wayfarers of Varneth entirely — code, Edge Functions, shared mirrors, seeds, prompts, tests, admin authoring, and stored database content. Visual direction stays text, restrained colour, spacing, borders and typography. Replacement is text-only; the single exception is area map colour, which is currently *derived* from an emoji and therefore needs an explicit colour column.

## Audit vs. approved scope — differences to report up front

Verified against the live database and repo:

- **No SQL function, view, trigger, or constraint references `emoji` or the `icon` columns.** `area_type_placeholder_url()` keys off the area-type *name*, so Migration B is a plain column drop with no dependent object rewrites.
- **`classes.icon` is empty for all 8 rows** (nothing to clean), *but* `ClassAuthorDialog` actively writes an emoji default (`🛡️`) into it. It is a live writer and must be removed during the code phase.
- **`materials.icon` holds emoji for all rows** and is read by `MaterialsSection` (with a `🔩` fallback) and `useMaterials`; `JewelcrafterPanel` passes a hardcoded `💎`.
- **`abilities.emoji` is NOT NULL with a default**, and `area_types.emoji` is NOT NULL with a default — so code can stop writing both without an intermediate nullability migration.
- Live writers of `abilities.emoji`: `AbilityAuthorDialog`, `AbilityConfigManager`, and the ability-seed publisher (`ability-seed.ts`, both mirrors).
- Emoji-bearing stored content matches the audit exactly: 8 `abilities.description`, 20 `creatures.boss_crit_flavors`, 23 `creatures.boss_cast`, 6 `items.procs`, 56 transient `party_combat_log.message`. Nothing found in `nodes`, `areas`, `npcs`, `items.name/description`, `roadmap_items`, `abilities.combat_text`, `abilities.tooltip`, `creatures.description`, `creatures.boss_death_cry`.
- No additional table/column outside the approved list needs cleaning. If a broader match appears during implementation, it will be reported with table, column, row count and representative values before any write.

## Phase 1 — Migration A (expand only)

- Add `area_types.color text NOT NULL DEFAULT '200 15 50'` (neutral fallback), storing an HSL triplet.
- Backfill from the existing emoji→palette map so every area type keeps its **exact** current map colour.
- Add a validation trigger enforcing the `H S L` triplet shape and numeric ranges (trigger, not CHECK, per project convention); malformed values normalise to the neutral fallback.
- **No columns dropped.** Regenerate types.

## Phase 2 — Code deployment (nothing reads/writes the obsolete fields)

**Area colour system (separate from damage colour, by design)**
- Rewrite `area-colors.ts` to accept the HSL triplet; keep fill / stroke / header / preview / placeholder derivations byte-equivalent to today's output.
- `useAreaTypes` exposes `colorMap` (no `emojiMap`, no emoji fallback); update all consumers: `NodeView`, `RegionMiniMap`, `PlayerWorldMapDialog`, `PlayerGraphView`, `AdminWorldMapView`, `WorldBuilderPreviewGraph`, `NodeEditorPanel`, `area-placeholder.ts`.
- `AreaTypeDialog`: emoji input → native colour picker with a visible swatch preview, converted to the stored HSL triplet on save; emoji field removed.
- Area types stay distinguishable by **text label** everywhere colour is used — colour is never the only signal.

**Shared registries and payloads (semantics preserved)**
- Drop `emoji` from `DamageTypeMeta`, `DAMAGE_TYPE_REGISTRY`, `DAMAGE_TYPE_OPTIONS` labels — both mirrors byte-identical.
- Drop `emoji` from `ProcLogInput`/`formatProcMessage`, `CLASS_ABILITIES`, `ABILITY_SEED` (both mirrors), the runtime ability registry, `useAbilityRegistry`, `ability-loadout`, `stances`, `cast-flavor`, `cast-events`.
- **Only decorative fields are removed.** `type`, `damageType`, `effectType`, `severity`, `source`, `target`, `amount`, `amountKind` all survive untouched. A fire telegraph stays `{ type: 'boss_telegraph', damageType: 'fire', message: '…' }`.
- No inference of type, urgency, routing or presentation from message text. No new prefixes, control characters, or hidden formatting conventions replace the glyphs.

**Event log presentation**
- `event-log-styles`: remove the leading-icon split. Telegraph identity comes from `type`; `damageType` contributes a restrained secondary accent applied to the number / ability name only — it never overrides telegraph family or urgency styling.
- `stripEmoji()` added as a final rendering-boundary safety net for legacy rows only — not a substitute for cleaning emitters, stored data, or admin inputs.
- Legacy adapter keeps recognising old input; nothing new emits it.

**Text sweep (text-only, no icon swaps)**
- Player UI: `NodeView`, `MovementPad`, `MapPanel`, `TeleportDialog`, `SummonPlayerPanel`, `SummonRequestNotification`, `StatusBarsStrip`, `CharacterPanel`, `AbilityLoadoutTab`, ability bar + `AbilityBarMeasurer`, `PartyPanel`, `NPCDialogPanel`, all inventory/vendor/blacksmith/jewelcrafter/stonebinder/soulforge/gem/materials panels, `ItemTooltipCard`, `MarketplacePanel`, `ServicePanelShell`, `HeartbeatIndicator`, `OfflineOverlay`, `GamePage`, `CharacterCreation`, `useGlobalBroadcast`, `useMovementActions`, `useSoulringGlow`, `resources.ts` (both mirrors).
- Combat/server: `combat-text`, `combat-resolver` (both mirrors), `tick-event-builder`, `reward-event-builder`, `legacy-adapter`, `proc-log-format`, `combat-tick`, `combat-catchup`, `kill-resolver`.
- Admin: remove emoji fields from `AbilityAuthorDialog`, `AbilityConfigManager`, `ClassAuthorDialog` (stops writing `classes.icon`), `AreaTypeDialog`, `ItemManager` proc editor, `FlavorField`/`CreatureManager` previews; strip decorative glyphs from `AdminSidebar`, `AdminGlobalSearch`, `NodePicker`, `CreaturePicker`, `PopulatePanel`, `PopulateNodeSelector`, loot tabs, users columns/sheets, `NodeEditorPanel`, `WorldBuilderPreviewGraph`, `WorldBuilderRulebook`, `GameManual`, `AdminChatWidget`, `ProcExpectancyPanel`.
- `MaterialsSection`/`useMaterials` stop reading `materials.icon`; AI prompt builders (`ai-world-builder`, illustration/portrait/NPC prompts) instructed to emit no emoji.
- Deploy Edge Functions and verify before Phase 4.

## Phase 3 — Data cleanup (idempotent, approved scope only)

- Strip emoji from `abilities.description`, `creatures.boss_crit_flavors` (jsonb), `creatures.boss_cast` (jsonb), `items.procs` (jsonb), using codepoint-range replacement that is safe to re-run.
- Clear the 56 transient `party_combat_log.message` rows carrying emoji. `party_combat_log.message` and `party_combat_log.event` **columns stay** — structured events remain the source of truth.
- Ship a reusable verification query that *reports* remaining emoji-bearing values across the cleaned fields rather than mutating anything.

## Phase 4 — Migration B (contract)

Only after Phase 2 is deployed and verified:
- Drop `abilities.emoji`, `area_types.emoji`, `materials.icon`, `classes.icon`.
- Remove their defaults and any leftover seed references. (No dependent functions/views/triggers exist — verified.)
- Regenerate types a second time.

## Phase 5 — Guard and verification

**Repository guard test** (no directory or file exclusions) scanning `src/`, `supabase/functions/`, shared mirrors, `supabase/migrations/`, seeds, prompt builders, scripts, fixtures and tests. Detection covers standard emoji codepoints, variation selectors, skin-tone modifiers, regional-indicator flags, keycap sequences, ZWJ and other composed sequences. Any test needing emoji input builds the fixture from explicit codepoints at runtime, so no source file contains a literal.

**Verification checklist**
- Area maps render the exact same colours after backfill; invalid/missing colours fall back to neutral.
- Damage-type accent never overrides telegraph styling; structured `damageType` survives payload changes.
- No live code reads or writes any dropped column.
- New events, abilities, proc messages, boss casts, seeds and AI-generated content are emoji-free at emission.
- Playwright pass (desktop + mobile) over game view, character panel, event log, maps, and admin managers: no awkward gaps, text-only labels remain understandable, admin previews match player presentation.
- Shared mirror-identity test passes; full Vitest suite green (currently 423) with emoji-asserting tests updated.
- Repository emoji guard passes; database verification query returns zero rows.
- Structured-event ordering, deduplication, party sync, combat timing and gameplay calculations unchanged.
