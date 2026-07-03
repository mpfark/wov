## Goal

Produce a clear reference for how a brand-new user goes from the sign-up screen all the way to standing in Hearthvale Square for the first time — no code changes.

## Deliverables

1. **Mermaid flowchart artifact** saved to `/mnt/documents/login-flow.mmd` and embedded via `<lov-artifact>` so it renders inline. Covers both the new-user and returning-user branches side-by-side so you can see where they diverge and re-converge.
2. **Written walkthrough** in chat that narrates each stage, names the component/hook responsible, and calls out the state that gates each transition.

## Stages to cover

Based on `src/pages/Index.tsx`, `GameContext`, `useAuth`, `useCharacter`, and `useFirstEntryWelcome`:

```text
AuthPage (sign up / sign in / forgot password)
   │
   ▼
Supabase auth session established  ── useAuth ──► GameContext.user set
   │
   ▼
Profile fetch (authLoading gate prevents the old login-flash)
   │
   ├── has_accepted_oath + full_name missing ──► OnboardingGatePage
   │                                                │
   │                                                ▼
   │                                        refetchProfile → onboarding complete
   ▼
Character list load (useCharacter)
   │
   ├── characters.length === 0 ──► CharacterCreation (needs startingNode)
   │                                    │
   │                                    ▼
   │                            createCharacter → selectCharacterAfterCreate
   │
   └── characters.length > 0 ──► CharacterSelect ──► selectCharacter
   │
   ▼
character set in context → Index.tsx effect navigates to /game
   │
   ▼
GameRoute / GamePage mounts
   │
   ▼
useFirstEntryWelcome
   ├── first ever entry (level ≤ 1, no localStorage flag) ──► staggered intro lines
   └── otherwise ──► "Welcome back, Wayfarer!"
```

The diagram will use the same nodes but with proper Mermaid `flowchart TD` syntax, decision diamonds for the gates (auth? onboarding? has characters? first entry?), and grouped subgraphs for **Auth**, **Profile/Onboarding**, **Character**, and **World Entry**.

## Written walkthrough sections

- **1. Gateway** — `AuthPage` sign-up path, password rules, email confirmation toast.
- **2. Session hydration** — `useAuth` listener + `getSession`, and why `GameContext.fetchProfile` waits on `authLoading` (prevents the login-screen flicker you reported earlier).
- **3. Onboarding gate** — `OnboardingGatePage` triggers when `has_accepted_oath` is false or `full_name` is empty; `refetchProfile` re-runs the check.
- **4. Character stage** — Empty roster jumps straight to `CharacterCreation`; otherwise `CharacterSelect`. Note the `startingNode` (Hearthvale Square) requirement.
- **5. Handoff to game** — `Index.tsx` effect that navigates to `/game` once a character is selected.
- **6. First entry** — `useFirstEntryWelcome` fires the 7-line staggered intro only for level ≤ 1 characters without the per-character localStorage flag; returning characters get the short greeting.

## Out of scope

No code changes. No new components. Purely documentation.
