-- Normalize the 28 reviewed ordinary-world boss casts onto Combat2's supported
-- single-hit contract. The authored primary release damage, timing, chance,
-- damage type, prose, and unrelated creature content remain unchanged.
BEGIN;

CREATE TEMP TABLE combat2_boss_normalization(
  creature_id uuid PRIMARY KEY,
  ability_key text NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO combat2_boss_normalization(creature_id,ability_key) VALUES
 ('df33b7d1-44db-48a4-a80b-2d86657cc6ce','choking_roots__df33b7d1'),
 ('3d1189cb-06e8-44e6-80f0-ef09c021ca62','rebirth_nova__3d1189cb'),
 ('70426f33-5c77-4324-9d5d-72003d7e6652','final_crescendo__70426f33'),
 ('6e2fe99e-e808-4d39-b766-0b04452c17f2','bring_down_the_roof__6e2fe99e'),
 ('c871d64d-4f7a-4906-a85c-6a8996298f73','core_eruption__c871d64d'),
 ('09894f6e-1baf-4281-8969-78ee1e0ac3dd','solar_fracture__09894f6e'),
 ('949e6eec-8cf1-4a1d-8b89-99c70b2a6126','unbound_thought__949e6eec'),
 ('e9d27dae-4e22-4d7b-bf9b-b2804b864294','horizon_charge__e9d27dae'),
 ('e1789e02-aa86-49a2-af02-148ac53503bc','sovereign_s_reckoning__e1789e02'),
 ('bfff1d55-de1d-4fcb-ab79-9e8cf3c7828b','far_stalker_s_volley__bfff1d55'),
 ('a0b9ca20-7d12-431b-8877-8c53f250e6d2','orbital_convergence__a0b9ca20'),
 ('9b76b83d-24df-48cf-b2bb-a2c5e2ecc8de','the_third_mark__9b76b83d'),
 ('3fc61566-798a-4a6c-8020-4db41dcb3b0a','riptide_cut__3fc61566'),
 ('8877a3a9-5e36-4881-85f9-65d0a402979c','final_absolution__8877a3a9'),
 ('1b77f42f-120e-4895-bc81-f72feba8f734','resonant_shattering__1b77f42f'),
 ('a16a0675-7479-4823-bbcd-d767ba575425','extinguish_the_living__a16a0675'),
 ('3d082fe3-c01b-429f-94b9-fad8d3bb3c8d','the_drowning_toll__3d082fe3'),
 ('3d7dea41-e442-4ba2-bfed-972a5af56e05','rootbound_collapse__3d7dea41'),
 ('9c20cc14-37c5-43e5-8c00-da28a2781eb0','swallow_the_light__9c20cc14'),
 ('0327333a-a1e1-4de9-99f0-f972b9328f09','the_final_command__0327333a'),
 ('4d6e9e6d-fb37-48d9-ab30-f9f409b8f0cd','contagion_burst__4d6e9e6d'),
 ('a7ed7ae8-d599-4a81-bc90-de1576834258','granite_slam__a7ed7ae8'),
 ('9388ebc3-f2d2-4619-a226-db4fa67b848d','corrosive_breath__9388ebc3'),
 ('1b97b39b-6972-4dbc-82c0-17c3f6a06943','hoardfire_breath__1b97b39b'),
 ('dd61b9e8-f596-4ffe-ad1f-4a8b9e10c128','headsman_s_measure__dd61b9e8'),
 ('5fde415e-2425-4eef-bc38-20e4a46c06ad','unmaking_cleave__5fde415e'),
 ('b7d7cd9f-fadb-4062-bc1a-5a24f48620ea','whiteout_volley__b7d7cd9f'),
 ('75d98ddd-390d-4b33-be02-b4049c40c507','cinderchain_sunder__75d98ddd');

DO $$ DECLARE bad integer; BEGIN
 IF (SELECT count(*) FROM combat2_boss_normalization)<>28 THEN
  RAISE EXCEPTION 'Combat2 boss normalization manifest must contain exactly 28 casts';
 END IF;
 SELECT count(*) INTO bad FROM combat2_boss_normalization m
 LEFT JOIN public.creatures c ON c.id=m.creature_id
 WHERE c.id IS NULL OR c.boss_cast IS NULL OR jsonb_typeof(c.boss_cast)<>'object'
   OR coalesce((c.boss_cast->>'enabled')::boolean,true) IS NOT TRUE
   OR coalesce((c.boss_cast->>'cast_ms')::numeric,0)<=0
   OR coalesce((c.boss_cast->>'base_amount')::numeric,(c.boss_cast->>'amount')::numeric,0)<=0
   OR nullif(trim(c.boss_cast->>'ability_key'),'') IS NOT NULL
      AND nullif(trim(c.boss_cast->>'ability_key'),'')<>m.ability_key;
 IF bad<>0 THEN RAISE EXCEPTION 'Combat2 boss normalization aborted: % expected casts missing or drifted',bad; END IF;
END $$;

UPDATE public.creatures c SET boss_cast=
 (c.boss_cast-'stored_power'-'accumulate'-'amount') || jsonb_build_object(
   'ability_key',m.ability_key,
   'base_amount',coalesce(c.boss_cast->'base_amount',c.boss_cast->'amount'),
   'base_aoe_amount',0,
   'target_mode','tank'
 )
FROM combat2_boss_normalization m WHERE c.id=m.creature_id;

DO $$ DECLARE bad integer; BEGIN
 SELECT count(*) INTO bad FROM combat2_boss_normalization m JOIN public.creatures c ON c.id=m.creature_id
 WHERE c.boss_cast->>'ability_key'<>m.ability_key
   OR c.boss_cast ? 'stored_power' OR c.boss_cast ? 'accumulate' OR c.boss_cast ? 'amount'
   OR c.boss_cast->>'target_mode'<>'tank'
   OR (c.boss_cast->>'base_aoe_amount')::numeric<>0
   OR coalesce((c.boss_cast->>'base_amount')::numeric,0)<=0;
 IF bad<>0 THEN RAISE EXCEPTION 'Combat2 boss normalization postcondition failed for % casts',bad; END IF;
END $$;

COMMIT;
