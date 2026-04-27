-- Add is_soulforge flag to nodes
ALTER TABLE public.nodes
  ADD COLUMN IF NOT EXISTS is_soulforge boolean NOT NULL DEFAULT false;

-- Add service_role to npcs (nullable; values: 'vendor' | 'blacksmith' | null)
ALTER TABLE public.npcs
  ADD COLUMN IF NOT EXISTS service_role text;

-- Constrain to known values
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'npcs_service_role_check'
  ) THEN
    ALTER TABLE public.npcs
      ADD CONSTRAINT npcs_service_role_check
      CHECK (service_role IS NULL OR service_role IN ('vendor', 'blacksmith'));
  END IF;
END $$;

-- Backfill: mark The Deep-Core Forge as soulforge-capable
UPDATE public.nodes
   SET is_soulforge = true
 WHERE name = 'The Deep-Core Forge'
   AND is_blacksmith = true;