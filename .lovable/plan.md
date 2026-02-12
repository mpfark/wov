

## Rename the Game

Update the game's title and branding across the entire codebase to reflect the "everyday hero" theme. The new name will be:

**"The Everyday Adventurer's Guide to Middle-earth"**

With a short form **"Everyday Adventurer"** used in tight spaces (like the top bar).

### Files to Update

**1. `index.html`**
- Change `<title>` from "Lovable App" to "The Everyday Adventurer's Guide to Middle-earth"
- Update `og:title` meta tag to match
- Update `description` and `og:description` to something like "A humble adventurer's journey through Middle-earth"

**2. `src/pages/AuthPage.tsx`**
- Change the heading from "Middle-earth" to "The Everyday Adventurer's Guide to Middle-earth" (or a two-line layout: "The Everyday Adventurer's" / "Guide to Middle-earth")

**3. `src/pages/GamePage.tsx`**
- Top bar title: Change "Middle-earth" to "Everyday Adventurer" (short form for the compact header)
- Welcome log message: Change "Welcome to Middle-earth!" to "Welcome, Everyday Adventurer!"

**4. `src/pages/Index.tsx`**
- Loading text: Change "Entering Middle-earth..." to "Preparing your adventure..."

**5. `src/pages/CharacterCreation.tsx`**
- Success toast: Change "has entered Middle-earth!" to "has begun their adventure!"
- Button label: Change "Enter Middle-earth" to "Begin Your Adventure"

**6. `src/components/game/NodeView.tsx`**
- Default description fallback: Change "A quiet place in Middle-earth..." to "A quiet corner of the world..."

Total: 6 files, all cosmetic string changes -- no logic modifications.

