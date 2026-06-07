# Phase 3 — Activate the Bond Multiplier

Mastery (Bond 0–100, per class) becomes a real combat scalar. The table and `award_class_bond` RPC already exist; this phase wires them into kill rewards, applies the multiplier in shared ability math, and surfaces Bond in the UI.

## Design choices (from your answers)
- **Curve:** Gentle. `bondMult(bond) = 1.00 + (bond / 100) * 0.15` → cap at 1.15×.
- **Scales:** Direct damage, DoT/HoT magnitudes, utility magnitudes. **Not** durations.
- **Gain:** Per kill, XP-shaped — see formula below.
- **Switch cost:** Old class bond **reset to 0** when switching orders. Joining from classless costs nothing.

## Bond gain formula
On a successful kill (live or offscreen), award the killer's *active* class:

```
bondGain = clamp(round(creature.level * 0.5 + isBoss * 5), 1, 25)
```

Roughly: ~50 even-level kills carry you 1 → 100; bosses jump you several points. Classless characters earn nothing (no class to bond with). Bond is capped at 100 by `award_class_bond`.

Party members each get bond for their own active class on shared kills (same trigger point as XP).

## Bond multiplier — where it applies

Single helper in `src/shared/formulas/bond.ts` (mirrored to `_shared/formulas/bond.ts`):

```ts
export function bondMultiplier(bond: number): number {
  return 1 + Math.max(0, Math.min(100, bond)) * 0.0015; // 1.00 → 1.15
}
```

Apply at the **final magnitude step** of the existing pipelines so it stacks cleanly *after* `getEffectiveCombatMod`:

- **Direct damage** — `combat-resolver` final damage line (autoattacks + ability direct hits).
- **DoT/HoT** — per-tick magnitude in `active_effects` application sites (Rend, Ignite burn, Envenom, Consecrate, Purifying Light, Transfer Health tick).
- **Utility** — Sunder armor reduction, Nature's Snare root strength, debuff potency numbers (anything currently fed through `effective.utility`).

**Explicitly not touched:** durations, cooldowns, CP/MP costs, hit chance, AC, autoattack speed, weapon-proc magnitudes (those are item-driven, not class-driven).

The multiplier reads bond for the character's **current** class only. Classless = 1.00× pass-through.

## Switch cost wiring

Update `join_order` RPC: when switching from one class to another (i.e., `OLD.class IS NOT NULL AND OLD.class <> _class AND OLD.is_classless = false`), zero out the prior class row before upserting the new one. Joining from classless leaves nothing to wipe. Add a one-line confirmation in `OrderRecruiterDialog` so players see the cost before they confirm a switch.

## UI surfacing

- **CharacterPanel → Attributes tab:** small "Bond" row under class — progress bar `bond / 100` with current multiplier (`×1.07`) next to it. Reuse existing parchment styling.
- **OrderRecruiterDialog (switch path):** add a warning line "Switching will reset your {oldClass} Bond ({n} → 0)." with the standard destructive-action button color.
- **Activity log:** `general` event "Bond with {class} deepens (+{n}, now {total})." emitted from the bond-award site, throttled so we don't spam (only log when crossing each 10-point threshold).

No combat log changes — the multiplier is invisible in numbers, players feel it through pacing.

## Technical details

- **New SQL function** `award_class_bond_for_kill(_character_id, _creature_level, _is_boss)` — wraps the formula + `award_class_bond` + the threshold-crossing log, server-side so live and offscreen paths can't disagree.
- **Call site (live):** in the kill-resolver reward block where `award_party_member` is invoked today, add a sibling call per recipient.
- **Call site (offscreen):** same module already centralizes this — one edit covers both.
- **`join_order` patch:** delete prior-class bond row in the same transaction as the class swap so it's atomic.
- **Shared formula parity:** add `bond.ts` to both `src/shared/formulas/` and `supabase/functions/_shared/formulas/` and include it in the existing `formula-parity.test.ts`.
- **Unit tests:** `bond.test.ts` covering `bondMultiplier(0)=1`, `bondMultiplier(100)=1.15`, clamp on negatives/overshoot. Extend an existing combat resolver test to assert a 100-bond character deals exactly `floor(base * 1.15)` direct damage.
- **Types regen** after the migration; then update `useCharacter` to expose the active-class bond row for the UI.

## Rollout

1. Migration: `award_class_bond_for_kill` SQL function; patch `join_order` to reset prior bond.
2. Shared `bond.ts` (src + edge mirror) + unit test + parity test.
3. Wire `bondMultiplier` into damage / DoT / utility application sites in `combat-resolver` and ability files.
4. Wire `award_class_bond_for_kill` into the kill-resolver reward block (covers live + offscreen).
5. Surface Bond row in CharacterPanel Attributes tab; add switch warning to `OrderRecruiterDialog`.
6. Activity log entry on threshold crossings.
7. Update `.lovable/plan.md` and the relevant memory files (progression-system, class-progression).

## Out of scope (deferred)
- Bond-gated abilities or perks (e.g. "ability X unlocks at Bond 50").
- Bond-driven cosmetic titles.
- Cross-class Bond synergies.

Approve and I'll implement.