-- Allow anonymous (signed-out) visitors to view regions, nodes, and items so the public Gallery page can display them.
DROP POLICY IF EXISTS "Anyone can view regions" ON public.regions;
CREATE POLICY "Anyone can view regions" ON public.regions FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can view nodes" ON public.nodes;
CREATE POLICY "Anyone can view nodes" ON public.nodes FOR SELECT USING (true);

DROP POLICY IF EXISTS "Anyone can view items" ON public.items;
CREATE POLICY "Anyone can view items" ON public.items FOR SELECT USING (true);