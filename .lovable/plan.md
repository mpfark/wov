# Assassin Contract System

A simple bounty loop for the Assassin order: pick up a target at the class hall, hunt it down, get a small bonus on top of the normal kill reward, build a lifetime tally for a future leaderboard.

## How it plays

1. Talk to the Assassin Hall NPC → new dialogue topic **"Take a contract."**
2. The NPC names a real creature in the world that is **L−2 to L+1** of the character, **not a boss**, and tells the player which **area** to look in (same style as the existing hunt direction line).
3. Player goes there and kills the creature.
4. On kill: a banner-style log line fires, the bonus is paid, the lifetime counter ticks, and the contract clears so a new one can be taken.
5. One active contract at a time. The NPC offers **"Abandon contract"** if the player wants to reroll (no penalty, just clears it).

Sample lines:

```text
Hall NPC: Hunt a Frostwolf. They prowl in Hollow Glade, levels 4–6, north-west of here.
On kill:  🗡 Contract fulfilled — Frostwolf put down. +15 XP, +3 gold, +1 Renown.
```

## Reward formula

Bonus = **125%** of the creature's normal kill reward for that single player, applied **only to the contract holder** (party-mates get nothing extra from someone else's contract). Computed off the same `calculateCreatureRewards` math the engine already uses, so it scales correctly with level, rarity and XP boosts.

| Field | Rule |
|---|---|
| XP bonus | 125% of the player's XP from that kill (after level penalty + boost) |
| Gold bonus | 125% of the player's gold share |
| Renown bonus | Only if the target was **rare** — 125% of the rare Renown drop (regular targets give no Renown bonus) |
| Salvage | No bonus |

Bosses are excluded from contracts entirely, so no boss-tier Renown shortcut.

## Targeting rules

When the NPC generates a contract it picks a creature where:

- `creature.level ∈ [char.level − 2, char.level + 1]`
- `creature.rarity ∈ ('regular', 'rare')` — no bosses
- creature actually exists on at least one node with an `area_id`
- prefers same region as the hall, then closest level match, then random tiebreak
- the chosen creature + its anchor area + a cardinal hint are remembered on the character row

## Tracking & future leaderboard

Two new columns on `characters`:

- `active_contract` (jsonb, nullable) — `{ creature_id, creature_name, area_id, area_name, target_level, rarity, issued_at }`
- `contracts_completed` (int, default 0)

`contracts_completed` is the leaderboard metric. Later we can add a "Hall of Blades" panel in the Assassin hall that just `select character_name, contracts_completed from characters where class='assassin' order by contracts_completed desc limit 20`.

## Where the kill is detected

Inside `combat-tick`'s reward loop (the only place that legitimately awards kill rewards, per the kill-resolution memory): after `resolveCreatureKill`, for each recipient whose class is `assassin` and whose `active_contract.creature_id` matches the killed creature, apply the bonus, increment `contracts_completed`, clear `active_contract`, and push a single `contract_complete` event into the player's event stream.

## Technical breakdown (for the dev side)

**DB migration**
- Add `active_contract jsonb` and `contracts_completed integer not null default 0` to `public.characters`.
- New RPC `assassin_take_contract(_character_id uuid)` — `SECURITY DEFINER`, `search_path = public`. Validates: caller owns character, class = 'assassin', no active contract. Picks an eligible creature using the rules above. Writes `active_contract`. Returns the chosen contract.
- New RPC `assassin_abandon_contract(_character_id uuid)` — clears `active_contract`.

**Dialogue layer**
- New `TopicKind` value `assassin_contract` in `src/features/creatures/utils/dialogue-topics.ts`.
- Resolver: if no active contract → "Take a contract" calls the RPC and renders the assignment line. If active → renders current target + adds an "Abandon" sub-action.
- Author the topic on the existing Assassin Hall NPC via a one-row insert (no UI work needed for admins).

**Combat-tick hook**
- In `supabase/functions/combat-tick/index.ts`, after `resolveCreatureKill` returns per-member rewards, loop the recipients: for assassins with a matching `active_contract.creature_id`, compute bonus tokens from that recipient's `MemberReward`, apply via the existing character-update batch, push a `contract_complete` event into `events`, and unset `active_contract`, `contracts_completed = contracts_completed + 1`. Party-mates are skipped — only the contract holder gets paid.

**No changes** to `reward-calculator.ts` or `kill-resolver.ts`. The bonus is layered on top in `combat-tick` so the shared resolver stays pure and party-mates' rewards are unaffected.

**Verification**
- Unit: add a `calculateCreatureRewards` parity test confirming bonus math is `floor(reward * 1.25)`.
- Manual: roll an assassin character, take a contract, kill the named creature solo and in a party, confirm only the holder's tally increments.

## Out of scope (deliberately)

- No leaderboard UI yet — only the counter that feeds it later.
- No timed contracts / expiry.
- No multi-contract stacking.
- No contracts for other classes (architecture leaves room: the dialogue topic + RPC are class-gated, easy to generalize later).