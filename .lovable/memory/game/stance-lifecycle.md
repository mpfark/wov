---
name: Stance lifecycle policy
description: Approved rules for stance activation, CP reservation, logout, death, and the stance-vs-target-stack separation
type: feature
---

Approved lifecycle for CP-reservation stances (Ignite/Orbs of Fire, Envenom, Eagle Eye,
Arcane Surge, Battle Cry, Shield Wall, Force Shield, Holy Shield):

- Activation reserves CP (never refunded on drop); `activate_stance` / `drop_stance` are authoritative.
- **Logout/offline: the stance drops.** Reserved CP is released at logout; the player re-activates after login.
- **Death: the stance ends** and reserved CP is released.
- Reserved CP must be released exactly once per stance end (drop, replace, death, logout).
- Separation of authority:
  - `characters.reserved_buffs` / `stance_state` = activation + reservation bookkeeping (and Force Shield remaining HP).
  - Stance semantic combat behaviour is stance-lifetime, not timed: it must survive activation commit -> next snapshot -> later live ticks.
  - Ignite/Envenom **target stacks** are separate creature-side effects with their own finite expiry and stack rules; never the same row as the character's stance.
- `durationMs = 0` must never mean both "one tick" and "persistent" — persistence is an explicit lifetime in the effect contract.
