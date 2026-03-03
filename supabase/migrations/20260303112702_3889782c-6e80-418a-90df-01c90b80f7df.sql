-- Create gender enum
CREATE TYPE public.character_gender AS ENUM ('male', 'female');

-- Add gender column to characters (default 'male' for existing characters)
ALTER TABLE public.characters ADD COLUMN gender character_gender NOT NULL DEFAULT 'male';