

## Boss Death Cries as Atmospheric Emotes

### Current Behavior

Boss death cries are currently displayed as if the boss is speaking, formatted like:
> 👑 Bone Tyrant: "You will join my army!"

The admin field is labeled "Boss Death Cry" and the server formats the broadcast as `<bossName>: "<cry>"` (in `combat-tick/index.ts`). The frontend then prepends 👑 and appends `<bossName>:` framing.

### Goal

Reframe these as **world emotes / atmospheric flavor** — narrated by the world itself, not the boss. The admin writes a complete sentence (or two) that stands alone, and the broadcast displays it verbatim with no `BossName:` prefix and no quotes. Killer name substitution (`%a`) still works for cases where it fits the line.

Example outputs:
- `🌫️ For a brief moment, something feels… missing. Then the world settles, as if correcting itself.`
- `🌫️ A long-held breath leaves the stones of the ruin.`
- `🌫️ Somewhere far away, a crow stops singing.`

### Design Decisions

| Aspect | Before | After |
|---|---|---|
| Framing | `BossName: "<text>"` | Plain `<text>` (no name, no quotes) |
| Icon | 👑 (crown — "boss speaks") | 🌫️ (mist — "world reacts") |
| Field label (admin) | "Boss Death Cry" | "World Emote on Death" |
| Field helper text | "What the boss shouts when dying" | "An atmospheric line shown to all players when this boss dies. Written as world narration, not the boss speaking. `%a` = killer's name." |
| Placeholder | `"You will join my army!"` | `For a brief moment, something feels… missing. Then the world settles, as if correcting itself.` |
| Server payload | quoted line | raw line |
| Client display | `👑 Name: "..."` | `🌫️ ...` |

### Files Changed

| File | Change |
|---|---|
| `supabase/functions/combat-tick/index.ts` | In the boss-death event push, change `message` from quoted/named form to the raw `cry` (already substitutes `%a`). Drop the `BossName:` prefix and quotation marks. Keep `creature_name` on the event for client-side context (e.g. logging/debugging) but don't use it in the message. |
| `src/features/combat/utils/interpretCombatTickResult.ts` | No change to event handling — already passes `text` through as-is. Confirm no extra formatting is applied. |
| `src/pages/GamePage.tsx` | When forwarding boss death cries to `useGlobalBroadcastSender`, change `icon` from `'👑'` to `'🌫️'` and pass `text` verbatim (no `BossName:` wrapping). The receiver-side renderer already prepends `icon` + space + `text`. |
| `src/components/admin/CreatureManager.tsx` | Rename the field UI: label → "World Emote on Death"; helper text updated to clarify the narrative voice; placeholder updated to the example above. The DB column name `boss_death_cry` stays (no migration needed — internal name only). Visible only when rarity is `boss`. |
| `mem://game/combat-system/boss-flavors.md` | Update memory note: clarify that boss death cries are world-narration emotes (icon 🌫️), distinct from boss crit flavors (which still use boss-voice formatting). |

### Not Changed

- Database schema — column stays `creatures.boss_death_cry`
- Global broadcast plumbing (`useGlobalBroadcast.ts`, `world-global` channel)
- `%a` killer-name substitution behavior
- Boss **crit** flavors (`boss_crit_flavors`) — those remain in-character boss speech and keep their existing format
- Player death broadcasts (still 💀 with name) — only boss deaths become emotes
- Empty `boss_death_cry` still produces no broadcast

### Success Criteria

- Killing a boss with a non-empty emote produces one global log line in the form `🌫️ <emote text>` for every online player — no boss name prefix, no quotation marks.
- Admin Creature Manager shows the field as "World Emote on Death" with the new helper text and example placeholder, only when rarity is boss.
- `%a` placeholder still substitutes the killer's name when used.
- Boss crit lines (a separate field) are unaffected and still read as boss speech.

