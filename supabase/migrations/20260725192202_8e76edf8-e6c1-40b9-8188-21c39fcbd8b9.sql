
UPDATE public.encounters e
   SET stored_power_source_id = ep.character_id
  FROM public.encounter_participants ep
  JOIN public.characters c ON c.id = ep.character_id
 WHERE e.ended_at IS NULL
   AND e.stored_power_source_id IS NULL
   AND ep.encounter_id = e.id
   AND c.hp > 0
   AND ep.character_id = (
     SELECT ep2.character_id
       FROM public.encounter_participants ep2
       JOIN public.characters c2 ON c2.id = ep2.character_id
      WHERE ep2.encounter_id = e.id AND c2.hp > 0
      ORDER BY ep2.character_id
      LIMIT 1
   );
