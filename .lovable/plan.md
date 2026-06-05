
# Guild & Order Progression — Architecture & Rollout

A staged plan. Nothing is built yet. Each phase ships independently and is reversible.

---

## 1. Recommendations (answers to your planner questions)

**Fully classless start — viable?** Yes, but only if the Classless kit is genuinely playable. We give every new character: autoattack, basic movement, 1 universal "Focus Strike" CP ability, and access to a tutorial node that points at the seven halls. Without that, the first 30 minutes feel empty.

**Bond scaling — recommended model:** A single `bond` integer per (character, class), 0–100, earned from class-tagged actions while that class is active. XP-shaped curve so 0→25 is fast (≈1 evening), 75→100 is long-tail. Ability effectiveness scales in 5 tiers (T0 25% / T1 50% / T2 75% / T3 90% / T4 100%) keyed off bond breakpoints 0/25/50/75/100. This gives you a knob per ability without rewriting any ability handler — they read a `bondMultiplier` from context.

**Class stat bonuses vs. attribute points — recommended:** Keep class identity in HP/AC base (`CLASS_BASE_HP`, `CLASS_BASE_AC`) and keep the every-3-levels class stat bonus (`CLASS_LEVEL_BONUSES`) so switching classes still feels distinct. Add **+1 free attribute point per level** on top (currently `unspent_stat_points` already exists). This preserves build identity without making classless characters stat-starved and avoids a destructive respec migration. Full replacement of class stat growth is a bigger swing and not recommended in v1.

**Class switching:** Allowed at any class hall, free, instant. Strips active class abilities, swaps the `class` enum on the character, restores reserved buffs to 0, recalculates max HP/CP/MP/AC via `sync_character_resources`. Bond per class persists in a separate table. No cooldown in v1; add one only if it becomes a combat exploit.

**Data model:** One new table `character_class_bonds (character_id, class, bond, updated_at)`, one new enum/column on `nodes` for `class_hall` (which class the hall recruits for), and one new column `characters.is_classless boolean`. Nothing destructive.

**Migration path for current characters:** Existing characters keep their class and are seeded with `bond = 100` for that class (full mastery, no nerf). They can visit other halls to start new bonds at 0. No one loses power.

**Orders = new system or evolution?** Evolution. The `class` enum stays as the source of truth for ability sets. Orders are a UX/world layer (halls + bond + recruitment dialog) on top.

---

## 2. Data Model

New table:
```text
character_class_bonds
  character_id uuid  (FK characters, on delete cascade)
  class        app_class enum
  bond         int    default 0   (0..100)
  updated_at   timestamptz
  PRIMARY KEY (character_id, class)
```
RLS: owner read/write own rows; service_role full. Standard GRANTs.

Column additions:
- `characters.is_classless boolean default false` — true only for newly-created chars before they join a hall.
- `nodes.class_hall app_class nullable` — marks a node as a recruitment hall.
- `npcs` reuses existing structure; halls get a "recruiter" NPC whose dialog calls a new `join_order(_character_id, _class)` RPC.

New RPC `join_order(_character_id, _class)`:
- Verify owner.
- Set `characters.class = _class`, `is_classless = false`.
- Upsert `character_class_bonds` row at bond 0 if missing.
- Call `sync_character_resources` to recompute HP/CP/MP/AC.
- Clear `reserved_buffs`.
- Log to `activity_log` (`event_type='general'`, message like "Joined the Order of Iron").

New RPC `switch_order(_character_id, _class)`: same as above, but requires existing bond row (must have visited that hall before? open question — see §6).

Bond award helper `award_class_bond(_character_id, _amount)` called from kill-resolver, exploration triggers, and bounty completion. Caps at 100.

---

## 3. Classless Adventurer Kit

- HP base: 18, AC base: 10 (between healer and warrior).
- No `CLASS_LEVEL_BONUSES` entries — pure player allocation via existing `unspent_stat_points`.
- One built-in CP ability ("Focus Strike", 5 CP, DEX-scaled, ~1d6) so combat isn't just autoattacks.
- Starting gear: universal_starting_gear only (already exists); no `class_starting_gear` granted until they join an order.
- Cannot equip class-restricted items (already enforced by item rules where applicable).

---

## 4. Bond Earning & Tiers

Bond is earned only by the **currently active class**. Sources:
- Creature kill: +1 bond per CR above 0 (cap +5/kill), scaled down past bond 50.
- Boss kill: +5–15 bond.
- Bounty / quest completion: explicit bond payout in the quest.
- Exploration of a new node: +1 bond (small but steady).
- Daily soft cap to avoid grinding: e.g. +30 bond/day, fades over the day.

Tiers (applied as multiplier on ability damage/heal/duration where applicable):
- 0–24: T0 (50%)
- 25–49: T1 (70%)
- 50–74: T2 (85%)
- 75–99: T3 (95%)
- 100: T4 (100%)

Autoattacks are **not** affected — they're identity-level, always 100%. Only class abilities scale. This keeps the floor playable and the ceiling meaningful.

---

## 5. Hall Locations (initial seven)

Placed across existing regions so each is a destination:
- Order of Iron — Warrior
- College of Stars — Wizard
- Wardens of the Wild — Ranger
- Whispered Veil — Rogue
- Choir of Echoes — Bard
- Order of Dawn — Templar
- Circle of Grace — Healer

Each hall is one existing-or-new node with `class_hall` set, a recruiter NPC, and (optionally later) a trainer NPC for bond-gated content. Exact placement = world-build task, not part of this engineering plan.

---

## 6. Open Design Questions (call out before build)

1. **Switching cost:** free, or small gold/renown sink? Recommendation: free in v1.
2. **Visit-to-unlock:** must a player physically visit a hall once to start earning bond there, or does bond start ticking the moment they switch in? Recommendation: must visit (gives halls meaning).
3. **Soulbound items on switch:** wizard staff stays soulbound to the character regardless of class — confirm OK.
4. **Stat respec on switch:** none in v1 — attributes are the player's, not the class's.
5. **Renown vs. Bond:** distinct systems. Renown = lifetime account-wide rep. Bond = per-class mastery on this character.

---

## 7. Rollout Phases

**Phase 0 — Spec lock (no code)**
Resolve the five open questions above. One short follow-up conversation.

**Phase 1 — Bond plumbing, dark-launched**
- Migration: `character_class_bonds` + `nodes.class_hall` + `characters.is_classless` + `join_order`/`switch_order`/`award_class_bond` RPCs.
- Seed all existing characters with bond 100 in their current class.
- Wire `award_class_bond` calls into kill-resolver and exploration, but **bond multiplier is forced to 1.0 in all ability handlers** (no gameplay change yet).
- Admin Tools panel: "Class Bonds" inspector to set/view bond per character.

**Phase 2 — Halls in the world**
- Mark 7 nodes as `class_hall` with recruiter NPCs.
- Recruiter dialog calls `join_order`/`switch_order`.
- Classless kit + tutorial node. ✅ (Phase 2b shipped: `classless` enum, classless creation flow, Classless Adventurer kit defaults, in-world tutorial banner listing all seven halls.)
- Character creation UI: remove class picker, add "Begin as Adventurer" copy. ✅
- Existing characters unaffected. ✅

**Phase 3 — Bond actually matters**
- Turn on bond → ability tier multiplier.
- Tune curves with live data; halve or double earn rates from the admin panel without redeploys (store rates in a config row, similar to `weapon_progression_config`).
- Manual page entries explaining Bond and Orders.

**Phase 4 — Polish & systems on top (future)**
- Bond-gated trainer abilities, class bounties, hall-exclusive vendors, reputation tiers, cosmetic titles.

Each phase is shippable on its own; phases 1 and 2 are invisible-to-gameplay safety nets before phase 3 changes any combat numbers.

---

## 8. Risk & Reversibility

- All schema additions are additive; no column drops, no enum rewrites.
- Seeding existing characters at bond 100 means the live balance does not shift on launch day.
- Bond multiplier is a single number read in one place per ability; reverting phase 3 = hardcode 1.0 and ship.
- Class switching cannot create gear duplication (no class-locked rewards are minted in the switch path).
- No edge function ownership of HP/CP is changed — `sync_character_resources` already handles recompute.

---

## 9. Out of Scope for This Plan

- New ability content per class.
- Guild quests, bounties, reputation tiers (Phase 4).
- Visual hall illustrations (separate art task).
- Account-wide / cross-character bond sharing.
- Removing existing `CLASS_LEVEL_BONUSES` — explicitly kept.

If you approve the recommendations in §1 and answer the five questions in §6, I'll move to Phase 1 in build mode.
