# WOV-IDEA-015 — forge-craft-base Edge deployment result (2026-10-20)

Result: PASS (deployment and refusal checks). Feature NOT LIVE until frontend publication by Mik.

- Source: HEAD 62b9f96a = origin/main, descends from reviewed 8441598f. `forge-craft-base/index.ts` SHA-256 4af8f201475fd72d14afc2e5ae42c15351869a42083bc3e68c178fadc6c23634 and `_shared/base-craft.ts` SHA-256 ba75d0b0d6a9df5f04f2dfff23514e9cce35f7a8beb94f5d0c2c64da707f2c33, both byte-identical to 8441598f.
- RPC prerequisite (read-only, ro=on): base_craft_internal installed, body b9d1e440…, postgres/SECURITY DEFINER, service_role EXECUTE allowed, anon/authenticated denied; 26 migration entries.
- Deployed only forge-craft-base. Submitted source SHA-256 10252f7c046912a871adc3e3f6a8be41aa67bc241650b26073b9e718204f1b3d. JWT config and secrets unchanged.
- OPTIONS: 200, Allow-Origin *, reviewed Allow-Headers including x-supabase-client-platform/runtime(-version).
- GET: 405 {"error":"POST required"}.
- POST without Authorization: 401 {"error":"Sign in to craft."}.
- Identity: handler-specific responses match reviewed source; no revision ID returned, so live-bundle identity remains REQUIRES EVIDENCE.
- Not performed: authenticated crafting, gameplay writes, frontend changes, publication.

Remaining: Mik's manual frontend publication, then a controlled authenticated craft verification (separate approval).
