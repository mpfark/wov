ALTER TABLE public.profiles
  ADD COLUMN full_name text,
  ADD COLUMN has_accepted_oath boolean NOT NULL DEFAULT false;