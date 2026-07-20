## Buff CON → Max HP (2×)

Double CON's contribution to Max HP. Regen stays as-is.

### New formula

```
Max HP = CLASS_BASE_HP + 2 * floor((CON - 10) / 2) + (level - 1) * 5
```

Examples: CON 14 → +4 HP, CON 20 → +10 HP, CON 30 → +20 HP.

### Changes

1. **`src/shared/formulas/resources.ts`** — update `getMaxHp` to multiply the CON modifier by 2. Update the JSDoc line describing the formula.

2. **SQL mirror** — migration updating `public.sync_character_resources()` so its `max_hp` calculation matches (currently mirrors the TS version). This RPC is called on level-up, gear change, and resource sync, so all existing characters will pick up the new max the next time it runs.

3. **Backfill** — same migration calls `sync_character_resources()` (or equivalent update) across all rows in `public.characters` once, so live characters immediately see the higher cap without waiting for a trigger. Current HP is left untouched (players don't get free healing; they just have more headroom).

4. **Deno mirror** — `supabase/functions/_shared/formulas/resources.ts` is a byte-for-byte mirror of the TS module; update it identically so edge functions (combat-tick, kill-resolver, etc.) compute the same cap.

5. **Tests** — update `src/lib/__tests__/effective-caps.test.ts` and any formula-parity tests that assert exact HP numbers.

### Not changing

- HP regen (`getStatRegen`) — untouched per your answer.
- CP/MP formulas.
- CON stat tooltip in `statContributions.ts` — the "HP regen" effect it lists is still correct; max HP is already shown in the derived stats row and will update automatically.
