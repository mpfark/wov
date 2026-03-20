ALTER TABLE public.areas
  ADD COLUMN min_level integer NOT NULL DEFAULT 1,
  ADD COLUMN max_level integer NOT NULL DEFAULT 10,
  ADD COLUMN creature_types text NOT NULL DEFAULT '',
  ADD COLUMN flavor_text text NOT NULL DEFAULT '';