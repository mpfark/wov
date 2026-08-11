-- 1) Categories
CREATE TABLE public.guide_categories (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.guide_categories TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guide_categories TO authenticated;
GRANT ALL ON public.guide_categories TO service_role;

ALTER TABLE public.guide_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published guide categories are readable"
ON public.guide_categories FOR SELECT
USING (is_published = true);

CREATE POLICY "Stewards read all guide categories"
ON public.guide_categories FOR SELECT TO authenticated
USING (public.is_steward_or_overlord());

CREATE POLICY "Stewards insert guide categories"
ON public.guide_categories FOR INSERT TO authenticated
WITH CHECK (public.is_steward_or_overlord());

CREATE POLICY "Stewards update guide categories"
ON public.guide_categories FOR UPDATE TO authenticated
USING (public.is_steward_or_overlord())
WITH CHECK (public.is_steward_or_overlord());

CREATE POLICY "Stewards delete guide categories"
ON public.guide_categories FOR DELETE TO authenticated
USING (public.is_steward_or_overlord());

-- 2) Entries
CREATE TABLE public.guide_entries (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  category_id UUID NOT NULL REFERENCES public.guide_categories(id) ON DELETE CASCADE,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT,
  body TEXT NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_guide_entries_category ON public.guide_entries(category_id);

GRANT SELECT ON public.guide_entries TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.guide_entries TO authenticated;
GRANT ALL ON public.guide_entries TO service_role;

ALTER TABLE public.guide_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published guide entries are readable"
ON public.guide_entries FOR SELECT
USING (is_published = true);

CREATE POLICY "Stewards read all guide entries"
ON public.guide_entries FOR SELECT TO authenticated
USING (public.is_steward_or_overlord());

CREATE POLICY "Stewards insert guide entries"
ON public.guide_entries FOR INSERT TO authenticated
WITH CHECK (public.is_steward_or_overlord());

CREATE POLICY "Stewards update guide entries"
ON public.guide_entries FOR UPDATE TO authenticated
USING (public.is_steward_or_overlord())
WITH CHECK (public.is_steward_or_overlord());

CREATE POLICY "Stewards delete guide entries"
ON public.guide_entries FOR DELETE TO authenticated
USING (public.is_steward_or_overlord());

-- 3) Per-character read state
CREATE TABLE public.character_guide_reads (
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  entry_id UUID NOT NULL REFERENCES public.guide_entries(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, entry_id)
);

GRANT SELECT, INSERT, DELETE ON public.character_guide_reads TO authenticated;
GRANT ALL ON public.character_guide_reads TO service_role;

ALTER TABLE public.character_guide_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Players read their own guide reads"
ON public.character_guide_reads FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.characters c
  WHERE c.id = character_guide_reads.character_id AND c.user_id = auth.uid()
));

CREATE POLICY "Players record their own guide reads"
ON public.character_guide_reads FOR INSERT TO authenticated
WITH CHECK (EXISTS (
  SELECT 1 FROM public.characters c
  WHERE c.id = character_guide_reads.character_id AND c.user_id = auth.uid()
));

CREATE POLICY "Players clear their own guide reads"
ON public.character_guide_reads FOR DELETE TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.characters c
  WHERE c.id = character_guide_reads.character_id AND c.user_id = auth.uid()
));

-- 4) updated_at triggers
CREATE TRIGGER update_guide_categories_updated_at
BEFORE UPDATE ON public.guide_categories
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER update_guide_entries_updated_at
BEFORE UPDATE ON public.guide_entries
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- 5) Seed content
INSERT INTO public.guide_categories (key, title, subtitle, sort_order, is_published) VALUES
  ('getting-started', 'Getting Started', 'For travellers who have misplaced their purpose.', 1, true),
  ('surviving-varneth', 'Surviving Varneth', 'The parts that tend to involve your health bar.', 2, true);

INSERT INTO public.guide_entries (category_id, slug, title, summary, sort_order, is_published, body)
SELECT c.id, 'getting-started', 'Your First Steps',
  'Where you are, where the blacksmith is, and what to do with your pockets full of salvage.',
  1, true,
$body$> THE WAYFARER'S GUIDE
> An occasionally reliable companion for travellers who have misplaced their purpose, their profession, or their immediate surroundings.

You appear to be standing in Hearthvale Square. This is generally preferable to standing outside it.

The measured hammering from the north-east belongs to the blacksmith. You were, by all appearances, on your way there before existence distracted you.

## Your First Steps

- Move north-east to reach the blacksmith. Travel with the compass keys (Q W E / A D / Z X C) or by clicking a neighbouring location on the local map. Movement spends Movement Points, which return on their own.
- At the forge, craft a plain base item. There are no class restrictions: every class can craft and wear every base. You begin with enough salvage to craft your first piece of equipment.
- As you gain levels, stronger bases become available at the forge. They cost more to make, and a stronger base starts its stats over, so there is no reward for hoarding gems against a future you have not reached yet.
- Rings and trinkets are not forge work. They are crafted by a jeweller, who can also cut you a specific gem in exchange for salvage.
- Equip what you make from your character panel. An unarmed wayfarer strikes for very little, and Varneth notices.

## Gems

Each gem raises one attribute by one point: Garnet strength, Topaz dexterity, Emerald constitution, Sapphire intelligence, Pearl wisdom, Amethyst charisma. The forge and jeweller both show which attribute a gem will add before you commit.

A gem is set into the item, not into you. Choose the item accordingly.

> The Guide advises against placing every gem you own into the first object you forge. The Guide has been ignored on this point before.

## After That

Leave town armed. Creatures near Hearthvale are forgiving; creatures further out are not, and the difference is measured in your own health bar. When something does go wrong, this Guide has entries on [[combat|combat]], [[equipment|equipment]], and the several forms of preparation you are currently postponing.$body$
FROM public.guide_categories c WHERE c.key = 'getting-started';

INSERT INTO public.guide_entries (category_id, slug, title, summary, sort_order, is_published, body)
SELECT c.id, 'travelling-and-the-map', 'Travelling and the Map',
  'How to go somewhere else, and how to tell whether that was wise.',
  2, true,
$body$Varneth is a grid of locations joined by paths. You occupy exactly one of them at a time, which is fewer than most travellers would prefer.

## Moving

- The compass keys move you one location at a time: Q W E for north-west, north and north-east, A and D for west and east, Z X C for south-west, south and south-east.
- You may also click a neighbouring location on the local map.
- Each step spends Movement Points. They regenerate on their own, so impatience is the only real cost.
- Some paths are locked and require the right key item. The Guide notes, without comment, that a locked door is usually locked for a reason.

## Reading the map

- The local map shows your immediate surroundings and which neighbours you have already visited.
- The world map shows the wider region and where you have been.
- Regions carry a minimum level. A region far above your level will explain this to you in the traditional manner.

> Distance in Varneth is measured in steps, danger in levels, and regret in hindsight.$body$
FROM public.guide_categories c WHERE c.key = 'getting-started';

INSERT INTO public.guide_entries (category_id, slug, title, summary, sort_order, is_published, body)
SELECT c.id, 'combat', 'Combat',
  'Starting a fight, surviving a fight, and leaving one that is going badly.',
  1, true,
$body$Combat in Varneth happens where you are standing. Creatures on your location can be attacked, and will generally return the favour without being asked.

## The basics

- Attack a creature to engage it. Combat then resolves in ticks while you remain present.
- Your abilities sit on the ability bar and are bound to keys you can change in the keyboard panel.
- Health is HP. Concentration is CP and pays for abilities and stances. Movement is MP and pays for travel.
- Hits are graded: a miss, a glancing blow, a weak hit, a normal hit, or a strong hit. The same weapon will produce all of them, often in an unhelpful order.

## Leaving

- Walking away disengages you. This is a legitimate tactic and the Guide endorses it warmly.
- Wimp is an automatic version of the same idea: set a health threshold and your character will attempt to flee below it.

## When it goes wrong

Death is survivable in the administrative sense. You will be returned to safety, lighter in some respects than you arrived.

> Courage is admirable. So is a functioning escape route.$body$
FROM public.guide_categories c WHERE c.key = 'surviving-varneth';

INSERT INTO public.guide_entries (category_id, slug, title, summary, sort_order, is_published, body)
SELECT c.id, 'equipment', 'Equipment',
  'Nine slots, one paper doll, and the difference between armed and optimistic.',
  2, true,
$body$Your character has nine equipment slots: head, chest, gloves, pants, main hand, off hand, two rings, and a trinket. All of them are worth filling eventually.

## Wearing things

- Equip and unequip from the character panel. There are no class restrictions on equipment bases.
- Equipment takes durability damage in combat and can be repaired. Neglected gear becomes decorative.
- A crafted plain base with a gem or two in it is worth considerably more than an empty slot.

## Where gear comes from

- Common plain bases are crafted: armour and weapons at a blacksmith, rings and trinkets at a jeweller.
- Uncommon and better gear drops from creatures. It cannot be crafted, and no amount of standing near a forge will change that.
- Unique items exist in exactly one copy in the world at a time.

> The Guide has met many travellers who intended to find better gear before their next fight. It has met fewer of them afterwards.$body$
FROM public.guide_categories c WHERE c.key = 'surviving-varneth';

INSERT INTO public.guide_entries (category_id, slug, title, summary, sort_order, is_published, body)
SELECT c.id, 'crafting-gems-and-salvage', 'Crafting, Gems and Salvage',
  'Salvage into bases, gems into bases, and bases into something worth wearing.',
  3, true,
$body$Salvage is the raw material of everything you will make. It accumulates from the things you defeat and is spent the moment you find a forge.

## Crafting a base

- Blacksmiths craft head, chest, gloves, pants, main hand and off hand. Jewellers craft rings and trinkets.
- You must be standing at the relevant station. Enthusiasm at a distance is not accepted.
- Crafting costs salvage and gold. Higher tiers cost more.
- Stronger base tiers unlock as your character gains levels. Every class may craft every base.

## Gems

- Six gems, six attributes: Garnet strength, Topaz dexterity, Emerald constitution, Sapphire intelligence, Pearl wisdom, Amethyst charisma.
- Applying a gem grants one point of that attribute to that specific item.
- Gems belong to the item, not to you. Moving to a stronger base means starting its stats over.
- A jeweller will cut you a specific gem in exchange for salvage, which is faster than waiting for the one you need to drop.

> Any sufficiently patient traveller can assemble excellent equipment. The Guide has never met one.$body$
FROM public.guide_categories c WHERE c.key = 'surviving-varneth';