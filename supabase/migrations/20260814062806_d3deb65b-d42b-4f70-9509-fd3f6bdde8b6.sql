CREATE OR REPLACE FUNCTION public.c4_delivery_harness_run()
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_out jsonb := '[]'::jsonb;
  v_enc uuid := gen_random_uuid();
  v_node uuid;
  v_owner_char uuid; v_owner_user uuid;
  v_left_char uuid; v_left_user uuid;
  v_other_char uuid; v_other_user uuid;
  v_cnt int;
  v_snap jsonb;
  v_grant_expires timestamptz;
BEGIN
  IF NOT public.c4_harness_caller_allowed() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT id INTO v_node FROM public.nodes LIMIT 1;

  SELECT id, user_id INTO v_owner_char, v_owner_user FROM public.characters ORDER BY created_at LIMIT 1;
  SELECT id, user_id INTO v_left_char, v_left_user FROM public.characters
    WHERE user_id <> v_owner_user ORDER BY created_at LIMIT 1;
  SELECT id, user_id INTO v_other_char, v_other_user FROM public.characters
    WHERE user_id NOT IN (v_owner_user, v_left_user) ORDER BY created_at LIMIT 1;

  INSERT INTO public.encounters (id, node_id, encounter_key, status, tick_number, tick_at, tick_state, tick_owner)
  VALUES (v_enc, v_node, 'c4-harness:' || v_enc::text, 'active', 100, 0, 'idle', 'shared');

  INSERT INTO public.encounter_participants (encounter_id, character_id)
  VALUES (v_enc, v_owner_char), (v_enc, v_left_char);

  INSERT INTO public.encounter_tick_batches (encounter_id, tick_number, batch_id, payload)
  SELECT v_enc, t, gen_random_uuid(), jsonb_build_object('v', 3, 'tick', t)
  FROM generate_series(93, 100) t WHERE t <> 96;

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_owner_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.encounter_tick_batches WHERE encounter_id = v_enc;
  v_out := v_out || jsonb_build_array(jsonb_build_object('case','current_participant_reads','pass', v_cnt = 7, 'detail', v_cnt));

  SELECT count(*) INTO v_cnt FROM public.encounter_tick_batches
   WHERE encounter_id = v_enc AND tick_number BETWEEN 94 AND 100;
  v_out := v_out || jsonb_build_array(jsonb_build_object('case','missing_tick_recovery_range','pass', v_cnt = 6, 'detail', v_cnt));

  SELECT count(*) INTO v_cnt FROM (
    SELECT tick_number FROM public.encounter_tick_batches WHERE encounter_id = v_enc
    GROUP BY tick_number HAVING count(*) > 1
  ) d;
  v_out := v_out || jsonb_build_array(jsonb_build_object('case','ordered_unique_ticks','pass', v_cnt = 0));

  v_snap := public.encounter_resync_snapshot(v_enc, v_owner_char);
  v_out := v_out || jsonb_build_array(jsonb_build_object(
    'case','resync_snapshot_participant',
    'pass', (v_snap ? 'tick') AND (v_snap ? 'character') AND (v_snap ? 'creatures') AND (v_snap ? 'engaged_creature_ids'),
    'detail', jsonb_build_object('tick', v_snap->'tick', 'retained_from_tick', v_snap->'retained_from_tick')));

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_other_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.encounter_tick_batches WHERE encounter_id = v_enc;
  v_out := v_out || jsonb_build_array(jsonb_build_object('case','unrelated_user_denied_batches','pass', v_cnt = 0, 'detail', v_cnt));
  BEGIN
    PERFORM public.encounter_resync_snapshot(v_enc, v_owner_char);
    v_out := v_out || jsonb_build_array(jsonb_build_object('case','unrelated_user_denied_resync','pass', false));
  EXCEPTION WHEN others THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('case','unrelated_user_denied_resync','pass', SQLERRM = 'not_authorized', 'detail', SQLERRM));
  END;

  EXECUTE 'SET LOCAL ROLE NONE';
  DELETE FROM public.encounter_participants WHERE encounter_id = v_enc AND character_id = v_left_char;
  SELECT expires_at INTO v_grant_expires FROM public.encounter_access_grants
   WHERE encounter_id = v_enc AND character_id = v_left_char;
  v_out := v_out || jsonb_build_array(jsonb_build_object(
    'case','grant_minted_on_participation_delete',
    'pass', v_grant_expires IS NOT NULL AND v_grant_expires > now(),
    'detail', v_grant_expires));

  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_left_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.encounter_tick_batches WHERE encounter_id = v_enc;
  v_out := v_out || jsonb_build_array(jsonb_build_object('case','departed_participant_reads_under_grant','pass', v_cnt = 7, 'detail', v_cnt));
  BEGIN
    PERFORM public.encounter_resync_snapshot(v_enc, v_left_char);
    v_out := v_out || jsonb_build_array(jsonb_build_object('case','departed_participant_resync_under_grant','pass', true));
  EXCEPTION WHEN others THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('case','departed_participant_resync_under_grant','pass', false, 'detail', SQLERRM));
  END;

  EXECUTE 'SET LOCAL ROLE NONE';
  UPDATE public.encounter_access_grants SET expires_at = now() - interval '1 second'
   WHERE encounter_id = v_enc AND character_id = v_left_char;
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_left_user, 'role', 'authenticated')::text, true);
  SELECT count(*) INTO v_cnt FROM public.encounter_tick_batches WHERE encounter_id = v_enc;
  v_out := v_out || jsonb_build_array(jsonb_build_object('case','expired_grant_denied','pass', v_cnt = 0, 'detail', v_cnt));
  BEGIN
    PERFORM public.encounter_resync_snapshot(v_enc, v_left_char);
    v_out := v_out || jsonb_build_array(jsonb_build_object('case','expired_grant_denied_resync','pass', false));
  EXCEPTION WHEN others THEN
    v_out := v_out || jsonb_build_array(jsonb_build_object('case','expired_grant_denied_resync','pass', SQLERRM = 'not_a_participant', 'detail', SQLERRM));
  END;

  EXECUTE 'SET LOCAL ROLE NONE';
  UPDATE public.encounter_tick_batches SET created_at = now() - interval '10 minutes'
   WHERE encounter_id = v_enc AND tick_number < 97;
  PERFORM public.prune_encounter_tick_batches(180, 2000);
  SELECT count(*) INTO v_cnt FROM public.encounter_tick_batches WHERE encounter_id = v_enc AND tick_number < 97;
  v_snap := public.encounter_resync_snapshot(v_enc, v_owner_char);
  v_out := v_out || jsonb_build_array(jsonb_build_object(
    'case','batch_pruned_then_resync',
    'pass', v_cnt = 0 AND (v_snap->>'tick') IS NOT NULL,
    'detail', jsonb_build_object('remaining_old', v_cnt, 'retained_from_tick', v_snap->'retained_from_tick')));

  PERFORM public.prune_encounter_access_grants(2000);
  SELECT count(*) INTO v_cnt FROM public.encounter_access_grants
   WHERE encounter_id = v_enc AND expires_at <= now();
  v_out := v_out || jsonb_build_array(jsonb_build_object('case','expired_grants_pruned','pass', v_cnt = 0, 'detail', v_cnt));

  DELETE FROM public.encounter_tick_batches WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_access_grants WHERE encounter_id = v_enc;
  DELETE FROM public.encounter_participants WHERE encounter_id = v_enc;
  DELETE FROM public.encounters WHERE id = v_enc;

  SELECT count(*) INTO v_cnt FROM public.encounters WHERE id = v_enc;
  v_out := v_out || jsonb_build_array(jsonb_build_object('case','fixture_cleaned','pass', v_cnt = 0));

  RETURN jsonb_build_object(
    'all_pass', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_out) e WHERE (e->>'pass') <> 'true'),
    'cases', v_out);
END;
$function$;