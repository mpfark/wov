# WOV-IDEA-015 — sandbox EXECUTE grant: investigation and owner disposition

## Investigation (read-only, 2026-10-20)

- Grantee: `sandbox_exec_gpclaklkaolyzfnooajt`, the project-scoped sandbox execution principal. Direct EXECUTE grant in the function ACL of `public.base_craft_internal(uuid,uuid,uuid,uuid)`, grantor postgres, not grantable.
- Origin: default-ACL derived. The role holds default EXECUTE on functions in schema public via the platform's default privileges for the migration owner; the grant appeared automatically at function creation during migration 0025, not from the reviewed SQL.
- Reachability: the role is not a browser-authenticatable principal. It has no login path through the app's auth, no anon/authenticated membership, and no exposure through the Data API or Edge runtime. Browser roles (anon, authenticated, PUBLIC) remain denied EXECUTE, verified post-install.
- Tooling interference: revoking the grant would not break the migration workflow (migrations run as the owner, postgres), but the grant is platform-managed and would likely reappear on any future function created by the same tooling; manual revocation would fight the platform default.

## Owner disposition (2026-10-20, Mik Ferdinandsen)

Owner accepts the verified project-scoped `sandbox_exec_*` EXECUTE grant on `base_craft_internal` as a known platform-managed exception. Classification: platform-specific privilege requiring explicit acceptance, not an actual security exposure — no browser, API, or Edge path can reach the principal.

Scope limits of this acceptance:

- The application-level execution contract remains service_role-only; the Edge function `forge-craft-base` remains the only intended caller path.
- This exception covers only this exact grant on this exact function. It does not authorize arbitrary additional EXECUTE grants and does not weaken future ACL verification: any future grant beyond reviewed intent still requires investigation and owner disposition.
- No permissions, migrations, or migration history were changed as part of this disposition.

## Status

0025 ACL blocker RESOLVED by owner acceptance. Next required approval: separate authorization for the `forge-craft-base` Edge Function deployment, then frontend activation and Mik's manual publication. No Edge deployment, publication, or gameplay tests performed.
