-- Add movement points columns to characters
ALTER TABLE public.characters
ADD COLUMN mp integer NOT NULL DEFAULT 100,
ADD COLUMN max_mp integer NOT NULL DEFAULT 100;
