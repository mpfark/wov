# Admin maintenance backlog

This is the canonical queue for admin correctness and design work. Completed items describe shipped repository safeguards, not server-side idempotency.

| ID | Page/domain | Category | Problem and impact | Dependencies / decision | Migration | Edge | Frontend | Batch | Status |
|---|---|---|---|---|---|---|---|---|---|
| ADM-001 | Item Manager | async safety | Duplicate saves, stale usage responses and unconfirmed deletes could produce confusing or repeated browser writes. | None | No | No | Yes | Technical batch 0 | completed |
| ADM-002 | NPC Manager | async safety | Save/delete actions needed synchronous fencing and session-scoped feedback. | None | No | No | Yes | Technical batch 1 | completed |
| ADM-003 | Race Manager | async safety | Save/delete could duplicate; deletion lacked named confirmation. | None | No | No | Yes | Technical batch 1 | completed |
| ADM-004 | Status Manager | async safety | Save relied only on React pending state; obsolete sessions could receive feedback. | None | No | No | Yes | Technical batch 1 | completed |
| ADM-005 | Area Manager | async safety | Save/delete and AI suggestion completions were not session fenced. | None | No | No | Yes | Technical batch 1 | completed |
| ADM-006 | XP Boost | correctness | Duplicate toggles were possible and malformed duration could create an invalid expiry. | None | No | No | Yes | Technical batch 1 | completed |
| ADM-007 | Issues | async safety | Filter loads could race; status/delete writes could duplicate; delete confirmation did not identify the report. | None | No | No | Yes | Technical batch 1 | completed |
| ADM-008 | Roadmap | async safety | Create/update/toggle/delete lacked a synchronous fence and mutation errors were ignored. | None | No | No | Yes | Technical batch 1 | completed |
| ADM-010 | World Map / Node Editor | authority/atomicity | Ordinary reciprocal create/edit/remove now use an expected-state, idempotent transactional RPC. Intentional one-way/special paths are refused and preserved. | Install migration and regenerate types. Adjacent-node creation remains ADM-012. | Yes | No | Yes | Technical batch 2B | completed |
| ADM-011 | Area Types | authority/atomicity | Rename formerly updated areas, created a type and deleted the old type in separate browser steps. Atomic admin RPC now owns rename and durable replay. | Install pending migration and regenerate types. | Yes | No | Yes | Technical batch 2A | completed |
| ADM-012 | Regions | authority/atomicity | Region plus initial-node creation is multi-step and may partially complete. | Authoritative transaction/RPC. | Likely | No | Yes | Technical batch 2 | open |
| ADM-013 | Batch Node Editor | authority/atomicity | Multi-node updates have partial-write exposure. | Define all-or-nothing behavior. | Likely | No | Yes | Technical batch 2 | open |
| ADM-014 | Loot Tables | authority/atomicity | Header/entry mutations need a focused partial-failure and duplicate-write review. | Establish transaction boundary. | Maybe | No | Yes | Technical batch 2 | open |
| ADM-015 | Users / Characters | authority/atomicity | Level and remaining character edits may use sequential server calls. | Define atomic admin update contract. | Maybe | Yes | Yes | Technical batch 2 | open |
| ADM-016 | Guide | correctness | Ordering and category/entry deletion consistency need focused review. | Define deletion/reorder semantics. | Maybe | No | Yes | Technical batch 2 | open |
| ADM-020 | Node Editor | performance | Loads complete item, creature and NPC catalogues for local pickers and repeatedly reloads them. | Add scoped/paginated search without weakening selection. | No | No | Yes | Query batch | open |
| ADM-021 | Items | product decision | Ownership of `tier`, `weapon_die`, `world_drop` and `drop_weight` is unclear between authoring and generated runtime records. | Product/data-owner decision required. | Unknown | No | Yes | Contract batch | blocked |
| ADM-022 | Statuses | product decision | Buff/debuff terminology does not map cleanly to every active reusable status classification. | Agree player/admin taxonomy first. | No | No | Yes | Contract batch | blocked |
| ADM-023 | Abilities | product decision | Legacy ability aliases remain active compatibility inputs and cannot safely be removed from editors/runtime independently. | Retirement plan and data inventory required. | Likely | Possibly | Yes | Contract batch | blocked |
| ADM-024 | Combat2 summons | product decision | Authoritative summon editing semantics and ownership are not yet defined. | Combat2 contract decision required. | Unknown | Unknown | Yes | Contract batch | blocked |
| ADM-030 | All admin pages | design | Full responsive layout, action hierarchy, density and accessibility review remains outstanding. | Complete technical correctness batches first. | No | No | Yes | Design audit | open |

## Next recommended batch

Implement ADM-012 next: atomic region creation with an optional initial node, including the deferred adjacent-node-plus-parent-connection workflow. Then address batch-node and loot-table atomicity.
