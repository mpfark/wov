UPDATE public.creatures
SET stats = jsonb_build_object(
  'str', COALESCE(stats->'str', '10'::jsonb),
  'dex', COALESCE(stats->'dex', '10'::jsonb)
)
WHERE stats ?| array['con','int','wis','cha'];