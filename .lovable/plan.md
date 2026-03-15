

## Fix: Late Combat Hit After Fleeing (Solo + Party)

### Root Cause

Line 166 only sets `isDotOnly = true` when `engagedIds` is empty. But a tick can fire with stale `engagedIds` after the player/party has already moved. The solo early-return (lines 104-116) only exits when there are no DoTs — otherwise it falls through to full combat with creature counterattacks.

### Fix (single location in `combat-tick/index.ts`)

After the members array is built (line 120), add a node-presence check:

```typescript
const anyMemberAtNode = members.some(m => m.c.current_node_id === node_id);
const isDotOnly = !anyMemberAtNode || (engagedIds.length === 0 && dotTargetIds.size > 0);
```

Replace the current line 166. This covers:
- **Solo**: Player fled → `members[0].c.current_node_id !== node_id` → `isDotOnly = true` → no auto-attacks, no creature counterattacks, DoTs still tick
- **Party**: All members fled → same logic → DoT-only mode
- **Party partial**: Some members still at node → `anyMemberAtNode = true` → normal combat continues for those present (correct behavior)

If `!anyMemberAtNode` and no DoTs exist, the solo early-return on line 113 already handles that case. For party mode, `members` would be empty (filtered on line 91), hitting the early return on line 120.

### Files Changed
- `supabase/functions/combat-tick/index.ts` — Replace line 166 (~2 lines)

