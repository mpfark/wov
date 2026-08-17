CREATE OR REPLACE FUNCTION public.effects_catchup_credential_health()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_key text;
  v_parts text[];
  v_payload jsonb := NULL;
  v_role text := NULL;
  v_exp bigint := NULL;
  v_raw text;
BEGIN
  IF current_user NOT IN ('postgres', 'supabase_admin', 'service_role', 'supabase_read_only_user') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets WHERE name = 'effects_catchup_service_role_key';

  IF v_key IS NULL THEN
    RETURN jsonb_build_object('present', false);
  END IF;

  v_parts := string_to_array(v_key, '.');
  IF array_length(v_parts, 1) = 3 THEN
    BEGIN
      v_raw := convert_from(
        decode(rpad(replace(replace(v_parts[2], '-', '+'), '_', '/'),
               (length(v_parts[2]) + 3) / 4 * 4, '='), 'base64'), 'utf8');
      v_payload := v_raw::jsonb;
      v_role := v_payload->>'role';
      v_exp := (v_payload->>'exp')::bigint;
    EXCEPTION WHEN others THEN
      v_payload := NULL;
    END;
  END IF;

  RETURN jsonb_build_object(
    'present', true,
    'length', length(v_key),
    'fingerprint', left(encode(sha256(convert_to(v_key, 'utf8')), 'hex'), 12),
    'format', CASE
      WHEN array_length(v_parts, 1) = 3 AND v_payload IS NOT NULL THEN 'jwt'
      WHEN v_key LIKE 'sb_secret_%' THEN 'sb_secret'
      WHEN v_key LIKE 'sb_publishable_%' THEN 'sb_publishable'
      ELSE 'unknown'
    END,
    'role_claim', v_role,
    'iss_claim', v_payload->>'iss',
    'ref_claim', v_payload->>'ref',
    'expired', CASE WHEN v_exp IS NULL THEN NULL
                    ELSE v_exp < extract(epoch from now())::bigint END,
    'has_whitespace', v_key ~ '\s',
    'trimmed_differs', btrim(v_key) IS DISTINCT FROM v_key
  );
END;
$function$;