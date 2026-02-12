
-- Create parties table
CREATE TABLE public.parties (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  leader_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  tank_id UUID REFERENCES public.characters(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create party_members table
CREATE TABLE public.party_members (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  party_id UUID NOT NULL REFERENCES public.parties(id) ON DELETE CASCADE,
  character_id UUID NOT NULL REFERENCES public.characters(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  is_following BOOLEAN NOT NULL DEFAULT false,
  joined_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(party_id, character_id)
);

-- Enable RLS
ALTER TABLE public.parties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.party_members ENABLE ROW LEVEL SECURITY;

-- Parties: anyone can view (needed for presence), only owner can manage
CREATE POLICY "Anyone can view parties" ON public.parties FOR SELECT USING (true);
CREATE POLICY "Character owner can create party" ON public.parties FOR INSERT
  WITH CHECK (owns_character(leader_id));
CREATE POLICY "Leader can update party" ON public.parties FOR UPDATE
  USING (owns_character(leader_id));
CREATE POLICY "Leader can delete party" ON public.parties FOR DELETE
  USING (owns_character(leader_id));

-- Party members: anyone can view, insert by leader or own character, update/delete by leader or self
CREATE POLICY "Anyone can view party members" ON public.party_members FOR SELECT USING (true);
CREATE POLICY "Can insert party members" ON public.party_members FOR INSERT
  WITH CHECK (
    owns_character(character_id) OR
    EXISTS (SELECT 1 FROM public.parties WHERE id = party_id AND owns_character(leader_id))
  );
CREATE POLICY "Can update party members" ON public.party_members FOR UPDATE
  USING (
    owns_character(character_id) OR
    EXISTS (SELECT 1 FROM public.parties WHERE id = party_id AND owns_character(leader_id))
  );
CREATE POLICY "Can delete party members" ON public.party_members FOR DELETE
  USING (
    owns_character(character_id) OR
    EXISTS (SELECT 1 FROM public.parties WHERE id = party_id AND owns_character(leader_id))
  );

-- Enable realtime for party tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.parties;
ALTER PUBLICATION supabase_realtime ADD TABLE public.party_members;
