## Tone down item illustration "glimmer"

The flashy look comes from the `RARITY_STYLE` map used when building the item illustration prompt. The `unique` entry currently reads:

> ornate, jeweled, glowing arcane runes, masterwork, legendary aura

…which pushes Gemini toward gem-encrusted, glowing, over-the-top results. The base style suffix ("Dark fantasy painterly art…") is fine — only the rarity descriptors need toning down.

### Changes

Update `RARITY_STYLE` in **both** locations (they must stay in sync — frontend preview prompt and the edge function that actually calls the AI):

- `src/lib/item-illustration-prompt.ts`
- `supabase/functions/ai-item-illustration/index.ts`

Proposed new values (grounded, realistic dark-fantasy):

```ts
const RARITY_STYLE = {
  common:   "weathered, simple craftsmanship, plain materials, utilitarian",
  uncommon: "well-crafted, clean lines, subtle quality details, no magical glow",
  unique:   "masterwork craftsmanship, fine materials and restrained ornamentation, faint magical character — no glowing runes, no gemstone encrustation, no radiant aura",
};
```

Key intent for `unique`: explicit *negative* cues ("no glowing runes, no gemstone encrustation, no radiant aura") because Gemini tends to over-bling fantasy items unless told otherwise. Keeps it special-looking but grounded.

No other code paths change. Existing items keep their saved illustrations; only newly generated ones use the new prompt.

### Out of scope

- Per-item style overrides (already supported via `metadata.prompt_override`).
- The base painterly style suffix.
- The item-forge text generation (separate prompt).
