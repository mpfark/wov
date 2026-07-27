## Goal

Give boss telegraphed casts admin-authored flavor text (a "casting" line and a "lands" line), and make **boss crit flavors use the exact same placeholder system**, so all boss text is authored the same way.

Current state:
- Cast start/hit lines are hardcoded in `combat-tick`:
  - `{emoji} {creature} begins channeling {label}! Flee the node to avoid it.`
  - `{emoji} {creature}'s {label} strikes {member}! [{dmg}]`
- `boss_crit_flavors` (jsonb array of `{name, text, emoji, weight, damage_type}`) is picked at random on a boss crit and passed through as static text — no substitution.

## Shared placeholder system

One small `renderFlavor(template, vars)` helper, used by cast text and crit text alike:

| Token | Meaning |
| --- | --- |
| `{creature}` | Boss name |
| `{target}` | Character being hit (blank on cast-start) |
| `{cast}` | Cast label (cast lines) / flavor name (crit lines) |
| `{damage}` | Damage number |

Rules: trim, strip newlines, cap ~240 chars, unknown tokens left literal, `{damage}` respects the existing flavor-only/numbers setting via the canonical `[N]` suffix (no duplicate number when authored inline).

## What to build

**1. Two new fields on `creatures.boss_cast` (JSONB, no migration)**
- `cast_flavor` — emitted as the `boss_cast_start` message
- `hit_flavor` — emitted per hit target on resolution
- Blank → current default wording, so all 16 existing bosses are unaffected.

**2. Admin UI — `CreatureManager.tsx`**
- Boss Cast card: two textareas (`cast_flavor`, `hit_flavor`) with placeholder help + live preview of the rendered line (falls back to showing the default when blank).
- Boss Crit Flavors list: same placeholder help text and live preview per flavor row, so both cards read identically.
- A single shared `FlavorField` component in the admin folder to avoid duplicated help/preview markup.

**3. Edge function — `supabase/functions/combat-tick/index.ts`**
- Add `renderFlavor`; apply it to cast start, cast hit, and the selected boss crit flavor `text` before it is attached to the crit event.
- Mirror the helper location alongside the other shared combat utilities so client-side previews and the server agree.

**4. Docs**
- Update the boss input template / manual notes with the placeholder table and the two new cast fields.

## Notes

- Crit flavors keep their existing shape (name/emoji/weight/damage_type) — only the `text` gains substitution, so existing entries stay valid.
- Cast-miss (all players fled, boss heals) keeps its current handling; say the word if you want a third `miss_flavor` field.
