# Character Portrait Generator

A new "Portrait" tab in the Character Panel where the player describes their character (free-text), picks a height and body type, and clicks **Generate** to produce a single AI illustration of the character wearing their currently equipped gear. Limited to **one generation per character per 24h**.

## UX

New 4th tab in `CharacterPanel.tsx` (next to Equipment / Inventory / Attributes), titled **Portrait**.

Layout (top → bottom):
1. **Inputs** (collapsible once a portrait exists):
   - Description (textarea, max 500 chars) — e.g. "Scarred veteran with silver braids and a crooked nose."
   - Height (select): Short / Average / Tall
   - Body type (select): Lean / Average / Muscular / Heavyset
2. **Generate button**:
   - Disabled when on cooldown; shows "Next portrait available in Xh Ym".
   - Disabled while generation is in flight (spinner).
3. **Portrait area**:
   - If a portrait exists: show the image (square, framed in the same parchment style as `ItemIllustration`).
   - Below the image: small caption with the generation timestamp.
   - If none yet: empty-state hint ("Describe your character above and forge their likeness.").

The cooldown is **per character**, not per user, so each character can have its own portrait.

## Data

New columns on `characters`:
- `portrait_url text not null default ''`
- `portrait_metadata jsonb not null default '{}'::jsonb` — stores `{ description, height, body_type, generated_at }` so we can re-show the inputs.
- `portrait_generated_at timestamptz null` — used to enforce the 24h cooldown server-side.

No new RLS needed; the `characters` policies already cover owner read/write. The edge function uses the service role for the actual update so the cooldown check is authoritative.

## Edge function: `ai-character-portrait`

Modeled directly on `supabase/functions/ai-item-illustration/index.ts` so the visual baseline matches:

- Auth: validate JWT, load character, ensure `auth.uid() = characters.user_id` (no admin bypass needed).
- Rate limit: reject if `portrait_generated_at` is within the last 24h. Return 429 with `next_available_at` in the body so the client can render the countdown.
- Input validation (zod): `character_id uuid`, `description string ≤ 500`, `height ∈ {short, average, tall}`, `body_type ∈ {lean, average, muscular, heavyset}`.
- Build prompt (see below), call the same `google/gemini-3.1-flash-image-preview` model with `modalities: ["image", "text"]`.
- Upload to a new public bucket `character-portraits` at path `{character_id}-{timestamp}.png`.
- Update `characters.portrait_url`, `portrait_metadata`, `portrait_generated_at`.
- Return `{ portrait_url, generated_at }`.

Storage: create bucket `character-portraits` (public read), service-role write only.

## Prompt — keeps the same baseline

A new helper `src/lib/character-portrait-prompt.ts` (mirrored inline in the edge function, exactly like the item illustration pattern) produces:

```
A single hero-shot full-body portrait of {Race} {Class} named "{Name}".
Appearance: {description}.
Build: {height}, {body_type}.
Equipped gear: {comma-separated list of equipped item names with slot, e.g. "longsword (main hand), kite shield (off hand), chainmail hauberk (chest)"}.
Style: masterwork craftsmanship, fine materials and restrained ornamentation, faint magical character — no glowing runes, no gemstone encrustation, no radiant aura.
Dark fantasy painterly art, dramatic chiaroscuro lighting against a deep neutral background, centered framing, no text, no watermark, no border, square 1:1 composition, character only — no extra figures, no background scenery.
```

This reuses the same restrained `unique`-tier wording from the recently toned-down `RARITY_STYLE.unique`, plus the same painterly suffix, so portraits sit visually next to item illustrations without a stylistic mismatch.

## Frontend

New files:
- `src/features/character/components/PortraitTab.tsx` — the tab body (inputs + button + image).
- `src/features/character/hooks/useCharacterPortrait.ts` — wraps `supabase.functions.invoke('ai-character-portrait', …)`, exposes `generate`, `isGenerating`, `cooldownEndsAt`, `portraitUrl`, `metadata`.
- `src/lib/character-portrait-prompt.ts` — frontend mirror of the prompt builder (used only for an optional "preview prompt" debug; the edge function is the source of truth).

Edits:
- `CharacterPanel.tsx`: add a `portrait` tab trigger and `<TabsContent value="portrait">` mounting `PortraitTab`. Tab must be **locked in combat** (consistent with the existing 3-tab combat lock noted in memory `features/character-panel/layout`).
- `useCharacter.ts`: include the new columns in the character select so `portrait_url` / `portrait_metadata` / `portrait_generated_at` are available without an extra fetch.

## Cooldown (client display)

Client reads `portrait_generated_at` from the character row, computes `nextAt = generatedAt + 24h`, and shows a live countdown (refreshes every minute). The server still enforces the actual limit; the client is purely informational.

## Out of scope

- Multiple saved portraits / history.
- Manual prompt override (admin-only, can be added later).
- Per-equipment-change auto-regeneration.
- Sharing the portrait outside the character panel (e.g. inspect dialog) — easy follow-up once the column exists.

## Technical summary

| Area | Change |
|---|---|
| DB migration | Add `portrait_url`, `portrait_metadata`, `portrait_generated_at` to `characters` |
| Storage | New public bucket `character-portraits` |
| Edge function | New `ai-character-portrait` (auth + 24h cooldown + Lovable AI image gen + storage upload + characters update) |
| Frontend | New `PortraitTab.tsx`, `useCharacterPortrait.ts`, `character-portrait-prompt.ts`; wire into `CharacterPanel` as a 4th tab |
| Memory | Update `features/character-panel/layout` from "3-tabs" to "4-tabs (Equipment / Inventory / Attributes / Portrait), locked in combat" |
