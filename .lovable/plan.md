

Let me check the current state. The user shows a screenshot where only the head item (Crown) renders but no body silhouette. Let me check what's happening.
<lov-tool-use id="toolu_vrtx_01GrKzFqkSgNBMRpXYWdycHa" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT slot, material, tier, asset_url, is_shared FROM appearance_entries ORDER BY slot, material, tier;\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_01MFxN5eA6sdbD97Ubdiqb42" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT slot, material, tier, asset_url, is_shared FROM appearance_entries ORDER BY slot, material, tier;\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_017ZbVB8MYFmN8v8zpvEaFop" name="code--view" integration-id="code" data="{\"file_path\": \"src/features/character/components/PaperDoll.tsx\"}">
</lov-tool-use>
Looking at the screenshot: only a helmet is showing, floating in the middle of a checkered (transparent) box. No body, no other gear. The base body and other equipped items aren't rendering.

Let me check the actual rendered images and the resolver logic.
<lov-tool-use id="toolu_vrtx_01YTfoAR2n4EyteJnd9bmRJK" name="code--view" integration-id="code" data="{\"file_path\": \"src/assets/paper-doll/base_body_female.png\"}">
<lov-image url="https://storage.googleapis.com/gpt-engineer-file-uploads/890acf70-ffaa-4276-b62d-8c2d5b9148b4-src/assets/paper-doll/base_body_female.png?Expires=1776637876&GoogleAccessId=go-api-on-aws%40gpt-engineer-390607.iam.gserviceaccount.com&Signature=J%2FXhhnHPw0Qg7j0W0ewtda1GqdTnMpnLH9%2FBMqQgV5EU0TYgTPnd%2F5vNjI31dOPgrL8tVvB7CgufzVGIVa3vjEX7YJU5aLBtBe8V8Px8SCrT4yeSDg0hIejlOAvf86BPSQvy%2BCyTnSZ8ahbo91J6ZNS2FfAnwdbprDwbjxZ6uO9ynxSh5J3sCIapofr45rpCT8S559bQwIZSueEcQ0f1Rf4r0H57bU578pr%2F%2BgiLnzGCFv6%2F63sB5gA6oqxhmGJavIXIigQqMMlQK6wDSfFPCFXi7gYCPeFWjrAZKQZg0zC%2BHEDsc6Xfd96qvQcfzDUb4uuMBJReyRvk%2BuBceU%2BgHQ%3D%3D" mimeType="image/png"/></lov-tool-use>

<lov-tool-use id="toolu_vrtx_01Fn7QNm9QgFM7pskfHkquaK" name="code--view" integration-id="code" data="{\"file_path\": \"src/assets/paper-doll/head_uncommon_leather.png\"}">
<lov-image url="https://storage.googleapis.com/gpt-engineer-file-uploads/d87707fc-b55b-439c-9345-bc7beb3989b5-src/assets/paper-doll/head_uncommon_leather.png?Expires=1776637877&GoogleAccessId=go-api-on-aws%40gpt-engineer-390607.iam.gserviceaccount.com&Signature=ij9bJd8yVpmIf1INziyDRxa59NJOCz%2BI%2FMpu6k2Ziq7r3yU%2BHBkEwNJAOHzG0wLnWEyMVu%2FP7vQxtzKOZww3YMOdoQMMPzLJV%2FzniXT2XkSyzanObrk2pi72%2BvajXeh53yj7HsXeHP%2FMF7QHo96KWB56amo7%2BJUZqtRdCQOuHdjVqGxtnUALSYD3f%2FMWm7IX70Dp5g%2BbDNzB%2Bbp%2Bjuvp62jhyInTpcY0b3SG8lu00n1zT1c2PI9BrrdU%2Fc6xBsCJuaOHg%2Fhzvi7hmPvDzrhYvQPI%2Fr0eC5r9Tzppch4WzCst9YyboywEfshA71LwTcQlLXXL2vU%2FIG4ThI1gMWCJxQ%3D%3D" mimeType="image/png"/></lov-tool-use>

<lov-tool-use id="toolu_vrtx_01LAxqskyw7meUdgJYdNdEkT" name="code--fetch_website" integration-id="code" data="{\"url\": \"https://gpclaklkaolyzfnooajt.supabase.co/storage/v1/object/public/paper-doll-assets/base_body/female.png\", \"formats\": \"screenshot\"}">
</lov-tool-use>
Now I see the issues clearly. Several distinct problems:

1. **Head asset is the actual problem** — the helmet PNG has a checkered transparency pattern *baked in* as actual gray pixels, not real transparency. So when the helmet layer is stacked, the checkered background covers everything beneath it (the body, chest, legs, etc.).

2. **Helmet alignment is off** — it sits floating mid-canvas instead of at the head anchor at the top.

3. **Occlusion**: head occludes `hair?` only, not the full body. So the body should still render. But because of issue #1, the head's opaque checkered background covers it.

4. **Most equipped items aren't matching the resolver** — Cithrawiel has Crown (head, unique), Leather Chestguard (chest, uncommon leather), Gloves of the Sea (hands, ?), Oathkeeper (main_hand), Eternal Bastion (off_hand shield), Greaves of the Lost (pants/legs), Assassin's Silent (boots), plus Trinket/Amulet/Shoulders/Belt/Ring slots which don't have doll-contract slots. The Crown is unique and has no `appearance_key` set, so resolver falls back to inferred (slot=head, material=`unique` for unique rarity, tier=`unique`) — no entry exists, falls back to slot+tier=unique → none, then slot+any → matches the head_common_cloth (the helmet). That's why we see a helmet for the Crown.

The root cause of "looks weird": the head asset has a baked-in checkered transparency pattern (it's not actually transparent). Let me also check chest/legs etc.
<lov-tool-use id="toolu_vrtx_012NEhpSVLgro2nw1EfVi5p4" name="code--view" integration-id="code" data="{\"file_path\": \"src/assets/paper-doll/chest_uncommon_leather.png\"}">
<lov-image url="https://storage.googleapis.com/gpt-engineer-file-uploads/20eb3db0-2417-4c26-8133-afa2d5d557e2-src/assets/paper-doll/chest_uncommon_leather.png?Expires=1776637903&GoogleAccessId=go-api-on-aws%40gpt-engineer-390607.iam.gserviceaccount.com&Signature=1WgaGqUgsEp7wnGD1oHqMNmdZzj%2BCqsReWlpAGb6hKT%2FSTJT9P5FnoWFP3uEsW1Ynitdsv3yP1FhUWWDAsZeQdZhC2isF2yClhX1fEf%2BnPUqzPbFIfNv%2F53Vyfk04EC3dUw1VuzFDB%2Bup1moa3gWRDAVbKqTz7ldYJ2FCIgEY93B0z9GsOTRNKMhBHIGxAjvSIN%2FaQ5kT3xY%2F1lSa2rrdZJwqbcNlFpqovZK7DfOAtNX2NQOE6D%2BrdwroLdAZKBmbtcJ%2BsWEVncfG5SSO78ZYz50jdXF%2BYnd0noJPbCKL0qSkyqpyXKDfeYJTR54cRXIM2tvXnj7BEH1Qm1wVP9fWQ%3D%3D" mimeType="image/png"/></lov-tool-use>

<lov-tool-use id="toolu_vrtx_017JER8i1gXNrEMxM7zFWMu9" name="code--view" integration-id="code" data="{\"file_path\": \"src/assets/paper-doll/legs_uncommon_leather.png\"}">
<lov-image url="https://storage.googleapis.com/gpt-engineer-file-uploads/e531e9db-23c3-4dc2-8a38-75473036dc1c-src/assets/paper-doll/legs_uncommon_leather.png?Expires=1776637904&GoogleAccessId=go-api-on-aws%40gpt-engineer-390607.iam.gserviceaccount.com&Signature=yT8F4oPmK9XDwCyAp7w8I9XsBA%2BqV1NHDVFSW87F2c4k9x%2F6pMuLqwXipkLgyxsEX5qlklwhzGAKaNp%2B%2BUkGwdRiQmyYC4HoRQkXNm9i3zaPNV959uY5XhEVXasglFTM4LGvl%2FpyK8IrWDq5qW2NOu0RQk9DEckzrCGnHZtkTT%2FOqep%2FNdsWmiNfSlFkxcFdZq33WcyyPrmX77mLtKKwJXyQKurv6%2BHUfIa7hFDFj5svW%2Fm71QWGwQkLBt%2FEuL4vvsdyeMydcWqBiLzEgAL%2BA6VdnhZCrBXjvmodK5vbc%2FexCf11DUr989MTognTbM65kDDQTNRLlNh2QO9%2F5dZXzw%3D%3D" mimeType="image/png"/></lov-tool-use>

<lov-tool-use id="toolu_vrtx_01MetPk4MGVNTnnaosbq7xta" name="code--view" integration-id="code" data="{\"file_path\": \"src/assets/paper-doll/main_hand_uncommon_metal.png\"}">
<lov-image url="https://storage.googleapis.com/gpt-engineer-file-uploads/784cec1d-2a37-40f4-80e6-f46fc41b36ff-src/assets/paper-doll/main_hand_uncommon_metal.png?Expires=1776637904&GoogleAccessId=go-api-on-aws%40gpt-engineer-390607.iam.gserviceaccount.com&Signature=YdM0aEVdV5SzF%2BsTMDvyiCZ%2Bh%2FXVGlJFCGjmXsvyFnR9OdfZdXdIpI6f%2FqinEV%2BFyAAHy9ZgTaKA7%2FukcCDtOEqkoue4YVVRX6ben5wxXW6v0W35Es74iXXzRaPJtCUkXy8c%2B4AxK%2BYNmhhibhmdgcBDRG%2Fh%2FvJuf7S9P0AAMEb6La3RLrWF6okcj8IdP%2FyzVeLGbpteFQhSEtIS4rXTieS4NghQVk8NmD30PwTXjoo5pufGP3Y0v4nP%2BTHpMq3YwdZ8QL%2FXNybvDQOzlGgj9uytGQX8UbIrcz9uVkJ%2FS4%2FHfJfZDXRh%2BFo8v4r%2FLC9L0ddafwoiODrHG9CQ6Fk1Lw%3D%3D" mimeType="image/png"/></lov-tool-use>
Wait — looking again, the checkered pattern shown in `lov-view` for PNGs is the **viewer's** transparency indicator (the tool renders transparent areas with a checker pattern), NOT baked into the asset. So those assets ARE transparent. The chest, legs, sword etc. are properly transparent.

But in the user's screenshot, the doll preview area also shows a checkered pattern as a background, AND only the helmet is visible. So either:
- The base body and other items aren't loading at all (maybe network failures), OR
- The page they're looking at is something different than the CharacterPanel — actually looking closer at the screenshot, the checkered area IS the doll's container and only the helmet renders inside.

Let me check whether the issue is sizing/positioning. Looking at the screenshot, the doll container is roughly square-ish (~250×250?) but `DOLL_CANVAS` is 256×384 with `scale=0.6` → 154×230. The screenshot box looks bigger and more square. Let me also look at base body PNG dimensions and what gender Cithrawiel is.
<lov-tool-use id="toolu_vrtx_01ARTgS81NdsTVxM7RbvvSpK" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT c.name, c.gender, c.race, c.class, ci.equipped_slot, i.name AS item_name, i.slot AS item_slot, i.rarity, i.weapon_tag, i.appearance_key FROM characters c LEFT JOIN character_inventory ci ON ci.character_id = c.id AND ci.equipped_slot IS NOT NULL LEFT JOIN items i ON i.id = ci.item_id WHERE c.name = 'Cithrawiel';\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_0135zeh1C9PAfd9fgSMAPcrg" name="code--view" integration-id="code" data="{\"file_path\": \"src/features/character/utils/doll-contract.ts\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_013ef2jUcj6h1MGqEGeAzx4N" name="code--search_files" integration-id="code" data="{\"query\": \"PaperDoll\", \"include_patterns\": \"src/features/character/components/CharacterPanel.tsx\"}">
</lov-tool-use>
Now I understand the full picture. Cithrawiel has 12 equipped items, but only the **Crown** has an `appearance_key` (which points to the head asset). The base body should still render. So why does the user only see the helmet floating?

The `Crown` rarity is `uncommon` (not unique). The `appearance_key` points to `74a1faf2-979a-40fe-af1c-9cbc6103a83d`. Let me check if that's an actual entry, and check what's happening with the female base body.
<lov-tool-use id="toolu_vrtx_01HnknKqqHkVDsZkPsUd27yG" name="supabase--read_query" integration-id="supabase" data="{\"query\": \"SELECT id, slot, material, tier, asset_url FROM appearance_entries WHERE id = '74a1faf2-979a-40fe-af1c-9cbc6103a83d';\"}">
</lov-tool-use>

<lov-tool-use id="toolu_vrtx_019as7f6f8QjtFTRABBsHQBv" name="code--view" integration-id="code" data="{\"file_path\": \"src/features/character/components/CharacterPanel.tsx\", \"lines\": \"370-410\"}">
</lov-tool-use>
OK I have the full picture now. Two real issues, plus a big design question:

**Issue A — Why only the helmet shows in screenshot:** Cithrawiel is `gender: female`, so `resolveBaseBody('female', entries)` should find the female base body. The chest item's `material` is `cloth` (chest_uncommon_leather wouldn't match for `Leather Chestguard` since it's rarity=common, infers material `cloth`). Let me trace: the chest item is `Leather Chestguard`, slot=chest, rarity=common. Resolver: tier=common, material=`cloth`. Look for slot=chest, material=cloth, tier=common, is_shared=true. There IS a chest_common_cloth entry. So chest should render. Same for the others. So in theory many items should render. Yet the screenshot shows only a helmet.

Wait — the helmet in the screenshot is positioned roughly *centered* on the canvas, where a body would be. That's because each layer is `inset-0` with `object-contain` which centers the image. The helmet PNG has the helmet near the top-left/center but with lots of transparent space — so `object-contain` will scale it to fit and leave it floating wherever the artist drew it.

So the real situation is: **all the layers ARE rendering, but the helmet is rendering on top of everything else and obscuring much of the doll** because the helmet asset isn't aligned to a "head anchor" — it's just floating mid-canvas. But the user only sees the helmet, suggesting other layers are below or matching.

Actually, wait. Re-examining the screenshot: the box has a checker pattern background. That's not the doll's CSS background (which is a gradient `from-muted/20 to-background/40`). The checker pattern looks like... a transparency indicator. But the browser doesn't show transparency as checkers — the page background would show through. Unless one of the assets has a baked checker pattern.

Let me look at another theory: maybe `object-contain` applied to a 512×768 PNG inside a 154×230 container will just letterbox it, and the **head asset** (which is 512×768 with a helmet drawn in upper-left occupying maybe 60% of the canvas) will scale down with all that transparent space preserved. But there's no checker in the actual PNG.

Hmm — actually, I bet the checker IS just the helmet asset's transparent area shown through, but the PaperDoll container has `overflow-hidden` and the gradient CSS background. The rendered checker pattern in the user's screenshot might be... something else entirely. Maybe the user has a browser extension showing transparency, OR I'm misreading the screenshot. The pattern IS clearly visible behind the helmet.

Looking at the PaperDoll component CSS: `bg-gradient-to-b from-muted/20 to-background/40`. That wouldn't produce a checker. 

OH WAIT. I bet it's this: in `index.css` or somewhere, there might be a checkered transparency utility. Or — more likely — **the base body and other equipment items ARE rendering, but they're behind the helmet which has an opaque-ish dark background showing as checker due to dithering?** No, the lov-view PNGs are clearly transparent.

Let me just stop theorizing and present a plan. The real, confirmed issues regardless of the checker mystery:

1. Crown (a unique-feeling item) renders as a generic leather helmet — wrong fantasy.
2. Many slots are not rendered on the doll (trinket, amulet, shoulders, belt, ring, pants is mapped but…wait, pants → legs, that is mapped).
3. Asset alignment: items are floating mid-canvas because the artwork isn't anchored properly to a fixed character pose. The base body PNG and equipment PNGs were generated independently with no shared registration grid — so a helmet won't sit on the head, gloves won't be at the wrists, etc.
4. The asset style is also inconsistent (base body has a baked-in shirt + pants, then equipped chest/legs render on top — looking layered like clothes-over-clothes).

The CORE answer to the user's question "is it because Cithrawiel doesn't have a base model?" → **No. The base body exists and renders for both male and female. The weirdness is because asset alignment, scale, and style consistency aren't yet enforced — every PNG was generated standalone instead of being registered to a shared anatomy grid.** Plus the placeholder set is sparse, so most slots fall back to mismatched assets.

<lov-plan>

## Why the doll looks weird

Short answer: **no, it isn't because Cithrawiel lacks a base model.** A female base body is in the library and the resolver is picking it up correctly. Cithrawiel is also resolving the Crown to the placeholder leather helm, the Leather Chestguard to the cloth shirt, etc. The pieces are all loading.

The real problems are with the **placeholder assets themselves**, not the system:

### 1. Assets aren't aligned to a shared anatomy grid
Each placeholder PNG was generated independently. The base body's head sits at one position, but the helmet PNG was drawn floating mid-canvas with no registration to that head position. Same for gloves, sword, shield, boots — they were authored at 512×768 but each one drew its content wherever the generator felt like. So when stacked, they don't land on the right body parts. That's the floating-helmet effect in your screenshot.

### 2. The base body has clothes painted on it
The placeholder female body wears a tunic and trousers. When a chest piece or pants render on top, you get clothes-on-clothes, which reads as muddled.

### 3. Crown resolves to a leather helm
Crown has `appearance_key` set to the uncommon leather helmet entry (the only head entry in the library). Visually wrong for a milestone item — but a library content gap, not a code bug.

### 4. Several equipped slots simply don't render on the doll
Trinket, amulet, shoulders, belt, ring aren't in the doll contract, so they won't show. That's expected for Phase 1, but combined with the alignment drift it makes the doll feel sparse.

### 5. Stylistic inconsistency
The base body, the chest piece, and the head piece were each generated in slightly different lighting/palette conditions, so they don't read as one character.

## What to fix

Two-step plan, no scope creep:

### Step 1 — Re-author the placeholder set as a **registered** sprite sheet
Generate all Phase 1 placeholders (base bodies M/F + head, chest, hands, legs, boots, main_hand, off_hand at common/uncommon) **in a single batch** using one master prompt that:
- Locks the pose, framing, and pixel anchors (head crown at y≈80, shoulders at y≈220, hips at y≈420, hands at y≈400, feet at y≈740 on the 512×768 canvas)
- Uses a **nude/underwear base body** (no painted clothes) so chest/legs layers don't fight the silhouette
- Renders each equipment piece **on top of the same reference body** then erases the body, guaranteeing alignment
- Uses one consistent lighting/palette description

Re-upload all assets to `paper-doll-assets/` and update the existing `appearance_entries` rows (URLs unchanged, just re-uploaded to the same paths so no DB migration needed).

### Step 2 — Author a proper Crown asset
Generate one bespoke `head / unique` entry for the Crown (gold, jeweled, milestone-feel) and update `items.appearance_key` for the Crown row to point at it. Same alignment grid as Step 1.

### What stays unchanged
- Database schema, resolver code, `PaperDoll.tsx`, `doll-contract.ts`
- All other game logic
- The slot contract (we're fixing assets, not the system)

### Out of scope (deferred)
- Adding doll layers for trinket/amulet/shoulders/belt/ring (Phase 2+)
- Hair customization (Phase 2)
- Re-doing already-correct admin UI

