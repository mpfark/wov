# Family Names — Founder Model

Reframing the system around **families** rather than "surname ownership." The first user to claim a family name becomes its permanent **Founder**; other users join as **Members** with the founder's approval.

## Concepts

- **Family** — a named house. Identified by a normalized key (lowercase) + display name.
- **Founder** — the user who first claims the family name. Permanent, non-transferable. Has approval/revoke authority.
- **Member** — a user granted permission to apply the family name to their characters. Can leave on their own.
- Users may **found multiple families** and may **belong to multiple families** (as founder of some, member of others).
- A character may carry one family name at a time; setting one at creation, and one change later via the Heraldry NPC.
- Leaving a family does not retroactively rename characters already carrying that name; it only blocks future applications. (Founder revoke behaves the same.)

## Name Rules

Single word, letters only (a–z, A–Z), 2–20 characters. Case-insensitive uniqueness. Banned-word filter and reserved-title filter (no "King", "Prince", etc.).

## Schema (migration)

- `families` — `id`, `key` (unique, lowercase), `display_name`, `founder_user_id`, `created_at`
- `family_members` — `family_id`, `user_id`, `joined_at`, primary key `(family_id, user_id)`. Founder is implicit (not stored here).
- `family_requests` — `id`, `family_id`, `requester_user_id`, `status` (pending|approved|denied|cancelled), `created_at`, `resolved_at`. Unique partial index on `(family_id, requester_user_id) WHERE status='pending'`.
- `characters` — add `family_name` (display casing, denormalized for fast reads) and `family_id` (FK to families).

## RPCs (SECURITY DEFINER, `search_path = public`)

- `check_family_name(_display)` → `{ status: 'available' | 'founder' | 'member' | 'request_pending' | 'needs_request', founder_display_name }`
- `apply_family_to_character(_character_id, _display)` — atomic via `pg_advisory_xact_lock` on the normalized key; founds the family if it doesn't exist, else requires membership.
- `request_family_membership(_display)` — creates a pending request for a family owned by another user.
- `resolve_family_request(_request_id, _approve)` — founder only; on approve inserts into `family_members`.
- `leave_family(_family_id)` — member self-service; founder cannot leave their own family.
- `revoke_family_membership(_family_id, _user_id)` — founder only.

## Frontend

- **CharacterCreation.tsx** — optional family-name input under first name. On blur calls `check_family_name`; inline status: *Available — you'll found this family* / *Your family* / *Member — you may use this* / *Founded by X — Request to join* / *Request pending*. On submit, passes name to the create flow which calls `apply_family_to_character`.
- **HeraldryPanel.tsx** (new, uses `ServicePanelShell`, opened from Heraldry NPC nodes flagged `is_heraldry`). Tabs:
  - *Set / Change family* — change current character's family name once.
  - *My families (Founder)* — list families you founded, with members + revoke, plus incoming join requests.
  - *Memberships* — families you've joined as a member, with **Leave** button.
  - *Outgoing requests* — pending join requests you've sent, with cancel.
- **formatCharacterName(c)** util — `first + (family_name ? ' ' + family_name : '')`. Wire into OnlinePlayersDialog, InspectPlayerDialog, CharacterPanel, PartyPanel, chat, combat logs, admin tables.
- **Notifications** — `useGlobalBroadcast` emits `family_request_created` and `family_request_resolved`.

## Out of Scope

Family trees, transferring founder role, family-wide chat/guild mechanics, renaming characters who already carry a family name when they leave or get revoked.

## Build Order

1. Schema migration (families, family_members, family_requests, characters columns).
2. RPCs + banlist/reserved-name validation.
3. `formatCharacterName` utility + wiring across display surfaces.
4. Character Creation integration.
5. Heraldry NPC node flag + HeraldryPanel + broadcasts.
