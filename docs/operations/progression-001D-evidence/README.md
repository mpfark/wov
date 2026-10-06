# Exact installed Combat2 evidence — 001D

Operator-supplied read-only exports; locally verified before patching. Source HEAD b3950cbb52f25c75242ec9f99a1ffc56b9adc722; sandbox_exec inspection 2026-10-06 12:17:05–12:17:15 UTC. Supplied database/export digests match; Codex did not operate Cloud. Original files: C:\Users\mik\Documents\WoVarneth\001D-hosted-evidence\.

| Function | Exact bytes | SHA-256 |
|---|---:|---|
| node_tick_commit | 1865 | 36edc2dd1d83d3bb9be96af461188ca2f12e8b823741ddfb1e72c74abe0e3489 |
| node_tick_commit_without_character_stances | 1068 | ed8eea68390aa9f910fdbe6b4905d9c41c586c23e3035c3893b5a1afddacb6a6 |
| node_tick_commit_without_authoritative_arrival | 2269 | 5c0ca87eb78a403cb615dfc0e0b4d024a66190898efc6957d87c30c2d4e0d2ac |
| node_tick_commit_without_boss_timing | 1007 | e5a277313c5725d06fb2fea7272347035a703ea7058177f640d16963f7798302 |
| node_tick_commit_without_bounded_failure | 30403 | 617a445c2262696e889ab0715785b5463d32c81a067f3d7ca215fffd0ceb3be9 |

All five identities: public function, arguments (uuid,uuid,integer,integer,bigint,uuid[],jsonb), RETURNS jsonb, SECURITY DEFINER. Owner postgres is supplied catalog metadata (not encoded in pg_get_functiondef); the future payload checks it. Four outer search_paths are public,pg_temp; innermost without_bounded_failure is public. Exact bytes, including LF/end-of-file handling, are preserved without normalization. These are evidence files outside migration discovery, not new migrations or installation instructions.

Run the local generator with --check to verify bytes and deterministic prepared payload; it has no SQL-execution mode. If checkout line-ending conversion changes these hashes, STOP and recover the exact recorded Git blob/export bytes explicitly; never silently normalize evidence to pass. The original exports remain untouched.
