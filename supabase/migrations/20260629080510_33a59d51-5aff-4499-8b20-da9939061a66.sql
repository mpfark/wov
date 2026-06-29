
UPDATE public.npcs
   SET dialogue_topics = COALESCE(dialogue_topics, '[]'::jsonb)
        || '[{"id":"contracts","kind":"assassin_contract","label":"A contract for me?"}]'::jsonb
 WHERE node_id IN (SELECT id FROM public.nodes WHERE class_hall = 'assassin')
   AND NOT (dialogue_topics::text LIKE '%"kind": "assassin_contract"%' OR dialogue_topics::text LIKE '%"kind":"assassin_contract"%');
