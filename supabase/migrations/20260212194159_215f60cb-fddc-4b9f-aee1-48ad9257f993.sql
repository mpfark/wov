-- Add unspent stat points column to characters
ALTER TABLE public.characters ADD COLUMN unspent_stat_points integer NOT NULL DEFAULT 0;

-- Add CHECK constraint for valid range
ALTER TABLE public.characters ADD CONSTRAINT characters_unspent_stat_points_check CHECK (unspent_stat_points >= 0 AND unspent_stat_points <= 200);