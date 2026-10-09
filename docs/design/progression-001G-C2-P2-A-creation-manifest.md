# C2 initial creation manifest

The owner approves initial values from canonical source/design and **Overlord-only
approval of future catalog revisions** in the P2-A continuation. This resolves the
previous O13 approval-authority blocker; it does not add a catalog-edit/publication API.

[Immutable revision contents](progression-001G-C2-P2-A-creation-manifest.json) are embedded
verbatim in the private SQL operation and checked by local tests. No mutable row or
updated_at value substitutes for a revision. A future revision requires Overlord
approval, new affected version identities and a reviewed forward SQL replacement.
Never reuse these identities with different values or rewrite existing origins.

| Identity | Frozen meaning |
|---|---|
| `creation-c2-v1` | Base8; L1/XP0/gold200; five retained characters; trimmed display name <=40; own/Overlord delegation; familyless, itemless Wayfarer; zero discretionary/respec/Renown/growth grants |
| `race-c2-v1` | Six canonical race delta vectors, every attribute explicit |
| `class-c2-v1` | Creation-relevant classless Wayfarer: active, pre-class, not selectable as an Order, HP18/AC10, no growth bonuses |
| `formula-c2-v1` | Approved L1, no-gear modifier/full-resource/base-AC arithmetic and server caps |

The race JSON pins the current canonical source constants: Human1/1/1/1/1/1,
Elf-1/2/-1/2/3/0, Dwarf2/-1/4/0/1/-2, Halfling-2/3/1/0/1/2,
Edain1/0/3/1/1/1, Half-Elf0/1/0/1/2/3, in STR/DEX/CON/INT/WIS/CHA order.
For new requests, read-lock selected race and classless catalog rows, require matching
pinned creation values/status/flags and refuse drift. Calculate from approved pinned
inputs; missing/inactive/different catalog values do not invoke a fallback. Replays
return immutable applied results before current catalog checks.

With m(x)=floor((x-10)/2), no gear, L1:

- HP=clamp(18+2m(CON),1,10000).
- CP=clamp(30+3[max(m(INT),0)+max(m(WIS),0)],0,5000).
- MP=clamp(100+10max(m(DEX),0),0,5000).
- Base AC=10+m(DEX); currents equal maxima.

Initial materials are salvage40 and one each garnet/topaz/emerald/sapphire/pearl/amethyst.
The existing trigger remains the sole grant. No crafting XP is earned, no inventory
or equipment is inserted and no family is assigned. Six-race HP/CP/MP/AC vectors
remain 16/30/100/9,14/30/100/10,20/30/100/8,16/30/100/10,18/30/100/9,16/30/100/9.

## Sources and resolved differences

- [Canonical race constants](../../src/shared/formulas/races.ts#L31),
  [creation base8/classless zero bonuses](../../src/lib/game-data.ts#L68),
  [class constants](../../src/shared/formulas/classes.ts#L28) and
  [catalog seed](../../supabase/migrations/20260731134850_336008d6-3bf4-4dcc-8f5d-53498b5591bf.sql#L40).
- [Resources](../../src/shared/formulas/resources.ts), [modifier](../../src/shared/formulas/stats.ts)
  and [approved C2 initial-fill/caps](progression-001G-C2-creation-blueprint.md#4-transaction-calculation-and-replay-architecture-p).
- Source registry constants are ordinarily mutable fallbacks; this task's explicit
  owner approval pins those initial values as this creation revision. Runtime registry
  edits still affect their existing consumers, but cannot silently change this origin.
- Schema attribute10/default pools and client-computed legacy INSERT inputs are not
  canonical creation authority. Approved base8/server full-pool rules resolve those
  differences. C's ordinary sync clamps current pools; creation intentionally fills
  them, without invoking or changing that helper.

No unresolved gameplay-value conflict was found. Installed rows that disagree with
the approved manifest stop new creation; investigate and obtain Overlord approval
for a genuine new revision rather than changing historic characters or auto-fixing catalogs.
