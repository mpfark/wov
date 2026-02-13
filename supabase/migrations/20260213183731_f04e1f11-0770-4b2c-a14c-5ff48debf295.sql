ALTER TABLE public.items ADD COLUMN level integer NOT NULL DEFAULT 1;
ALTER TABLE public.items ADD CONSTRAINT items_level_check CHECK (level >= 1 AND level <= 100);