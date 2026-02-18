

## Add Healer Tier 3 and Tier 4 Abilities

The Healer already has Tier 1 (Transfer Health, Level 5) and Tier 2 (Heal, Level 10). This plan adds Tier 3 and Tier 4.

### New Abilities

**Tier 3 -- Purifying Light (Level 15)**
- A party-wide heal-over-time, mirroring the Bard's Crescendo but themed as divine radiance
- Heals all allies at the same node every 3 seconds, scaling with WIS
- Uses the existing `party_regen` ability type (already implemented for Bard)
- Cooldown: 60s
- Emoji: `✨💚`

**Tier 4 -- Divine Aegis (Level 20)**
- Creates an absorb shield on a targeted ally (or self), soaking incoming damage before HP
- Shield amount scales with WIS: `WIS modifier * 5 + character level`
- Duration: 12s + WIS modifier (capped at 20s)
- Uses the existing `absorb_buff` type but requires a new `ally_absorb` type so it can target party members
- Cooldown: 90s
- Emoji: `🛡️💚`

### Technical Details

**`src/lib/class-abilities.ts`**
- Add `ally_absorb` to the type union on `ClassAbility`
- Add Purifying Light (tier 3, `party_regen`) and Divine Aegis (tier 4, `ally_absorb`) to `CLASS_ABILITIES.healer`

**`src/pages/GamePage.tsx`**
- The `party_regen` handler already exists (from Bard's Crescendo) -- Purifying Light will reuse it, scaling with WIS instead of CHA based on character class
- Add `ally_absorb` handler: if a heal target is selected, apply absorb shield to that ally via a new mechanism; if no target or self, apply to self (reuse existing `absorbBuff` state)
- For ally targeting, use the existing `healTarget` selector already shown for `hp_transfer`

**`src/components/game/CharacterPanel.tsx`**
- No changes needed -- `partyRegenBuff` display already exists from Bard implementation

**`src/components/game/NodeView.tsx`**
- The target selector already appears for the Healer due to `hp_transfer`. Divine Aegis will also use it by checking for `ally_absorb` in the `hasTargetedAbility` logic.

### Design Notes
- Purifying Light gives Healers a strong group sustain tool, reinforcing their role as the premier support class
- Divine Aegis lets Healers proactively shield allies before big damage, adding tactical depth beyond reactive healing
- Both abilities reuse existing patterns (party_regen, absorb) keeping the implementation lean
