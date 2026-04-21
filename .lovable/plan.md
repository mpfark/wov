

## Template Variables for Proc Log Text

Replace the hardcoded sentence structure in `formatProcMessage` with user-authored template strings that support placeholder variables.

### How it works

The `text` field in each proc entry becomes a full template string instead of a verb fragment. Available placeholders:

- `%a` -- attacker name (e.g. "Hero")
- `%e` -- enemy/target name (e.g. "Goblin")
- `%v` -- the proc's value (e.g. "5")

The formatter simply does string replacement and prepends the emoji. The type-specific suffix (e.g. `(+5 HP)`) is still auto-appended based on proc type so you don't have to repeat it.

**Example authored text:** `%a's blade drains the life from %e`
**Rendered result:** `💚 Hero's blade drains the life from Goblin! (+5 HP)`

### Changes

**1. `supabase/functions/_shared/proc-log-format.ts`** -- update `formatProcMessage`
- Replace the hardcoded `"{emoji} {attacker}'s weapon {text} {target}!{suffix}"` template
- Instead: replace `%a` with attacker name, `%e` with target name, `%v` with value in the `text` field
- Prepend emoji, append `!` and type suffix
- Result: `"{emoji} {interpolated text}!{suffix}"`

**2. `src/components/admin/ItemManager.tsx`** -- update proc editor UI
- Add a helper hint beneath the text input showing available placeholders: `%a = attacker, %e = enemy, %v = value`
- The existing live preview already calls `formatProcMessage` so it will reflect the new format automatically

**3. Deploy `combat-tick`** -- picks up the shared formatter change

### Files

| File | Action |
|------|--------|
| `supabase/functions/_shared/proc-log-format.ts` | Update formatter to use `%a`/`%e`/`%v` replacement |
| `src/components/admin/ItemManager.tsx` | Add placeholder hint text below proc text input |
| `combat-tick` edge function | Redeploy |

